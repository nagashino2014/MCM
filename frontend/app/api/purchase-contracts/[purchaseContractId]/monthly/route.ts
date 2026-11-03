import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { isPurchaseMonthlyKind, monthlyKindFor } from "@/lib/contracts/purchase/options";
import { listMonthlyAmounts, upsertMonthlyAmounts, type MonthlyUpsertRow } from "@/lib/contracts/purchase/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ purchaseContractId: string }>;
}

const parseYear = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
};

/** 월별 금액 조회(333) — ?kind=extra_spend|metered|management_fee&year=YYYY. 12칸 + 연도별 합계. */
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    await requirePermission("purchase.view");
    const kind = req.nextUrl.searchParams.get("kind");
    const year = parseYear(req.nextUrl.searchParams.get("year")) ?? new Date().getFullYear();
    if (!isPurchaseMonthlyKind(kind)) return NextResponse.json({ error: "kind 가 올바르지 않습니다." }, { status: 400 });
    return NextResponse.json(await listMonthlyAmounts(purchaseContractId, kind, year));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/**
 * 월별 금액 저장 — { kind, year, months: [{ month, amount, purpose? }] }. 한 해 단위 upsert(빈 칸은 행 삭제).
 * kind 는 계약 유형과 맞아야 한다(정기 구독=추가 지출, 임대=종량제, 관리=관리비).
 */
export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    const actor = await requirePermission("purchase.edit");
    const body = (await req.json().catch(() => ({}))) as { kind?: unknown; year?: unknown; months?: unknown };
    const kind = body.kind;
    const year = parseYear(body.year);
    if (!isPurchaseMonthlyKind(kind)) return NextResponse.json({ error: "kind 가 올바르지 않습니다." }, { status: 400 });
    if (!year) return NextResponse.json({ error: "연도가 올바르지 않습니다." }, { status: 400 });
    const rows: MonthlyUpsertRow[] = Array.isArray(body.months)
      ? body.months.map((m) => {
          const r = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
          const amountRaw = r.amount;
          const amount = amountRaw == null || amountRaw === "" ? null : Number(String(amountRaw).replace(/,/g, ""));
          return { month: Number(r.month), amount: amount != null && Number.isFinite(amount) ? amount : null, purpose: r.purpose == null ? null : String(r.purpose) };
        })
      : [];

    const db = await getDb();
    const head = rowsToObjects(
      await db.exec(`SELECT contract_type FROM purchase_contracts WHERE purchase_contract_id = $1 AND deleted_at IS NULL`, [purchaseContractId])
    )[0];
    if (!head) return NextResponse.json({ error: "매입 계약을 찾을 수 없습니다." }, { status: 404 });
    if (monthlyKindFor(String(head.contract_type)) !== kind) {
      return NextResponse.json({ error: "이 계약 유형에서는 해당 월별 금액을 쓸 수 없습니다." }, { status: 400 });
    }
    const now = new Date().toISOString();
    await withDbWrite(async (txn) => {
      await upsertMonthlyAmounts(txn, purchaseContractId, kind, year, rows, now);
      await recordAuditLogInline(txn, {
        actorUserId: actor.userId,
        action: "purchase_contract_monthly_update",
        targetTable: "purchase_contract_monthly_amounts",
        targetId: purchaseContractId,
        after: { kind, year, months: rows },
      });
    });
    return NextResponse.json(await listMonthlyAmounts(purchaseContractId, kind, year));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
