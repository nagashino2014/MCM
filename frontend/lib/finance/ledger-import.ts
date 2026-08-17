// 백테스트 하네스 — 세무법인 결산 자료(계정 원장/시산표 엑셀) 임포트 + 앱 전표와 계정별 대사
// (accounting-expansion 블루프린트 §5 P3 · §7 T1-①: 과거 2개년 결산 자료로 앱 산출물을 검증)
//
// 파서는 SheetJS(xlsx) 기반 — 세무법인 실파일이 구형 .xls(BIFF)라 ExcelJS 로는 읽을 수 없다(실측).
// 지원 포맷 2종(시트 단위 자동 감지, 2024·2025 실파일 실측 기반):
//  (a) 계정별원장형: 시트당 계정 1개(시트명 "N_계정명(93000)" — 5자리 세무코드), 열 = 날짜|적요란|코드|거래처|차변|대변|잔액.
//      날짜가 빈 행(전기이월·[월 계]·[누 계])은 발생액이 아니므로 제외.
//  (b) 목록형: 행마다 계정과목 열이 있는 시산표/집계표 — 헤더에서 [계정과목|과목|계정]+[차변]+[대변] 열 탐지.
// 계정 매칭: ① 세무코드 5자리 ÷ 100 = 표준 3자리 코드(10300→103 보통예금 — 체계 동일 실측) ② 이름·별칭 정규화 매칭 폴백.
// 미매칭 계정은 raw 이름 그대로 보존 — 대사 리포트에 "미매칭"으로 표시되어 계정 시드 보강의 근거가 된다.

import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

const hashId = (prefix: string, source: string) =>
  `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;

const normName = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");

/** 세무 프로그램 표기 ↔ 시드 계정명 별칭(정규화 후 비교). */
const ACCOUNT_ALIASES: Record<string, string> = {
  접대비: "기업업무추진비",
  "접대비(기업업무추진비)": "기업업무추진비",
  직원_급여: "급여",
  세금과공과: "세금과공과금",
};

const HEADER_KEYS = {
  account: ["계정과목", "계정과목명", "과목", "계정"],
  debit: ["차변합계", "차변", "차변금액"],
  credit: ["대변합계", "대변", "대변금액"],
  date: ["날짜", "일자", "월일", "회계일자"],
  description: ["적요란", "적요", "내용", "거래내용"],
  party: ["거래처"],
};

/** 합계·소계류(목록형의 계정명 열 기준) 제외. */
const SUMMARY_ROW_RE = /^[\[\(<]?\s*(전기이월|합\s*계|총\s*계|소\s*계|월\s*계|누\s*계|잔\s*액)/;

interface ParsedLedgerLine {
  accountNameRaw: string;
  vendorCode: string | null; // 세무 프로그램 5자리 코드(계정별원장형 시트명에서)
  entryDate: string | null;
  description: string | null;
  debit: number;
  credit: number;
}

const cellNumber = (v: unknown): number => {
  const raw = String(v ?? "").replace(/[^0-9.-]/g, "");
  const n = Number(raw);
  return Number.isFinite(n) && raw !== "" ? Math.round(n) : 0;
};

/** "MM-DD" / "YYYY-MM-DD" / "YYYY.MM.DD" → YYYY-MM-DD(연도 없는 표기는 yearLabel 결합). */
const cellDate = (v: unknown, yearLabel: string): string | null => {
  const text = String(v ?? "").trim().replace(/[.\/]/g, "-");
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = text.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) return `${yearLabel}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
};

