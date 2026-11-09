import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getOpenCancelRequest } from "@/lib/approval/cancel";
import { adminCancelDoc } from "@/lib/approval/admin-controls";
import { notifyDocCanceled } from "@/lib/approval/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { reason }: 결재 취소(관리자, 346) — 승인 완료 문서를 사유와 함께 canceled 로 전이한다(삭제 아님).
// 번호는 반납해 다음 상신이 이어받고(원래 번호는 기록), 휴가면 연차 대장을 회수한다. 감사 로그는 트랜잭션 안에서 남긴다.
// 기안자의 반려 요청(124)이 있으면 함께 마감한다. 조건부 UPDATE 라 이중 호출 시 2회차는 오류(멱등). 완료 후 기안자에게 알림.
export async function POST(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const ctx = await requirePermission("approval.manage");
    const { docId } = await params;
    const body = (await req.json().catch(() => ({}))) as { reason?: string };
    const reason = String(body.reason ?? "").trim();
    // 알림 dedup 키에 쓸 요청 id — 취소 트랜잭션이 요청을 resolved 로 바꾸므로 먼저 읽는다.
    const openRequest = await getOpenCancelRequest(docId);
    const result = await adminCancelDoc({ docId, actorUserId: ctx.userId, reason, requestId: openRequest?.requestId ?? null });
    void notifyDocCanceled(docId, openRequest?.requestId ?? "direct", { reason, originalDocNo: result.originalDocNo });
    return NextResponse.json({ ok: true, ledgerReversed: result.ledgerReversed, releasedDocNo: result.releasedDocNo });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    const status = (err as { status?: number })?.status;
    if (err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status: status ?? 400 });
    return authErrorToResponse(err);
  }
}
