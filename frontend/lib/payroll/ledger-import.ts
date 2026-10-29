import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { getDb, rowsToObjects, type PgDatabase } from "@/lib/db";
import { withPayrollWrite } from "@/lib/payroll/integrity";

/**
 * 급여대장 엑셀 가져오기(앱 내 마이그레이션) — scripts/payroll_import/import_payroll.py 의 3단 구조 파서 이식.
 * - 헤더 3행(사원번호/성명 · 입사일/직급 · 퇴사일/부서) ↔ 직원당 3행 블록이 1:1 대응
 * - 라벨 있는 칸은 항목 사전(명칭·별칭)으로 매핑, 라벨 없는 칸 금액은 '미상 지급/공제'로 보존
 * - 3중 합계 검증(Σ지급=지급합계, Σ공제=공제합계, 지급−공제=차인) 불일치 파일은 적재하지 않는다(파이프라인과 동일)
 * - 적재분은 source='excel', status='confirmed'. 앱 작성 대장·명세서 발행·전표 확정된 대장은 덮어쓰지 않는다.
 * 파일별 과거 열 밀림 보정(COLUMN_OVERRIDES)은 스크립트 전용 — 여기서는 매핑표를 미리보기로 보여 준다.
 */

const PERSON_LABELS = new Set(["사원번호", "성명", "입사일", "직급", "퇴사일", "부서"]);
const TOTAL_PAY = "지급합계";
const TOTAL_DED = "공제합계";
const TOTAL_NET = "차인지급액";
const SKIP_INFO = new Set(["비과세계", "비고", "영수인", "확인"]);

export const IMPORT_MAX_FILES = 24;
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

const squash = (s: unknown) => String(s ?? "").replace(/\s+/g, "");
const normItem = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ");

function colLetter(c: number): string {
  return XLSX.utils.encode_col(c);
}

function normDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    // SheetJS 는 날짜 셀을 현지 자정 Date 로 준다 — 서버 시간대와 무관하게 KST 날짜로 맞춘다.
    const k = new Date(v.getTime() + 9 * 3600 * 1000 + 30 * 1000);
    return k.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  const m = /^(\d{2,4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/.exec(s);
  if (m) {
    let y = Number(m[1]);
    if (y < 100) y += 2000;
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return s;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return null;
  const s = String(v).replace(/,/g, "").trim();
  if (!s || s === "-" || s === "·") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------------------------------------------- 파일명 → 연·월·종류 */

export type LedgerKind = "salary" | "bonus" | "intern";

export function guessPeriod(fileName: string, title: string | null): { year: number | null; month: number | null; kind: LedgerKind } {
  const stem = fileName.replace(/\.[^.]+$/, "").normalize("NFC");
  // 26년03월 급상여대장 / 17년08월 상여대장 / 19년07월 상여(하계휴가)대장
  const a = /^(\d{2})년\s*(\d{1,2})월\s*(급여|급상여|상여)(?:\([^)]*\))?대장/.exec(stem);
  if (a) return { year: 2000 + Number(a[1]), month: Number(a[2]), kind: a[3] === "상여" ? "bonus" : "salary" };
  // 인턴급여대장(19.01.31)
  const b = /^인턴급여대장\((\d{2})\.(\d{1,2})/.exec(stem);
  if (b) return { year: 2000 + Number(b[1]), month: Number(b[2]), kind: "intern" };
  // 2026년 3월분 급상여대장 (파일명 또는 시트 제목)
  for (const s of [stem, title ?? ""]) {
    const c = /(\d{4})\s*년\s*(\d{1,2})\s*월/.exec(s);
    if (c) {
      const kind: LedgerKind = /인턴/.test(s) ? "intern" : /상여/.test(s) && !/급상여|급여/.test(s) ? "bonus" : "salary";
      return { year: Number(c[1]), month: Number(c[2]), kind };
    }
  }
  return { year: null, month: null, kind: /인턴/.test(stem) ? "intern" : "salary" };
}

/* ---------------------------------------------------------------- 항목 사전 */

interface ItemDict {
  byName: Map<string, { itemId: string; kind: "pay" | "deduction"; name: string }>;
  kinds: Map<string, "pay" | "deduction">;
  names: Map<string, string>;
}

async function loadItemDict(db: PgDatabase): Promise<ItemDict> {
  const rows = rowsToObjects(await db.exec(`SELECT item_id, name, kind, aliases FROM payroll_item_defs`));
  const dict: ItemDict = { byName: new Map(), kinds: new Map(), names: new Map() };
  for (const r of rows) {
    const itemId = String(r.item_id);
    const kind = r.kind === "deduction" ? "deduction" : "pay";
    dict.kinds.set(itemId, kind);
    dict.names.set(itemId, String(r.name));
    const aliases = Array.isArray(r.aliases) ? (r.aliases as unknown[]).map(String) : [];
    for (const n of [String(r.name), ...aliases]) dict.byName.set(squash(n), { itemId, kind, name: String(r.name) });
  }
  return dict;
}

/** 사전에 없는 라벨 → 'auto-' + sha 앞 8 (파이프라인과 같은 규칙) */
function autoItemId(label: string): string {
  return "auto-" + createHash("sha256").update(label).digest("hex").slice(0, 8);
}

/* ---------------------------------------------------------------- 파싱 */

export interface ParsedEntry {
  rowOrder: number;
  empNo: string | null;
  name: string;
  positionName: string | null;
  deptName: string | null;
  hiredAt: string | null;
  resignedAt: string | null;
  payTotal: number;
  deductionTotal: number;
  netPay: number;
  lines: Record<string, number>;
  note: string | null;
  errors: string[];
}

export interface ParsedFile {
  fileName: string;
  sha256: string;
  ok: boolean;
  error: string | null;
  title: string | null;
  guess: { year: number | null; month: number | null; kind: LedgerKind };
  entries: ParsedEntry[];
  issues: string[];
  /** 헤더 라벨 → 매핑 항목(미리보기 표시용) */
  mapping: Array<{ label: string; itemId: string; itemName: string; kind: "pay" | "deduction"; isNew: boolean }>;
  /** 사전에 없어 새로 추가될 항목 */
  newItems: Array<{ label: string; itemId: string; kind: "pay" | "deduction" }>;
}

function readGrid(buf: Buffer): unknown[][] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws["!ref"]) return [];
  // 원본 파서(openpyxl)처럼 A1 기준 격자로 읽는다 — 시트 사용 범위가 B2 등에서 시작해도 열 번호가 어긋나지 않게.
  const end = XLSX.utils.decode_range(ws["!ref"]).e;
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range: { s: { r: 0, c: 0 }, e: end },
  });
}

