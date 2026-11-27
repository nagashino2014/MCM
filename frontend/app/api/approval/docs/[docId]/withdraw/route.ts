import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withdrawDoc } from "@/lib/approval/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 상신 취소(기안자, 2026-11-27 직원 요청 31) — 결재 중인 본인 기안을 작성중으로 되돌린다.
// 아직 아무 결재자도 승인·반려하지 않은 문서만. 문서번호는 유지되고, 고친 뒤 다시 상신하면 결재가 처음부터 시작된다.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { docId } = await params;
    const result = await withdrawDoc(docId, ctx.userId);
    return NextResponse.json({ ok: true, docNo: result.docNo });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    const status = (err as { status?: number })?.status;
    if (err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status: status ?? 400 });
    return authErrorToResponse(err);
  }
}
