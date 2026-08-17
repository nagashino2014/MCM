// 관리 손익·자금수지 (accounting-expansion 블루프린트 §5 P4)
// 원칙: 마이그 없음 — 전부 기존 데이터의 파생 조회다(U3·U5).
//  - 월별 손익: 전표 계층(P3, auto+confirmed)의 수익·비용 계정을 월별 피벗. 전표가 진실원본.
//  - 자금수지: 계좌 원장 잔액(실측) + 전표의 입출 실적 + 미수 계산서×결제주기 학습(P5 recon 재사용)으로
//    향후 3개월 전망. 유출 전망은 최근 3개월 월평균(급여·카드대금·경비가 계좌 출금에 모두 포함되므로
//    별도 소스 없이 강건 — 보수적 추정).

import { getDb, rowsToObjects } from "@/lib/db";
import { loadReceivables, loadPaymentCycles } from "@/lib/barobill/recon";

const KST_TODAY = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// ─────────────────────────────────────────────
// 월별 손익계산서
// ─────────────────────────────────────────────

export interface PnlRow {
  accountCode: string;
  name: string;
  acctType: "revenue" | "expense";
  byMonth: number[]; // 1~12월 발생액(수익=대변-차변, 비용=차변-대변)
  total: number;
}

export interface PnlResult {
  year: string;
  rows: PnlRow[];
  revenueByMonth: number[];
  expenseByMonth: number[];
  netByMonth: number[];
  revenueTotal: number;
  expenseTotal: number;
  netTotal: number;
  pendingCount: number; // 확정 필요 전표(손익 미포함) — 정확도 안내
}

