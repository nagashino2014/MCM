// 결산·법인세 준비 엔진 (블루프린트 P9) — 재무상태표(기초 인수+발생 누적) · 연차 마감(스냅·잠금)
// · 세무조정 후보 자동 감지 · 부속서식(접대비명세·영수증수취명세) 기초자료.
// 원칙: 재무제표는 전표 파생, 마감 연도는 재생성 잠금(isYearClosed 가드), 기준값은 corp_tax_params 시드(T4).
// 법인세 "조정·신고" 자체는 외부 검토 병행 전제의 최종 단계(§5 P9-⑤) — 여기서는 후보 감지·자료까지.

import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
const hashId = (prefix: string, source: string) =>
  `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;

// ── 재무상태표 ──

export interface BalanceLine {
  accountCode: string;
  name: string;
  acctType: string;
  opening: number; // 기초(차변+)
  movement: number; // 당기 발생(차-대)
  closing: number; // 기말
}

export interface BalanceSheet {
  year: number;
  asOf: string;
  assets: BalanceLine[];
  liabilities: BalanceLine[];
  equity: BalanceLine[];
  netIncome: number; // 당기순이익(수익-비용) — 자본에 가산
  assetTotal: number;
  liabilityTotal: number;
  equityTotal: number; // 자본 + 당기순이익
  balanced: boolean;
  hasOpening: boolean;
}

/** 연도 재무상태표 — 기초 잔액(opening_balances) + 당기 발생(auto+confirmed). asOf 미지정 = 연말. */
export async function buildBalanceSheet(year: number, asOf?: string): Promise<BalanceSheet> {
  const db = await getDb();
  const to = asOf ?? `${year}-12-31`;
  const from = `${year}-01-01`;
  const moveRows = rowsToObjects(
    await db.exec(
      `SELECT l.account_code, a.name, a.acct_type,
              COALESCE(SUM(l.debit - l.credit), 0) AS movement
         FROM journal_lines l
         JOIN journal_entries e ON e.entry_id = l.entry_id
         JOIN journal_accounts a ON a.account_code = l.account_code
        WHERE e.status IN ('auto', 'confirmed') AND e.entry_date BETWEEN $1 AND $2
        GROUP BY l.account_code, a.name, a.acct_type`,
      [from, to],
    ),
  );
  const openRows = rowsToObjects(
    await db.exec(
      `SELECT ob.account_code, a.name, a.acct_type, ob.amount
         FROM opening_balances ob JOIN journal_accounts a ON a.account_code = ob.account_code
        WHERE ob.fiscal_year = $1`,
      [year],
    ),
  );

  const map = new Map<string, BalanceLine>();
  for (const r of openRows) {
    map.set(String(r.account_code), {
      accountCode: String(r.account_code),
      name: String(r.name),
      acctType: String(r.acct_type),
      opening: Number(r.amount || 0),
      movement: 0,
      closing: Number(r.amount || 0),
    });
  }
  let netIncome = 0;
  for (const r of moveRows) {
    const type = String(r.acct_type);
    const movement = Math.round(Number(r.movement || 0));
    if (type === "revenue") {
      netIncome += -movement; // 수익은 대변+
      continue;
    }
    if (type === "expense") {
      netIncome -= movement;
      continue;
    }
    const code = String(r.account_code);
    const cur = map.get(code) ?? {
      accountCode: code,
      name: String(r.name),
      acctType: type,
      opening: 0,
      movement: 0,
      closing: 0,
    };
    cur.movement = movement;
    cur.closing = cur.opening + movement;
    map.set(code, cur);
  }

  const lines = [...map.values()].filter((l) => l.opening !== 0 || l.movement !== 0);
  lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const assets = lines.filter((l) => l.acctType === "asset");
  const liabilities = lines.filter((l) => l.acctType === "liability");
  const equity = lines.filter((l) => l.acctType === "equity");
  const assetTotal = assets.reduce((a, l) => a + l.closing, 0);
  const liabilityTotal = liabilities.reduce((a, l) => a + -l.closing, 0); // 대변 잔액을 양수 표기
  const equityBase = equity.reduce((a, l) => a + -l.closing, 0);
  const equityTotal = equityBase + netIncome;
  return {
    year,
    asOf: to,
    assets,
    liabilities,
    equity,
    netIncome,
    assetTotal,
    liabilityTotal,
    equityTotal,
    balanced: assetTotal === liabilityTotal + equityTotal,
    hasOpening: openRows.length > 0,
  };
}

export async function saveOpeningBalance(year: number, accountCode: string, amount: number, memo?: string | null): Promise<void> {
  await withDbWrite(async (db) => {
    if (amount === 0) {
      await db.run(`DELETE FROM opening_balances WHERE fiscal_year = $1 AND account_code = $2`, [year, accountCode]);
      return;
    }
    await db.run(
      `INSERT INTO opening_balances (ob_id, fiscal_year, account_code, amount, memo, created_at)
       VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6)
       ON CONFLICT (fiscal_year, account_code) DO UPDATE SET amount = EXCLUDED.amount, memo = EXCLUDED.memo, updated_at = $6`,
      [hashId("ob", `${year}:${accountCode}`), year, accountCode, amount, memo ?? "", KST_NOW()],
    );
  });
}

// ── 연차 마감 ──

export async function isYearClosed(year: number): Promise<boolean> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT 1 AS x FROM fiscal_closings WHERE fiscal_year = $1 AND status = 'closed'`, [year]));
  return rows.length > 0;
}

