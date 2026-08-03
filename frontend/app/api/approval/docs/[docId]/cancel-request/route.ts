import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { createCancelRequest } from "@/lib/approval/cancel";
import { notifyCancelRequested } from "@/lib/approval/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 반려 요청(취소 요청) — 기안자 본인이 진행중·승인완료 휴가/출장/교육 문서에.
// 진행중이면 pending 결재자들에게, 승인완료면 관리자에게 3채널 알림이 나간다.
export async function POST(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { docId } = await params;
    const body = (await req.json()) as { reason?: string };
    const { request, docStatus } = await createCancelRequest({
      docId,
      userId: ctx.userId,
      reason: String(body.reason ?? ""),
    });
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "approval_cancel_request",
      targetTable: "approval_docs",
      targetId: docId,
      after: { requestId: request.requestId, docStatus },
    });
    // 커밋 후 fire-and-forget — 알림 실패가 요청 등록을 막지 않는다(notify 내부 try/catch).
    void notifyCancelRequested({ docId, requestId: request.requestId, reason: request.reason, docStatus });
    return NextResponse.json({ ok: true, request, docStatus });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status: 400 });
    return authErrorToResponse(err);
  }
}