function parseGrid(fileName: string, sha256: string, grid: unknown[][], dict: ItemDict): ParsedFile {
  const base: ParsedFile = {
    fileName, sha256, ok: false, error: null, title: null,
    guess: guessPeriod(fileName, null), entries: [], issues: [], mapping: [], newItems: [],
  };
  const nrow = grid.length;
  const hdr = grid.findIndex((row) => row.some((v) => v != null && squash(v) === "사원번호"));
  if (hdr < 0) return { ...base, error: "헤더('사원번호')를 찾지 못했습니다 — 3단 구조 급상여대장 양식이 아닙니다." };

  // 그룹행에서 공제 구역 시작 열(신규 항목 종류 추정)
  let dedStart: number | null = null;
  for (let gi = Math.max(0, hdr - 2); gi < hdr && dedStart == null; gi++) {
    const c = grid[gi].findIndex((v) => v != null && squash(v).includes("공제"));
    if (c >= 0) dedStart = c;
  }

  const header = new Map<string, string>(); // "k:c" → 라벨
  const totals: Partial<Record<"pay" | "ded" | "net", [number, number]>> = {};
  const person = new Map<string, [number, number]>();
  const skipPos = new Set<string>();
  const infoCols = new Set<number>();
  for (let k = 0; k < 3 && hdr + k < nrow; k++) {
    grid[hdr + k].forEach((v, c) => {
      const label = normItem(v);
      if (!label) return;
      const sq = squash(label);
      if (PERSON_LABELS.has(sq)) person.set(sq, [k, c]);
      else if (sq === TOTAL_PAY) totals.pay = [k, c];
      else if (sq === TOTAL_DED) totals.ded = [k, c];
      else if (sq === TOTAL_NET) totals.net = [k, c];
      else if (SKIP_INFO.has(sq)) {
        skipPos.add(`${k}:${c}`);
        if (sq !== "비과세계") infoCols.add(c); // 비고·영수인은 열 전체가 정보성
      } else header.set(`${k}:${c}`, label);
    });
  }
  const totalsSet = new Set(Object.values(totals).map(([k, c]) => `${k}:${c}`));
  const issues: string[] = [];
  const missing = (["pay", "ded", "net"] as const).filter((t) => !totals[t]);
  if (missing.length) issues.push(`합계 열 미발견: ${missing.map((t) => ({ pay: TOTAL_PAY, ded: TOTAL_DED, net: TOTAL_NET })[t]).join(", ")}`);

  let title: string | null = null;
  for (const row of grid.slice(0, 4)) {
    const hit = row.find((v) => v != null && String(v).includes("분"));
    if (hit != null) { title = normItem(hit); break; }
  }

  // 라벨 → 항목 해석(파일 단위 캐시)
  const newItems = new Map<string, { label: string; itemId: string; kind: "pay" | "deduction" }>();
  const resolve = (label: string, isDed: boolean): string => {
    const hit = dict.byName.get(squash(label));
    if (hit) return hit.itemId;
    const existing = newItems.get(squash(label));
    if (existing) return existing.itemId;
    const item = { label, itemId: autoItemId(label), kind: (isDed ? "deduction" : "pay") as "pay" | "deduction" };
    newItems.set(squash(label), item);
    return item.itemId;
  };
  const kindOf = (itemId: string): "pay" | "deduction" =>
    dict.kinds.get(itemId) ?? [...newItems.values()].find((n) => n.itemId === itemId)?.kind ?? "pay";

  const mapping = new Map<string, ParsedFile["mapping"][number]>();
  for (const [pos, label] of header) {
    const c = Number(pos.split(":")[1]);
    const isDed = dedStart != null && c >= dedStart;
    const itemId = resolve(label, isDed);
    if (!mapping.has(label)) {
      const nw = [...newItems.values()].find((n) => n.itemId === itemId);
      mapping.set(label, { label, itemId, itemName: dict.names.get(itemId) ?? label, kind: kindOf(itemId), isNew: !!nw });
    }
  }

  const personPos = new Set([...person.values()].map(([k, c]) => `${k}:${c}`));
  const maxCol = Math.max(0, ...[...header.keys(), ...totalsSet].map((p) => Number(p.split(":")[1])));
  const entries: ParsedEntry[] = [];
  let order = 0;
  for (let r = hdr + 3; r < nrow; r += 3) {
    const get = (k: number, c: number): unknown => grid[r + k]?.[c] ?? null;
    const at = (key: string, def: [number, number]) => { const [k, c] = person.get(key) ?? def; return get(k, c); };
    const name = normItem(at("성명", [0, 1]));
    const empNo = at("사원번호", [0, 0]);
    if (squash(name) === "합계" || squash(name) === "총계") break;
    if (!name && empNo == null) {
      const hasAny = [0, 1, 2].some((k) => (grid[r + k] ?? []).some((v) => v != null && String(v).trim()));
      if (!hasAny) break;
    }
    if (!name) continue;

    const lines: Record<string, number> = {};
    const unlabeled: string[] = [];
    for (let k = 0; k < 3; k++) {
      for (let c = 2; c <= maxCol; c++) { // A·B(인적) 제외
        const pos = `${k}:${c}`;
        if (personPos.has(pos) || totalsSet.has(pos) || skipPos.has(pos) || infoCols.has(c)) continue;
        const v = num(get(k, c));
        if (v == null || v === 0) continue;
        const isDed = dedStart != null && c >= dedStart;
        const label = header.get(pos);
        let item: string;
        if (label == null) {
          item = isDed ? "unlabeled-ded" : "unlabeled-pay";
          unlabeled.push(`${colLetter(c)}${k + 1}단 ${Math.round(v).toLocaleString("ko-KR")}`);
        } else {
          item = resolve(label, isDed);
        }
        lines[item] = (lines[item] ?? 0) + v;
      }
    }

    const tget = (t: "pay" | "ded" | "net") => (totals[t] ? num(get(totals[t]![0], totals[t]![1])) : null);
    let payTotal = tget("pay");
    let dedTotal = tget("ded");
    let netPay = tget("net");
    const totalsFilled = payTotal == null || dedTotal == null || netPay == null;
    const sumPay = Object.entries(lines).filter(([i]) => kindOf(i) === "pay").reduce((a, [, v]) => a + v, 0);
    const sumDed = Object.entries(lines).filter(([i]) => kindOf(i) === "deduction").reduce((a, [, v]) => a + v, 0);
    payTotal ??= sumPay;
    dedTotal ??= sumDed;
    netPay ??= payTotal - dedTotal;

    const errors: string[] = [];
    if (Math.round(sumPay) !== Math.round(payTotal)) errors.push(`지급 ${Math.round(sumPay).toLocaleString("ko-KR")}≠${Math.round(payTotal).toLocaleString("ko-KR")}`);
    if (Math.round(sumDed) !== Math.round(dedTotal)) errors.push(`공제 ${Math.round(sumDed).toLocaleString("ko-KR")}≠${Math.round(dedTotal).toLocaleString("ko-KR")}`);
    if (Math.round(payTotal - dedTotal) !== Math.round(netPay)) errors.push(`차인 ${Math.round(payTotal - dedTotal).toLocaleString("ko-KR")}≠${Math.round(netPay).toLocaleString("ko-KR")}`);
    const notes = [...errors];
    if (totalsFilled) notes.push("합계 원본 공란 → 라인합으로 대체");
    if (unlabeled.length) notes.push("미상값(무라벨 셀): " + unlabeled.join(", "));
    if (errors.length) issues.push(`${r + 1}행 ${name}: ${errors.join("; ")}`);

    entries.push({
      rowOrder: order++,
      empNo: normItem(empNo) || null,
      name,
      positionName: normItem(at("직급", [1, 1])) || null,
      deptName: normItem(at("부서", [2, 1])) || null,
      hiredAt: normDate(at("입사일", [1, 0])),
      resignedAt: normDate(at("퇴사일", [2, 0])),
      payTotal, deductionTotal: dedTotal, netPay, lines,
      note: notes.length ? notes.join("; ") : null,
      errors,
    });
  }

  return {
    ...base,
    ok: true,
    title,
    guess: guessPeriod(fileName, title),
    entries,
    issues,
    mapping: [...mapping.values()],
    newItems: [...newItems.values()],
  };
}

