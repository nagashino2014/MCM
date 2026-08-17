import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deleteReceipt, updateReceipt } from "@/lib/finance/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH: 본인 영수증 수정 — 내용(일시·상호·금액)은 미귀속만, 제외/메모는 언제나.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ receiptId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { receiptId } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      paidAt?: string | null;
      storeName?: string | null;
      totalAmount?: number;
      excluded?: boolean;
      memo?: string | null;
    };
    await updateReceipt(receiptId, ctx.userId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 본인·미귀속 영수증 삭제(스토리지 정리 포함).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ receiptId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { receiptId } = await params;
    await deleteReceipt(receiptId, ctx.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