/** 기간이 마감 연도와 겹치면 오류 — regenerateJournal 가드가 호출. */
export async function assertRangeNotClosed(from: string, to: string): Promise<void> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT fiscal_year FROM fiscal_closings WHERE status = 'closed' AND fiscal_year BETWEEN $1 AND $2 ORDER BY fiscal_year LIMIT 1`,
      [Number(from.slice(0, 4)), Number(to.slice(0, 4))],
    ),
  );
  if (rows.length) {
    throw Object.assign(new Error(`${rows[0].fiscal_year}년은 결산 마감되어 재생성할 수 없습니다 — 결산 탭에서 마감을 해제하세요.`), { status: 409 });
  }
}

export interface ClosingStatus {
  year: number;
  status: string;
  closedAt: string | null;
  pendingCount: number;
  suspenseOut: number; // 134 가지급금 잔액
  suspenseIn: number; // 257 가수금 잔액
  balanceSheet: BalanceSheet;
}

export async function closingStatus(year: number): Promise<ClosingStatus> {
  const db = await getDb();
  const [closing, pending, suspense, bs] = await Promise.all([
    db.exec(`SELECT status, closed_at FROM fiscal_closings WHERE fiscal_year = $1`, [year]),
    db.exec(
      `SELECT count(*) AS n FROM journal_entries WHERE status = 'pending' AND substr(entry_date, 1, 4) = $1`,
      [String(year)],
    ),
    db.exec(
      `SELECT l.account_code, COALESCE(SUM(l.debit - l.credit), 0) AS bal
         FROM journal_lines l JOIN journal_entries e ON e.entry_id = l.entry_id
        WHERE e.status IN ('auto', 'confirmed') AND substr(e.entry_date, 1, 4) = $1 AND l.account_code IN ('134', '257')
        GROUP BY l.account_code`,
      [String(year)],
    ),
    buildBalanceSheet(year),
  ]);
  const cRows = rowsToObjects(closing);
  const sRows = rowsToObjects(suspense);
  const bal = (code: string) => Math.round(Number(sRows.find((r) => String(r.account_code) === code)?.bal || 0));
  return {
    year,
    status: cRows.length ? String(cRows[0].status) : "draft",
    closedAt: cRows[0]?.closed_at ? String(cRows[0].closed_at) : null,
    pendingCount: Number(rowsToObjects(pending)[0]?.n || 0),
    suspenseOut: bal("134"),
    suspenseIn: -bal("257"),
    balanceSheet: bs,
  };
}

/** 연차 마감 — pending 잔존 시 거부(T3), 재무제표 스냅 보존. */
export async function closeFiscalYear(year: number, userId: string): Promise<void> {
  const status = await closingStatus(year);
  if (status.pendingCount > 0) {
    throw Object.assign(new Error(`확정 대기 전표 ${status.pendingCount}건이 남아 있어 마감할 수 없습니다.`), { status: 400 });
  }
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO fiscal_closings (closing_id, fiscal_year, status, snapshot, closed_by, closed_at, created_at, updated_at)
       VALUES ($1, $2, 'closed', $3::jsonb, $4, $5, $5, $5)
       ON CONFLICT (fiscal_year) DO UPDATE SET
         status = 'closed', snapshot = EXCLUDED.snapshot, closed_by = EXCLUDED.closed_by, closed_at = EXCLUDED.closed_at, updated_at = $5`,
      [hashId("fc", String(year)), year, JSON.stringify({ balanceSheet: status.balanceSheet }), userId, KST_NOW()],
    );
  });
}

