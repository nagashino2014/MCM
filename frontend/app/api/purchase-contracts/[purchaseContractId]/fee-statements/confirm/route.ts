import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { listMonthlyAmounts, upsertMonthlyAmounts } from "@/lib/contracts/purchase/queries";
import { normalizeFeeStatementDetail } from "@/lib/contracts/purchase/type-details";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ purchaseContractId: string }>;
}

/**
 * 관리비 명세서 확정(333) — 미리보기에서 사용자가 확인·수정한 { documentId, year, month, amount, detail } 로
 * management_fee 월별 행을 만들고 명세서 문서를 연결한다. 같은 달에 이미 행이 있으면 덮어쓴다.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    const actor = await requirePermission("purchase.edit");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const year = Number(body.year);
    const month = Number(body.month);
    const documentId = String(body.documentId ?? "").trim() || null;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ error: "연도가 올바르지 않습니다." }, { status: 400 });
    if (!Number.isInteger(month) || month < 1 || month > 12) return NextResponse.json({ error: "월이 올바르지 않습니다." }, { status: 400 });
    const amountRaw = body.amount;
    const amount = amountRaw == null || amountRaw === "" ? null : Number(String(amountRaw).replace(/,/g, ""));
    if (amount == null || !Number.isFinite(amount)) return NextResponse.json({ error: "납기내 금액을 입력해 주세요." }, { status: 400 });
    const detail = normalizeFeeStatementDetail(body.detail);
    detail.amountDue = amount;

    const db = await getDb();
    const head = rowsToObjects(
      await db.exec(`SELECT contract_type FROM purchase_contracts WHERE purchase_contract_id = $1 AND deleted_at IS NULL`, [purchaseContractId])
    )[0];
    if (!head) return NextResponse.json({ error: "매입 계약을 찾을 수 없습니다." }, { status: 404 });
    if (String(head.contract_type) !== "management") return NextResponse.json({ error: "관리 계약에서만 확정할 수 있습니다." }, { status: 400 });
    if (documentId) {
      const doc = rowsToObjects(
        await db.exec(`SELECT document_id FROM purchase_contract_documents WHERE document_id = $1 AND purchase_contract_id = $2`, [documentId, purchaseContractId])
      )[0];
      if (!doc) return NextResponse.json({ error: "명세서 문서를 찾을 수 없습니다." }, { status: 400 });
    }
    const now = new Date().toISOString();
    await withDbWrite(async (txn) => {
      await upsertMonthlyAmounts(txn, purchaseContractId, "management_fee", year, [{ month, amount, detail: detail as unknown as Record<string, unknown>, documentId }], now);
      await recordAuditLogInline(txn, {
        actorUserId: actor.userId,
        action: "purchase_contract_monthly_update",
        targetTable: "purchase_contract_monthly_amounts",
        targetId: purchaseContractId,
        after: { kind: "management_fee", year, month, amount, documentId, items: detail.items.length },
      });
    });
    return NextResponse.json(await listMonthlyAmounts(purchaseContractId, "management_fee", year));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