export async function parseLedgerFile(fileName: string, buf: Buffer, database?: PgDatabase): Promise<ParsedFile> {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const db = database ?? (await getDb());
  const dict = await loadItemDict(db);
  let grid: unknown[][];
  try {
    grid = readGrid(buf);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    return {
      fileName, sha256, ok: false, title: null, guess: guessPeriod(fileName, null), entries: [], issues: [], mapping: [], newItems: [],
      error: /password|encrypt|ECMA-376|CFB/i.test(msg)
        ? "암호가 걸린 파일입니다. 엑셀에서 암호를 해제해 저장한 뒤 다시 올려 주세요."
        : `엑셀을 읽지 못했습니다: ${msg}`,
    };
  }
  return parseGrid(fileName, sha256, grid, dict);
}

/* ---------------------------------------------------------------- 적재 계획 */

export type ImportAction = "new" | "same" | "overwrite" | "blocked" | "invalid";

export interface ImportTarget {
  year: number;
  month: number;
  kind: LedgerKind;
  overwrite: boolean;
}

export interface ImportPlan {
  action: ImportAction;
  reason: string | null;
  ledgerId: string;
  existing: { source: string; status: string; sourceFile: string | null; headcount: number } | null;
  /** 기존 엑셀 대장을 [덮어쓰기]로 바꿀 수 있는 경우 */
  canOverwrite?: boolean;
}

