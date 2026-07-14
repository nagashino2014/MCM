import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listInvoiceRequestsMine } from "@/lib/home/invoice-requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** H10 — 내 참여 계약의 미발행 대금단위 트리(발행 요청 대상). */
export async function GET() {
  try {
    const ctx = await requireSession();
    const contracts = await listInvoiceRequestsMine(ctx.userId);
    return NextResponse.json({ contracts });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
