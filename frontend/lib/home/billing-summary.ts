/**
 * 홈 대시보드 "수금/발행 요약" 집계 (H7).
 * 최근 2개월(KST) 기준 발행/수금/미수금 건수·금액 KPI.
 * - 발행: invoice_issued=1 AND invoice_issued_at 이 cutoff 이후
 * - 수금: payment_collected=1 AND payment_collected_at 이 cutoff 이후
 * - 미수금: invoice_issued=1 AND payment_collected=0 (최근 2개월 발행분 중 미수). 잔액 = 발행액-수금액.
 * 금액 컬럼 관례: 발행 COALESCE(invoice_amount,amount,0) / 수금 COALESCE(collected_amount,amount,0).
 * RBAC 계약 스코프(contractIds)를 인자로 받아 필터한다(null=전체, []=없음).
 */
import { getDb, rowsToObjects } from "@/lib/db";

export interface BillingKpi {
  count: number;
  amount: number;
}
export interface BillingSummary {
  since: string; // 집계 시작일(YYYY-MM-DD, KST 2개월 전)
  issued: BillingKpi;
  collected: BillingKpi;
  unpaid: BillingKpi;
}

/** KST 기준 N개월 전 날짜(YYYY-MM-DD). 서버(UTC)에서 +9h 보정. */
function kstMonthsAgo(months: number): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

export async function getBillingSummary(contractIds: string[] | null): Promise<BillingSummary> {
  const since = kstMonthsAgo(2);
  const empty: BillingSummary = {
    since,
    issued: { count: 0, amount: 0 },
    collected: { count: 0, amount: 0 },
    unpaid: { count: 0, amount: 0 },
  };
  // 가시 계약이 명시적으로 0건이면 집계 불필요.
  if (Array.isArray(contractIds) && contractIds.length === 0) return empty;

  const db = await getDb();
  const params: unknown[] = [since];
  let scopeWhere = "";
  if (Array.isArray(contractIds)) {
    params.push(contractIds);
    scopeWhere = ` AND m.contract_id = ANY($${params.length})`;
  }

  const rows = rowsToObjects(
    await db.exec(
      `SELECT
         COUNT(*) FILTER (WHERE m.invoice_issued = 1 AND SUBSTRING(m.invoice_issued_at, 1, 10) >= $1) AS issued_cnt,
         COALESCE(SUM(COALESCE(m.invoice_amount, m.amount, 0))
           FILTER (WHERE m.invoice_issued = 1 AND SUBSTRING(m.invoice_issued_at, 1, 10) >= $1), 0) AS issued_amt,
         COUNT(*) FILTER (WHERE m.payment_collected = 1 AND SUBSTRING(m.payment_collected_at, 1, 10) >= $1) AS collected_cnt,
         COALESCE(SUM(COALESCE(m.collected_amount, m.amount, 0))
           FILTER (WHERE m.payment_collected = 1 AND SUBSTRING(m.payment_collected_at, 1, 10) >= $1), 0) AS collected_amt,
         COUNT(*) FILTER (WHERE m.invoice_issued = 1 AND m.payment_collected = 0 AND SUBSTRING(m.invoice_issued_at, 1, 10) >= $1) AS unpaid_cnt,
         COALESCE(SUM(GREATEST(0, COALESCE(m.invoice_amount, m.amount, 0) - COALESCE(m.collected_amount, 0)))
           FILTER (WHERE m.invoice_issued = 1 AND m.payment_collected = 0 AND SUBSTRING(m.invoice_issued_at, 1, 10) >= $1), 0) AS unpaid_amt
       FROM contract_payment_milestones m
       JOIN contracts c ON c.contract_id = m.contract_id AND c.deleted_at IS NULL
      WHERE TRUE${scopeWhere}`,
      params
    )
  );
  const r = rows[0] ?? {};
  const num = (v: unknown) => (v != null ? Number(v) : 0);
  return {
    since,
    issued: { count: num(r.issued_cnt), amount: num(r.issued_amt) },
    collected: { count: num(r.collected_cnt), amount: num(r.collected_amt) },
    unpaid: { count: num(r.unpaid_cnt), amount: num(r.unpaid_amt) },
  };
}