const ledgerIdFor = (t: ImportTarget) => `pled-${t.year}${String(t.month).padStart(2, "0")}-${t.kind}`;

export function validTarget(t: Partial<ImportTarget>): t is ImportTarget {
  return (
    Number.isInteger(t.year) && t.year! >= 2000 && t.year! <= 2100 &&
    Number.isInteger(t.month) && t.month! >= 1 && t.month! <= 12 &&
    (t.kind === "salary" || t.kind === "bonus" || t.kind === "intern")
  );
}

export async function planImport(db: PgDatabase, file: ParsedFile, t: ImportTarget): Promise<ImportPlan> {
  const ledgerId = ledgerIdFor(t);
  if (!file.ok) return { action: "invalid", reason: file.error, ledgerId, existing: null };
  if (!file.entries.length) return { action: "invalid", reason: "직원 행이 없습니다(빈 양식).", ledgerId, existing: null };
  const bad = file.entries.filter((e) => e.errors.length).length;
  if (bad) return { action: "invalid", reason: `합계가 맞지 않는 행 ${bad}건 — 원본 엑셀을 고친 뒤 다시 올려 주세요.`, ledgerId, existing: null };

  const row = rowsToObjects(await db.exec(
    `SELECT l.ledger_id, l.source, l.status, l.source_file, l.source_sha256,
            (SELECT count(*) FROM payroll_entries e WHERE e.ledger_id = l.ledger_id) AS headcount,
            (SELECT count(*) FROM payroll_entries e WHERE e.ledger_id = l.ledger_id AND e.statement_sent_at IS NOT NULL) AS sent
       FROM payroll_ledgers l
      WHERE l.pay_year = $1 AND l.pay_month = $2 AND l.ledger_kind = $3`,
    [t.year, t.month, t.kind]
  ))[0];
  if (!row) return { action: "new", reason: null, ledgerId, existing: null };
  const existing = {
    source: String(row.source), status: String(row.status),
    sourceFile: row.source_file ? String(row.source_file) : null, headcount: Number(row.headcount ?? 0),
  };
  const plan = (action: ImportAction, reason: string | null, canOverwrite = false): ImportPlan =>
    ({ action, reason, ledgerId: String(row.ledger_id), existing, canOverwrite });
  if (existing.source !== "excel") return plan("blocked", "앱에서 만든 대장이 이미 있습니다 — 엑셀로 덮어쓸 수 없습니다.");
  if (String(row.source_sha256 ?? "") === file.sha256) return plan("same", "같은 파일이 이미 들어와 있습니다.");
  if (Number(row.sent ?? 0) > 0) return plan("blocked", "급여명세서를 발행한 대장이라 덮어쓸 수 없습니다.");
  const journal = rowsToObjects(await db.exec(
    `SELECT 1 FROM journal_entries WHERE source_kind = 'payroll' AND source_id = $1 AND status NOT IN ('auto','pending') LIMIT 1`,
    [String(row.ledger_id)]
  ));
  if (journal.length) return plan("blocked", "전표가 확정된 대장이라 덮어쓸 수 없습니다.");
  return plan(t.overwrite ? "overwrite" : "blocked", t.overwrite ? "기존 엑셀 대장을 이 파일로 바꿉니다." : "같은 달 대장이 이미 있습니다 — 바꾸려면 덮어쓰기를 체크하세요.", true);
}