export async function reopenFiscalYear(year: number): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`UPDATE fiscal_closings SET status = 'draft', updated_at = $2 WHERE fiscal_year = $1`, [year, KST_NOW()]);
  });
}

// ── 세무조정 후보 자동 감지 (P9-④) ──

export interface TaxAdjustmentItem {
  rule: string;
  entryDate: string;
  description: string;
  amount: number;
  note: string;
}

export interface TaxAdjustments {
  year: number;
  items: TaxAdjustmentItem[];
  entertainmentTotal: number; // 813 연간 합계
  entertainmentLimit: number;
  entertainmentOver: number;
}

export async function detectTaxAdjustments(year: number): Promise<TaxAdjustments> {
  const db = await getDb();
  const pRows = rowsToObjects(
    await db.exec(`SELECT params FROM corp_tax_params WHERE fiscal_year <= $1 ORDER BY fiscal_year DESC LIMIT 1`, [year]),
  );
  const params = (pRows.length ? (typeof pRows[0].params === "string" ? JSON.parse(String(pRows[0].params)) : pRows[0].params) : {}) as {
    entertainmentBaseLimit?: number;
    entertainmentRevenueRate?: number;
    congratulationCashLimit?: number;
  };
  const cashLimit = params.congratulationCashLimit ?? 200000;

  const items: TaxAdjustmentItem[] = [];

  // ① 현금성 기업업무추진비(813) 건당 한도 초과 — 경조금 등(계좌 출금·지출결의 유래, 적격증빙 없음)
  const cong = rowsToObjects(
    await db.exec(
      `SELECT e.entry_date, e.description, e.memo, l.debit
         FROM journal_lines l JOIN journal_entries e ON e.entry_id = l.entry_id
        WHERE l.account_code = '813' AND l.debit > $2 AND e.status IN ('auto', 'confirmed')
          AND e.source_kind IN ('bank_out', 'expense_doc', 'manual') AND substr(e.entry_date, 1, 4) = $1
        ORDER BY e.entry_date`,
      [String(year), cashLimit],
    ),
  );
  for (const r of cong) {
    items.push({
      rule: "경조금 한도",
      entryDate: String(r.entry_date),
      description: String(r.description ?? ""),
      amount: Math.round(Number(r.debit || 0)),
      note: `현금성 기업업무추진비 건당 ${cashLimit.toLocaleString("ko-KR")}원 초과 — 초과 시 전액 손금불산입(법령 41조) 검토`,
    });
  }

  // ② 기업업무추진비 연간 한도 (기본 + 수입금액 비례)
  const entRows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS total
         FROM journal_lines l JOIN journal_entries e ON e.entry_id = l.entry_id
        WHERE l.account_code = '813' AND e.status IN ('auto', 'confirmed') AND substr(e.entry_date, 1, 4) = $1`,
      [String(year)],
    ),
  );
  const revRows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(SUM(l.credit - l.debit), 0) AS total
         FROM journal_lines l JOIN journal_entries e ON e.entry_id = l.entry_id
         JOIN journal_accounts a ON a.account_code = l.account_code
        WHERE a.acct_type = 'revenue' AND e.status IN ('auto', 'confirmed') AND substr(e.entry_date, 1, 4) = $1`,
      [String(year)],
    ),
  );
  const entertainmentTotal = Math.round(Number(entRows[0]?.total || 0));
  const revenue = Math.round(Number(revRows[0]?.total || 0));
  const entertainmentLimit = Math.round((params.entertainmentBaseLimit ?? 36000000) + revenue * (params.entertainmentRevenueRate ?? 0.003));
  const entertainmentOver = Math.max(0, entertainmentTotal - entertainmentLimit);
  if (entertainmentOver > 0) {
    items.push({
      rule: "기업업무추진비 연간 한도",
      entryDate: `${year}-12-31`,
      description: `연간 합계 ${entertainmentTotal.toLocaleString("ko-KR")} / 한도 ${entertainmentLimit.toLocaleString("ko-KR")}`,
      amount: entertainmentOver,
      note: "한도 초과분 손금불산입",
    });
  }

  // ③ 가지급금(134) 기말 잔액 — 인정이자·업무무관 가지급 검토
  const suspRows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS bal
         FROM journal_lines l JOIN journal_entries e ON e.entry_id = l.entry_id
        WHERE l.account_code = '134' AND e.status IN ('auto', 'confirmed') AND substr(e.entry_date, 1, 4) = $1`,
      [String(year)],
    ),
  );
  const suspBal = Math.round(Number(suspRows[0]?.bal || 0));
  if (suspBal > 0) {
    items.push({
      rule: "가지급금 잔액",
      entryDate: `${year}-12-31`,
      description: "가지급금(134) 기말 잔액",
      amount: suspBal,
      note: "미정리 가지급 — 확정 큐 정리 또는 인정이자 계상 검토",
    });
  }

  return { year, items, entertainmentTotal, entertainmentLimit, entertainmentOver };
}

// ── 부속서식 xlsx (재무상태표 + 손익 + 접대비명세 + 영수증수취 기초) ──

export async function buildClosingWorkbook(year: number): Promise<Buffer> {
  const db = await getDb();
  const bs = await buildBalanceSheet(year);
  const adj = await detectTaxAdjustments(year);
  const money = "#,##0";
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet("재무상태표");
  ws.addRow([`재무상태표 (${year}-12-31 기준${bs.hasOpening ? "" : " — ⚠기초 잔액 미인수, 당기 발생분만"})`]).font = { bold: true, size: 13 };
  ws.addRow(["계정", "기초", "당기 증감", "기말"]).font = { bold: true };
  const addSection = (title: string, lines: BalanceLine[], sign: 1 | -1) => {
    ws.addRow([title]).font = { bold: true };
    for (const l of lines) ws.addRow([`  ${l.name}`, sign * l.opening, sign * l.movement, sign * l.closing]);
  };
  addSection("자산", bs.assets, 1);
  ws.addRow(["자산 총계", "", "", bs.assetTotal]).font = { bold: true };
  addSection("부채", bs.liabilities, -1);
  ws.addRow(["부채 총계", "", "", bs.liabilityTotal]).font = { bold: true };
  addSection("자본", bs.equity, -1);
  ws.addRow(["  당기순이익", "", "", bs.netIncome]);
  ws.addRow(["자본 총계", "", "", bs.equityTotal]).font = { bold: true };
  ws.columns.forEach((col, i) => (col.width = [26, 16, 16, 16][i] ?? 14));
  for (let c = 2; c <= 4; c += 1) ws.getColumn(c).numFmt = money;

  const ent = wb.addWorksheet("접대비 명세");
  ent.addRow([`기업업무추진비(813) 건별 명세 (${year}) — 연간 ${adj.entertainmentTotal.toLocaleString("ko-KR")} / 한도 ${adj.entertainmentLimit.toLocaleString("ko-KR")}`]).font = { bold: true };
  ent.addRow(["일자", "적요", "거래상대", "금액", "소스"]).font = { bold: true };
  const entDetail = rowsToObjects(
    await db.exec(
      `SELECT e.entry_date, e.description, e.party_name, l.debit, e.source_kind
         FROM journal_lines l JOIN journal_entries e ON e.entry_id = l.entry_id
        WHERE l.account_code = '813' AND l.debit > 0 AND e.status IN ('auto', 'confirmed') AND substr(e.entry_date, 1, 4) = $1
        ORDER BY e.entry_date`,
      [String(year)],
    ),
  );
  for (const r of entDetail) {
    ent.addRow([String(r.entry_date), String(r.description ?? ""), String(r.party_name ?? ""), Math.round(Number(r.debit || 0)), String(r.source_kind ?? "")]);
  }
  ent.columns.forEach((col, i) => (col.width = [12, 34, 20, 14, 12][i] ?? 12));
  ent.getColumn(4).numFmt = money;

  const tax = wb.addWorksheet("세무조정 후보");
  tax.addRow([`세무조정 후보 (${year}) — 자동 감지, 최종 판단은 신고 시 검토`]).font = { bold: true };
  tax.addRow(["규칙", "일자", "내용", "금액", "비고"]).font = { bold: true };
  for (const it of adj.items) tax.addRow([it.rule, it.entryDate, it.description, it.amount, it.note]);
  tax.columns.forEach((col, i) => (col.width = [18, 12, 40, 14, 44][i] ?? 14));
  tax.getColumn(4).numFmt = money;

  return Buffer.from(await wb.xlsx.writeBuffer());
}