/** 헤더 행 탐색(상위 15행) — normName 기준 이름 매칭. */
function detectHeader(rows: unknown[][]): { rowNo: number; cols: Partial<Record<keyof typeof HEADER_KEYS, number>> } | null {
  for (let rowNo = 0; rowNo < Math.min(15, rows.length); rowNo++) {
    const row = rows[rowNo] ?? [];
    const cols: Partial<Record<keyof typeof HEADER_KEYS, number>> = {};
    row.forEach((cell, colNo) => {
      const text = normName(String(cell ?? ""));
      if (!text) return;
      for (const key of Object.keys(HEADER_KEYS) as Array<keyof typeof HEADER_KEYS>) {
        if (cols[key] != null) continue;
        if (HEADER_KEYS[key].some((h) => text === normName(h) || text.startsWith(normName(h)))) {
          cols[key] = colNo;
          break;
        }
      }
    });
    if (cols.debit != null && cols.credit != null) return { rowNo, cols };
  }
  return null;
}

/** 시트명 "N_계정명(93000)" → { name, code }. 미매치 시 null. */
function parseSheetAccount(sheetName: string): { name: string; code: string | null } | null {
  const m = sheetName.match(/^\d+_(.+?)\((\d{4,6})\)\s*$/);
  if (m) return { name: m[1].trim(), code: m[2] };
  return null;
}

/** 워크북 파싱(순수 함수) — .xls/.xlsx 공용(SheetJS). */
export function parseLedgerWorkbook(
  buf: Buffer,
  yearLabel: string,
): { lines: ParsedLedgerLine[]; sheets: Array<{ name: string; rows: number; skipped: boolean }> } {
  const wb = XLSX.read(buf, { type: "buffer" });
  const lines: ParsedLedgerLine[] = [];
  const sheets: Array<{ name: string; rows: number; skipped: boolean }> = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as unknown[][];
    const header = detectHeader(rows);
    if (!header) {
      sheets.push({ name: sheetName, rows: 0, skipped: true });
      continue;
    }
    const sheetAccount = parseSheetAccount(sheetName);
    const isPerAccountSheet = header.cols.account == null && sheetAccount != null;
    if (header.cols.account == null && !isPerAccountSheet) {
      sheets.push({ name: sheetName, rows: 0, skipped: true });
      continue;
    }

    let count = 0;
    for (let rowNo = header.rowNo + 1; rowNo < rows.length; rowNo++) {
      const row = rows[rowNo] ?? [];
      const debit = cellNumber(row[header.cols.debit!]);
      const credit = cellNumber(row[header.cols.credit!]);
      if (!debit && !credit) continue;

      if (isPerAccountSheet) {
        // 계정별원장형 — 날짜 빈 행(전기이월·월계·누계)은 발생액이 아니다.
        const entryDate = header.cols.date != null ? cellDate(row[header.cols.date], yearLabel) : null;
        if (!entryDate) continue;
        const description = header.cols.description != null ? String(row[header.cols.description] ?? "").trim() || null : null;
        const party = header.cols.party != null ? String(row[header.cols.party] ?? "").trim() : "";
        lines.push({
          accountNameRaw: sheetAccount!.name,
          vendorCode: sheetAccount!.code,
          entryDate,
          description: party ? `${description ?? ""}${description ? " " : ""}(${party})` : description,
          debit,
          credit,
        });
        count += 1;
      } else {
        // 목록형 — 계정명 열 기준, 합계류 제외.
        const accountRaw = String(row[header.cols.account!] ?? "").trim();
        if (!accountRaw || SUMMARY_ROW_RE.test(accountRaw)) continue;
        lines.push({
          accountNameRaw: accountRaw,
          vendorCode: null,
          entryDate: header.cols.date != null ? cellDate(row[header.cols.date], yearLabel) : null,
          description: header.cols.description != null ? String(row[header.cols.description] ?? "").trim() || null : null,
          debit,
          credit,
        });
        count += 1;
      }
    }
    sheets.push({ name: sheetName, rows: count, skipped: false });
  }
  return { lines, sheets };
}

// ─────────────────────────────────────────────
// 적재 · 대사
// ─────────────────────────────────────────────

