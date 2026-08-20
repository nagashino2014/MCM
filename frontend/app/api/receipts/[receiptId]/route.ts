import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deleteReceipt, updateReceipt } from "@/lib/finance/receipts";
import { normalizePaidAt } from "@/lib/finance/receipt-parser";

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
      storeCorpNum?: string | null;
      totalAmount?: number;
      excluded?: boolean;
      memo?: string | null;
    };
    // 저장 계약은 POST 와 동일 — 수정 입력도 정규화해서 넣는다(미해석 시 날짜 미상으로).
    if (body.paidAt !== undefined) body.paidAt = normalizePaidAt(body.paidAt ?? null);
    // 사업자번호는 숫자만 남겨 저장한다(표시 하이픈은 화면 몫) — 분류 학습 키와 형식을 맞춘다.
    if (body.storeCorpNum !== undefined) {
      const digits = (body.storeCorpNum ?? "").replace(/[^0-9]/g, "");
      if (digits && digits.length !== 10) {
        return NextResponse.json({ error: "사업자번호는 10자리입니다." }, { status: 400 });
      }
      body.storeCorpNum = digits || null;
    }
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
