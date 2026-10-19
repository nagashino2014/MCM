import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { requireBillingScope } from "@/lib/auth/billing-scope";
import { getDb, rowsToObjects } from "@/lib/db";
import { getContractOrdersStatus } from "@/lib/ieps/contracts";
import { getContractReceivablesStatus } from "@/lib/ieps/receivables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 부서 수주·수금 현황 요약(299) — 부서장 전용 화면 상단 4칸.
 *   수주액  = 수주 탭과 같은 함수(getContractOrdersStatus)의 해당 연도 합계
 *   발행액  = 해당 연도 계산서 발행분 합계(발행금액 우선)
 *   수금액  = 해당 연도 수금분 합계(수금액 우선)
 *   미수금  = 미수금 탭과 같은 함수(getContractReceivablesStatus)의 잔액 합계(연도 무관, 현재 시점)
 * 범위 = 수행부서가 선택 부서인 계약만(requireBillingScope scope=dept).
 */
export async function GET(req: NextRequest) {
  try {
    const sp = new URLSearchParams(req.nextUrl.searchParams);
    sp.set("scope", "dept");
    const { ids, dept, depts } = await requireBillingScope(sp);
    const year = /^\d{4}$/.test(sp.get("year") ?? "") ? String(sp.get("year")) : String(new Date().getFullYear());
    const scopeIds = ids ?? [];

    const [orders, receivables] = await Promise.all([
      getContractOrdersStatus(year, scopeIds),
      getContractReceivablesStatus(scopeIds),
    ]);

    let issued = { count: 0, amount: 0 };
    let collected = { count: 0, amount: 0 };
    if (scopeIds.length) {
      const db = await getDb();
      const r = rowsToObjects(
        await db.exec(
          `SELECT
             COUNT(*) FILTER (WHERE m.invoice_issued = 1 AND SUBSTRING(m.invoice_issued_at, 1, 4) = $2) AS issued_cnt,
             COALESCE(SUM(COALESCE(m.invoice_amount, m.amount, 0))
               FILTER (WHERE m.invoice_issued = 1 AND SUBSTRING(m.invoice_issued_at, 1, 4) = $2), 0) AS issued_amt,
             COUNT(*) FILTER (WHERE m.payment_collected = 1 AND SUBSTRING(m.payment_collected_at, 1, 4) = $2) AS collected_cnt,
             COALESCE(SUM(COALESCE(m.collected_amount, m.amount, 0))
               FILTER (WHERE m.payment_collected = 1 AND SUBSTRING(m.payment_collected_at, 1, 4) = $2), 0) AS collected_amt
             FROM contract_payment_milestones m
            WHERE m.contract_id = ANY($1::text[])`,
          [scopeIds, year]
        )
      )[0] ?? {};
      issued = { count: Number(r.issued_cnt ?? 0), amount: Number(r.issued_amt ?? 0) };
      collected = { count: Number(r.collected_cnt ?? 0), amount: Number(r.collected_amt ?? 0) };
    }

    const orderRows = orders.rows;
    return NextResponse.json({
      dept,
      depts,
      year,
      availableYears: orders.availableYears,
      contractCount: scopeIds.length,
      kpi: {
        orders: { count: orderRows.length, amount: orderRows.reduce((s, row) => s + (row.amount ?? 0), 0) },
        issued,
        collected,
        outstanding: {
          count: receivables.rows.length,
          amount: receivables.rows.reduce((s, row) => s + (row.outstandingAmount ?? 0), 0),
        },
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
