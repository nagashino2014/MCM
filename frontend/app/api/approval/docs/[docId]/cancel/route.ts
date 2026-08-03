import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { cancelApprovedDoc, getOpenCancelRequest } from "@/lib/approval/cancel";
import { notifyDocCanceled } from "@/lib/approval/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 결재 취소(관리자) — 승인 완료 문서를 canceled 로 전이하고 휴가면 연차 대장을 회수한다.
// 조건부 UPDATE 라 이중 호출 시 2회차는 오류(멱등). 완료 후 기안자에게 알림.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const ctx = await requirePermission("approval.manage");
    const { docId } = await params;
    // 알림 dedup 키에 쓸 요청 id — 취소 트랜잭션이 요청을 resolved 로 바꾸므로 먼저 읽는다.
    const openRequest = await getOpenCancelRequest(docId);
    const result = await cancelApprovedDoc({ docId, actorUserId: ctx.userId });
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "approval_doc_cancel",
      targetTable: "approval_docs",
      targetId: docId,
      after: { ledgerReversed: result.ledgerReversed, requestId: openRequest?.requestId ?? null },
    });
    void notifyDocCanceled(docId, openRequest?.requestId ?? "direct");
    return NextResponse.json({ ok: true, ledgerReversed: result.ledgerReversed });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status: 400 });
    return authErrorToResponse(err);
  }
}