export async function importLedger(params: {
  buf: Buffer;
  yearLabel: string; // YYYY
  fileName: string;
  actorUserId: string;
}): Promise<{ batchId: string; lineCount: number; unmatchedAccounts: string[]; sheets: Array<{ name: string; rows: number; skipped: boolean }> }> {
  if (!/^\d{4}$/.test(params.yearLabel)) {
    throw Object.assign(new Error("대사 연도(YYYY)를 지정하세요."), { status: 400 });
  }
  const { lines, sheets } = parseLedgerWorkbook(params.buf, params.yearLabel);
  if (!lines.length) {
    throw Object.assign(
      new Error("읽을 수 있는 행이 없습니다. 계정별원장(시트당 계정) 또는 계정과목·차변·대변 열이 있는 목록형 엑셀인지 확인하세요."),
      { status: 400 },
    );
  }

  return withDbWrite(async (db) => {
    const accounts = rowsToObjects(await db.exec(`SELECT account_code, name FROM journal_accounts`));
    const byName = new Map(accounts.map((r) => [normName(String(r.name)), String(r.account_code)]));
    const byCode = new Set(accounts.map((r) => String(r.account_code)));

    const resolveCode = (line: ParsedLedgerLine): string | null => {
      // ① 세무코드 5자리 ÷ 100 = 표준 3자리(10300→103) — 체계 동일 실측. 예외(잡이익 93000≠907)는 ②로.
      if (line.vendorCode && line.vendorCode.length >= 4) {
        const code3 = String(Math.floor(Number(line.vendorCode) / 100)).padStart(3, "0");
        if (byCode.has(code3)) return code3;
      }
      const aliasApplied = ACCOUNT_ALIASES[line.accountNameRaw.trim()] ?? line.accountNameRaw;
      return byName.get(normName(aliasApplied)) ?? null;
    };

    const now = KST_NOW();
    const batchId = hashId("lib", `${params.yearLabel}:${params.fileName}:${now}`);
    await db.run(
      `INSERT INTO ledger_import_batches (batch_id, year_label, file_name, uploaded_by, line_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [batchId, params.yearLabel, params.fileName, params.actorUserId, lines.length, now],
    );

    const unmatched = new Set<string>();
    // 라인이 수천 건이라 multi-row INSERT 로 배치 적재(성능).
    const CHUNK = 200;
    for (let i = 0; i < lines.length; i += CHUNK) {
      const chunk = lines.slice(i, i + CHUNK);
      const values: string[] = [];
      const args: unknown[] = [];
      chunk.forEach((line, j) => {
        const code = resolveCode(line);
        if (!code) unmatched.add(line.vendorCode ? `${line.accountNameRaw}(${line.vendorCode})` : line.accountNameRaw);
        const base = args.length;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
        args.push(
          hashId("lil", `${batchId}:${i + j}`),
          batchId,
          line.accountNameRaw,
          code,
          line.entryDate,
          line.description,
          line.debit,
          line.credit,
        );
      });
      await db.run(
        `INSERT INTO ledger_import_lines (import_line_id, batch_id, account_name_raw, account_code, entry_date, description, debit, credit)
         VALUES ${values.join(", ")}`,
        args,
      );
    }
    return { batchId, lineCount: lines.length, unmatchedAccounts: [...unmatched], sheets };
  });
}

export interface ReconcileReportRow {
  accountCode: string | null;
  accountName: string; // 매칭 시 시드 이름, 미매칭 시 raw 이름
  importDebit: number;
  importCredit: number;
  appDebit: number;
  appCredit: number;
  diffDebit: number;
  diffCredit: number;
}

/** 대사 리포트 — 임포트(세무법인) 계정별 차/대 합계 vs 앱 전표(auto+confirmed) 계정별 합계. */
export async function reconcileReport(batchId: string): Promise<{
  batch: { batchId: string; yearLabel: string; fileName: string | null; lineCount: number; createdAt: string };
  rows: ReconcileReportRow[];
}> {
  const db = await getDb();
  const batches = rowsToObjects(await db.exec(`SELECT * FROM ledger_import_batches WHERE batch_id = $1`, [batchId]));
  if (!batches.length) throw Object.assign(new Error("임포트 배치를 찾을 수 없습니다."), { status: 404 });
  const year = String(batches[0].year_label);

  const importRows = rowsToObjects(
    await db.exec(
      `SELECT account_code, MIN(account_name_raw) AS name_raw,
              COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(credit), 0) AS credit
         FROM ledger_import_lines WHERE batch_id = $1
        GROUP BY account_code, CASE WHEN account_code IS NULL THEN account_name_raw ELSE '' END`,
      [batchId],
    ),
  );
  const appRows = rowsToObjects(
    await db.exec(
      `SELECT l.account_code, a.name, COALESCE(SUM(l.debit), 0) AS debit, COALESCE(SUM(l.credit), 0) AS credit
         FROM journal_lines l
         JOIN journal_entries e ON e.entry_id = l.entry_id
         LEFT JOIN journal_accounts a ON a.account_code = l.account_code
        WHERE e.status IN ('auto', 'confirmed') AND e.entry_date BETWEEN $1 AND $2
        GROUP BY l.account_code, a.name`,
      [`${year}-01-01`, `${year}-12-31`],
    ),
  );
  const accounts = rowsToObjects(await db.exec(`SELECT account_code, name, sort_order FROM journal_accounts`));
  const nameByCode = new Map(accounts.map((r) => [String(r.account_code), String(r.name)]));
  const sortByCode = new Map(accounts.map((r) => [String(r.account_code), Number(r.sort_order ?? 999)]));

  const merged = new Map<string, ReconcileReportRow>();
  const keyOf = (code: string | null, rawName: string) => code ?? `raw:${rawName}`;
  for (const r of importRows) {
    const code = r.account_code ? String(r.account_code) : null;
    const rawName = String(r.name_raw ?? "");
    merged.set(keyOf(code, rawName), {
      accountCode: code,
      accountName: code ? nameByCode.get(code) ?? code : rawName,
      importDebit: Number(r.debit ?? 0),
      importCredit: Number(r.credit ?? 0),
      appDebit: 0,
      appCredit: 0,
      diffDebit: 0,
      diffCredit: 0,
    });
  }
  for (const r of appRows) {
    const code = String(r.account_code);
    const key = keyOf(code, "");
    const row =
      merged.get(key) ??
      merged
        .set(key, {
          accountCode: code,
          accountName: r.name ? String(r.name) : code,
          importDebit: 0,
          importCredit: 0,
          appDebit: 0,
          appCredit: 0,
          diffDebit: 0,
          diffCredit: 0,
        })
        .get(key)!;
    row.appDebit = Number(r.debit ?? 0);
    row.appCredit = Number(r.credit ?? 0);
  }
  const rows = [...merged.values()]
    .map((r) => ({ ...r, diffDebit: r.appDebit - r.importDebit, diffCredit: r.appCredit - r.importCredit }))
    .sort((a, b) => (sortByCode.get(a.accountCode ?? "") ?? 999) - (sortByCode.get(b.accountCode ?? "") ?? 999));

  return {
    batch: {
      batchId,
      yearLabel: year,
      fileName: batches[0].file_name ? String(batches[0].file_name) : null,
      lineCount: Number(batches[0].line_count ?? 0),
      createdAt: String(batches[0].created_at),
    },
    rows,
  };
}

export async function listImportBatches(): Promise<Array<{ batchId: string; yearLabel: string; fileName: string | null; lineCount: number; createdAt: string }>> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM ledger_import_batches ORDER BY created_at DESC LIMIT 20`));
  return rows.map((r) => ({
    batchId: String(r.batch_id),
    yearLabel: String(r.year_label),
    fileName: r.file_name ? String(r.file_name) : null,
    lineCount: Number(r.line_count ?? 0),
    createdAt: String(r.created_at),
  }));
}

export async function deleteImportBatch(batchId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM ledger_import_batches WHERE batch_id = $1`, [batchId]);
  });
}