/* ---------------------------------------------------------------- 적재 */

export interface ImportResult {
  fileName: string;
  ledgerId: string;
  action: ImportAction;
  headcount: number;
  matched: number;
  reason: string | null;
}

/** 파일 하나를 대장 하나로 적재 — 파일마다 별도 트랜잭션(한 파일 실패가 다른 파일을 막지 않는다). */
export async function importLedgerFile(fileName: string, buf: Buffer, t: ImportTarget): Promise<ImportResult> {
  return withPayrollWrite(async (db) => {
    const file = await parseLedgerFile(fileName, buf, db);
    const plan = await planImport(db, file, t);
    const result: ImportResult = { fileName, ledgerId: plan.ledgerId, action: plan.action, headcount: 0, matched: 0, reason: plan.reason };
    if (plan.action !== "new" && plan.action !== "overwrite") return result;

    const now = new Date().toISOString();
    for (const n of file.newItems) {
      await db.exec(
        `INSERT INTO payroll_item_defs (item_id, name, kind, display_order, note, created_at)
         VALUES ($1, $2, $3, 900, '엑셀 가져오기 자동 추가', $4)
         ON CONFLICT DO NOTHING`,
        [n.itemId, n.label, n.kind, now]
      );
    }
    // 신규 항목 종류가 사전과 다르면(동시 추가 등) 중단 — 지급/공제 합계가 오염되지 않게
    const ids = [...new Set(file.entries.flatMap((e) => Object.keys(e.lines)))];
    const stored = new Map(rowsToObjects(await db.exec(`SELECT item_id, kind FROM payroll_item_defs WHERE item_id = ANY($1::text[])`, [ids]))
      .map((r) => [String(r.item_id), String(r.kind)]));
    for (const e of file.entries) {
      let pay = 0;
      let ded = 0;
      for (const [itemId, amount] of Object.entries(e.lines)) {
        const kind = stored.get(itemId);
        if (kind === "pay") pay += amount;
        else if (kind === "deduction") ded += amount;
        else throw Object.assign(new Error(`급여 항목 '${itemId}'을(를) 사전에서 찾지 못했습니다.`), { status: 409 });
      }
      if (Math.abs(pay - e.payTotal) > 0.000001 || Math.abs(ded - e.deductionTotal) > 0.000001 || Math.abs(pay - ded - e.netPay) > 0.000001) {
        throw Object.assign(new Error(`${e.name}: 원본 합계와 지급·공제 항목이 맞지 않아 적재를 중단했습니다.`), { status: 409 });
      }
    }

    // 성명 → employee_id (동명이인은 매칭 보류)
    const byName = new Map<string, string[]>();
    for (const r of rowsToObjects(await db.exec(`SELECT employee_id, name FROM employee_profiles`))) {
      const k = squash(r.name);
      byName.set(k, [...(byName.get(k) ?? []), String(r.employee_id)]);
    }

    const ledgerId = plan.ledgerId;
    await db.exec(
      `INSERT INTO payroll_ledgers
         (ledger_id, pay_year, pay_month, ledger_kind, title, source, source_file, source_sha256, status, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,'excel',$6,$7,'confirmed',NULL,$8)
       ON CONFLICT (ledger_id) DO UPDATE SET
         title = EXCLUDED.title, source_file = EXCLUDED.source_file, source_sha256 = EXCLUDED.source_sha256`,
      [ledgerId, t.year, t.month, t.kind, file.title, fileName, file.sha256, now]
    );
    await db.exec(`DELETE FROM payroll_entries WHERE ledger_id = $1`, [ledgerId]);
    for (const e of file.entries) {
      const cands = byName.get(squash(e.name)) ?? [];
      const employeeId = cands.length === 1 ? cands[0] : null;
      if (employeeId) result.matched += 1;
      const entryId = `${ledgerId}-r${String(e.rowOrder).padStart(3, "0")}`;
      const note = cands.length > 1 ? [e.note, "동명이인 — 직원 매칭 보류"].filter(Boolean).join("; ") : e.note;
      await db.exec(
        `INSERT INTO payroll_entries
           (entry_id, ledger_id, employee_id, emp_no, name, dept_name, position_name,
            hired_at, resigned_at, pay_total, deduction_total, net_pay, row_order, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [entryId, ledgerId, employeeId, e.empNo, e.name, e.deptName, e.positionName,
          e.hiredAt, e.resignedAt, e.payTotal, e.deductionTotal, e.netPay, e.rowOrder, note]
      );
      for (const [itemId, amount] of Object.entries(e.lines)) {
        await db.exec(
          `INSERT INTO payroll_entry_lines (line_id, entry_id, item_id, amount) VALUES ($1,$2,$3,$4)`,
          [`${entryId}-${itemId}`, entryId, itemId, amount]
        );
      }
    }
    result.headcount = file.entries.length;
    return result;
  });
}

/** 미리보기용 — 파싱 + 계획(쓰기 없음) */
export async function previewLedgerFile(fileName: string, buf: Buffer, t: Partial<ImportTarget> | null) {
  const db = await getDb();
  const file = await parseLedgerFile(fileName, buf, db);
  const target: Partial<ImportTarget> = {
    year: t?.year ?? file.guess.year ?? undefined,
    month: t?.month ?? file.guess.month ?? undefined,
    kind: t?.kind ?? file.guess.kind,
    overwrite: !!t?.overwrite,
  };
  const plan = validTarget(target)
    ? await planImport(db, file, target)
    : { action: "invalid" as const, reason: file.ok ? "귀속 연·월을 정해 주세요." : file.error, ledgerId: "", existing: null };
  const sum = (f: (e: ParsedEntry) => number) => file.entries.reduce((a, e) => a + f(e), 0);
  return {
    fileName,
    ok: file.ok,
    error: file.error,
    title: file.title,
    target,
    plan,
    headcount: file.entries.length,
    payTotal: sum((e) => e.payTotal),
    deductionTotal: sum((e) => e.deductionTotal),
    netTotal: sum((e) => e.netPay),
    issues: file.issues,
    unlabeledRows: file.entries.filter((e) => e.note?.includes("미상값")).length,
    mapping: file.mapping,
    newItems: file.newItems,
    entries: file.entries.map((e) => ({
      name: e.name, deptName: e.deptName, positionName: e.positionName,
      payTotal: e.payTotal, deductionTotal: e.deductionTotal, netPay: e.netPay, note: e.note,
    })),
  };
}