export async function profitLoss(year: string): Promise<PnlResult> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT a.account_code, a.name, a.acct_type, a.sort_order,
              substr(e.entry_date, 6, 2) AS mm,
              SUM(l.debit) AS debit, SUM(l.credit) AS credit
         FROM journal_lines l
         JOIN journal_entries e ON e.entry_id = l.entry_id
         JOIN journal_accounts a ON a.account_code = l.account_code
        WHERE e.status IN ('auto', 'confirmed')
          AND a.acct_type IN ('revenue', 'expense')
          AND e.entry_date BETWEEN $1 AND $2
        GROUP BY a.account_code, a.name, a.acct_type, a.sort_order, substr(e.entry_date, 6, 2)
        ORDER BY a.sort_order`,
      [`${year}-01-01`, `${year}-12-31`],
    ),
  );
  const pending = rowsToObjects(
    await db.exec(
      `SELECT count(*) AS n FROM journal_entries WHERE status = 'pending' AND entry_date BETWEEN $1 AND $2`,
      [`${year}-01-01`, `${year}-12-31`],
    ),
  );

  const byAccount = new Map<string, PnlRow>();
  for (const r of rows) {
    const code = String(r.account_code);
    if (!byAccount.has(code)) {
      byAccount.set(code, {
        accountCode: code,
        name: String(r.name),
        acctType: String(r.acct_type) as "revenue" | "expense",
        byMonth: Array(12).fill(0),
        total: 0,
      });
    }
    const row = byAccount.get(code)!;
    const m = Number(r.mm) - 1;
    const debit = Number(r.debit ?? 0);
    const credit = Number(r.credit ?? 0);
    const amount = row.acctType === "revenue" ? credit - debit : debit - credit;
    row.byMonth[m] += amount;
    row.total += amount;
  }

  const out: PnlResult = {
    year,
    rows: [...byAccount.values()].filter((r) => r.total !== 0 || r.byMonth.some((v) => v !== 0)),
    revenueByMonth: Array(12).fill(0),
    expenseByMonth: Array(12).fill(0),
    netByMonth: Array(12).fill(0),
    revenueTotal: 0,
    expenseTotal: 0,
    netTotal: 0,
    pendingCount: Number(pending[0]?.n ?? 0),
  };
  for (const row of out.rows) {
    for (let m = 0; m < 12; m++) {
      if (row.acctType === "revenue") out.revenueByMonth[m] += row.byMonth[m];
      else out.expenseByMonth[m] += row.byMonth[m];
    }
    if (row.acctType === "revenue") out.revenueTotal += row.total;
    else out.expenseTotal += row.total;
  }
  for (let m = 0; m < 12; m++) out.netByMonth[m] = out.revenueByMonth[m] - out.expenseByMonth[m];
  out.netTotal = out.revenueTotal - out.expenseTotal;
  return out;
}

// ─────────────────────────────────────────────
// 자금수지 — 잔액 · 월별 실적 · 3개월 전망
// ─────────────────────────────────────────────

export interface CashAccountBalance {
  accountId: string;
  bankName: string;
  alias: string | null;
  balance: number;
  asOf: string; // 마지막 거래 일시
}

export interface CashMonthly {
  month: string; // YYYY-MM
  inflow: number;
  outflow: number;
  net: number;
  forecast: boolean;
  endBalance: number | null; // 전망 구간만 채움(기초잔액 누적)
}

export interface CashFlowResult {
  totalBalance: number;
  balances: CashAccountBalance[];
  today: { date: string; inflow: number; outflow: number };
  thisMonth: { inflow: number; outflow: number };
  receivableTotal: number; // 발행 미수 잔액 합
  receivableCount: number;
  avgMonthlyOut: number; // 최근 3개월 월평균 출금(전망에 사용)
  monthly: CashMonthly[]; // 실적 6개월 + 전망 3개월
  note: string;
}

const addMonths = (ym: string, n: number): string => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export async function cashFlow(): Promise<CashFlowResult> {
  const db = await getDb();
  const today = KST_TODAY();
  const thisMonth = today.slice(0, 7);

  // 계좌별 현재 잔액 = 계좌 마지막 거래의 잔액(원장 실측)
  const balanceRows = rowsToObjects(
    await db.exec(
      `SELECT a.account_id, a.bank_name, a.account_alias,
              (SELECT t.balance_after FROM bank_transactions t
                WHERE t.account_id = a.account_id ORDER BY t.txn_at DESC, t.txn_id DESC LIMIT 1) AS balance,
              (SELECT t.txn_at FROM bank_transactions t
                WHERE t.account_id = a.account_id ORDER BY t.txn_at DESC, t.txn_id DESC LIMIT 1) AS as_of
         FROM bank_accounts a WHERE a.is_active = 1`,
    ),
  );
  const balances: CashAccountBalance[] = balanceRows
    .filter((r) => r.balance != null)
    .map((r) => ({
      accountId: String(r.account_id),
      bankName: String(r.bank_name ?? ""),
      alias: r.account_alias ? String(r.account_alias) : null,
      balance: Number(r.balance),
      asOf: String(r.as_of ?? "").slice(0, 10),
    }));
  const totalBalance = balances.reduce((s, b) => s + b.balance, 0);

  // 월별 입출 실적 — 전표 기준(계좌간 이체(excluded) 제외, 확정 여부 무관: pending도 실제 입출금이다)
  const from6 = `${addMonths(thisMonth, -5)}-01`;
  const monthlyRows = rowsToObjects(
    await db.exec(
      `SELECT substr(e.entry_date, 1, 7) AS ym,
              SUM(CASE WHEN e.source_kind = 'bank_in' THEN
                    (SELECT l.debit FROM journal_lines l WHERE l.entry_id = e.entry_id AND l.account_code = '103' LIMIT 1)
                  ELSE 0 END) AS inflow,
              SUM(CASE WHEN e.source_kind = 'bank_out' THEN
                    (SELECT l.credit FROM journal_lines l WHERE l.entry_id = e.entry_id AND l.account_code = '103' LIMIT 1)
                  ELSE 0 END) AS outflow
         FROM journal_entries e
        WHERE e.source_kind IN ('bank_in', 'bank_out') AND e.status <> 'excluded'
          AND e.entry_date >= $1 AND e.entry_date <= $2
        GROUP BY substr(e.entry_date, 1, 7) ORDER BY 1`,
      [from6, today],
    ),
  );
  const actualByMonth = new Map(
    monthlyRows.map((r) => [String(r.ym), { inflow: Number(r.inflow ?? 0), outflow: Number(r.outflow ?? 0) }]),
  );

  // 오늘 입출(원장 직접 — 전표 재생성 이전이라도 정확)
  const todayRows = rowsToObjects(
    await db.exec(
      `SELECT direction, COALESCE(SUM(amount), 0) AS s FROM bank_transactions
        WHERE substr(txn_at, 1, 10) = $1 AND direction IN ('in', 'out') GROUP BY direction`,
      [today],
    ),
  );
  const todayIn = Number(todayRows.find((r) => String(r.direction) === "in")?.s ?? 0);
  const todayOut = Number(todayRows.find((r) => String(r.direction) === "out")?.s ?? 0);

  // 유입 전망 — 발행 미수 잔액 × 업체별 결제주기 학습(없으면 45일 기본)
  const receivables = (await loadReceivables(db)).filter((r) => !r.collected && r.remaining > 0);
  const cycles = await loadPaymentCycles(db);
  const DEFAULT_CYCLE_DAYS = 45;
  const expectedInByMonth = new Map<string, number>();
  let receivableTotal = 0;
  for (const r of receivables) {
    receivableTotal += r.remaining;
    const cycle = r.facilityId ? cycles.get(r.facilityId) : undefined;
    const base = r.invoicedAt && /^\d{4}-\d{2}-\d{2}/.test(r.invoicedAt) ? r.invoicedAt.slice(0, 10) : today;
    const expected = new Date(new Date(`${base}T00:00:00+09:00`).getTime() + (cycle?.avgDays ?? DEFAULT_CYCLE_DAYS) * 86400000);
    let ym = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, "0")}`;
    if (ym <= thisMonth) ym = addMonths(thisMonth, 1); // 지연·당월 예상분은 첫 전망 월에 배정(보수적)
    if (ym > addMonths(thisMonth, 3)) ym = addMonths(thisMonth, 3); // 3개월 창 밖은 마지막 전망 월에 표시
    expectedInByMonth.set(ym, (expectedInByMonth.get(ym) ?? 0) + r.remaining);
  }

  // 유출 전망 — 직전 3개 완결월 평균(급여·카드대금·경비가 계좌 출금에 모두 포함)
  const completeMonths = [addMonths(thisMonth, -3), addMonths(thisMonth, -2), addMonths(thisMonth, -1)];
  const outs = completeMonths.map((m) => actualByMonth.get(m)?.outflow ?? 0).filter((v) => v > 0);
  const avgMonthlyOut = outs.length ? Math.round(outs.reduce((s, v) => s + v, 0) / outs.length) : 0;

  // 월 시계열: 실적 6개월(이번 달 포함) + 전망 3개월(이번 달 잔여분부터)
  const monthly: CashMonthly[] = [];
  for (let i = -5; i <= 0; i++) {
    const ym = addMonths(thisMonth, i);
    const actual = actualByMonth.get(ym) ?? { inflow: 0, outflow: 0 };
    monthly.push({ month: ym, inflow: actual.inflow, outflow: actual.outflow, net: actual.inflow - actual.outflow, forecast: false, endBalance: null });
  }
  let projected = totalBalance;
  for (let i = 1; i <= 3; i++) {
    const fm = addMonths(thisMonth, i);
    const inflow = expectedInByMonth.get(fm) ?? 0;
    projected += inflow - avgMonthlyOut;
    monthly.push({ month: fm, inflow, outflow: avgMonthlyOut, net: inflow - avgMonthlyOut, forecast: true, endBalance: projected });
  }

  return {
    totalBalance,
    balances,
    today: { date: today, inflow: todayIn, outflow: todayOut },
    thisMonth: actualByMonth.get(thisMonth)
      ? { inflow: actualByMonth.get(thisMonth)!.inflow, outflow: actualByMonth.get(thisMonth)!.outflow }
      : { inflow: 0, outflow: 0 },
    receivableTotal,
    receivableCount: receivables.length,
    avgMonthlyOut,
    monthly,
    note:
      "전망 유입 = 발행 미수 계산서 × 업체별 결제주기 학습(미학습 45일) · 전망 유출 = 최근 3개월 월평균 출금. " +
      "계좌간 이체는 제외, 이미 지연된 미수는 이번 달에 배정한 보수적 추정입니다.",
  };
}
