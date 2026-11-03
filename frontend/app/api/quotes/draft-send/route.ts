import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { prepareDraftSend } from "@/lib/approval/docs";
import { processQuoteSend } from "@/lib/quote/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST: 견적 초안 송부(336, 2026-11-03) — 결재 없이 기안자 본인이 보낸다. body { docId }.
// 견적번호 채번·대장 등록 → 산출물 생성 → (mail 모드) 참조 담당자 메일 발송 / (direct 모드) PDF 생성까지.
// 성공하면 그 버전이 잠기고(수정은 재견적), 실패하면 잠기지 않아 고쳐서 다시 보낼 수 있다.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const body = (await req.json().catch(() => ({}))) as { docId?: string };
    const docId = String(body.docId ?? "").trim();
    if (!docId) return NextResponse.json({ error: "docId 가 필요합니다." }, { status: 400 });
    const { docNo } = await prepareDraftSend(docId, ctx.userId);
    const result = await processQuoteSend(docId);
    if (!result.ok) return NextResponse.json({ error: result.error ?? "송부 실패", docNo }, { status: 500 });
    if (result.skipped) return NextResponse.json({ error: "이미 송부 처리 중입니다 — 잠시 후 다시 확인하세요.", docNo }, { status: 409 });
    return NextResponse.json({ ok: true, docNo });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
