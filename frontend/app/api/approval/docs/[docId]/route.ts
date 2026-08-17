import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { recordAuditLog } from "@/lib/auth/audit";
import { deleteDoc, getDoc, markWatcherRead } from "@/lib/approval/docs";
import { unlinkDocCards } from "@/lib/barobill/classify";
import { unlinkDocReceipts } from "@/lib/finance/receipts";
import { resolveDocAccess } from "@/lib/approval/access";
import { CANCELABLE_FORM_IDS, getOpenCancelRequest } from "@/lib/approval/cancel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 문서 상세 — 제출 당시 양식 버전 fields + 결재선 진행 상태 포함
export async function GET(_req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { docId } = await params;
    const doc = await getDoc(docId);
    if (!doc) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    // 접근 범위 판정은 첨부 미리보기와 공용(lib/approval/access.ts).
    const { allowed, isWatcher, isManager } = await resolveDocAccess(doc, ctx.userId);
    if (!allowed) {
      return NextResponse.json({ error: "이 문서를 열람할 권한이 없습니다." }, { status: 403 });
    }
    if (isWatcher) await markWatcherRead(docId, ctx.userId);
    const myStep = doc.steps.find((s) => s.assigneeUserId === ctx.userId && s.status === "pending");
    // 반려 요청(취소 요청, 124) — 배지 표시·버튼 노출 판정용.
    const cancelRequest = await getOpenCancelRequest(docId);
    const cancelable = (CANCELABLE_FORM_IDS as readonly string[]).includes(doc.formId);
    const canRequestCancel =
      cancelable && doc.drafterUserId === ctx.userId && ["in_progress", "approved"].includes(doc.status) && !cancelRequest;
    const canCancel = doc.status === "approved" && cancelRequest != null && isManager;
    // 이어 작성·재기안 — 본인 기안의 작성중/반려 문서(saveDoc·submitDoc 의 허용 범위와 동일).
    const isOwnEditable = doc.drafterUserId === ctx.userId && ["draft", "rejected"].includes(doc.status);
    const canEdit = isOwnEditable;
    // 문서 삭제 — 관리자는 승인 완료 포함 전 상태(테스트·오기안 정리),
    // 기안자는 아직 결재가 걸려 있지 않은 본인 문서(작성중·반려)만.
    const canDelete = isManager || isOwnEditable;
    return NextResponse.json({
      doc: { ...doc, myStepId: myStep?.stepId ?? null, cancelRequest, canRequestCancel, canCancel, canEdit, canDelete },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 문서 완전 삭제.
// - 결재 운영 권한(approval.manage): 승인 완료 포함 전 상태(테스트 문서 정리). 연차 차감 이력도 함께 제거(잔여 복원).
// - 기안자 본인: 아직 결재선을 타지 않은 작성중·반려 문서만(오기안 정리·재기안 포기).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const actor = await requirePermission("approval.view");
    const { docId } = await params;
    const isManager = await hasPermission(actor.userId, "approval.manage");
    if (!isManager) {
      const doc = await getDoc(docId);
      if (!doc) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
      if (doc.drafterUserId !== actor.userId) {
        return NextResponse.json({ error: "본인이 기안한 문서만 삭제할 수 있습니다." }, { status: 403 });
      }
      if (!["draft", "rejected"].includes(doc.status)) {
        return NextResponse.json(
          { error: "결재가 진행 중이거나 완료된 문서는 삭제할 수 없습니다. 반려 요청으로 처리하세요." },
          { status: 400 }
        );
      }
    }
    const removed = await deleteDoc(docId);
    // 법인카드 사용건 귀속 해제(P1) — 삭제된 문서에 묶인 매입건을 다시 선택 가능 상태로.
    try {
      await unlinkDocCards(docId);
    } catch (err) {
      console.error("[approval/docs] 카드 사용건 해제 실패:", err);
    }
    // 개인카드 영수증 귀속 해제(accounting-expansion P1).
    try {
      await unlinkDocReceipts(docId);
    } catch (err) {
      console.error("[approval/docs] 영수증 해제 실패:", err);
    }
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_doc_delete",
      targetTable: "approval_docs",
      targetId: docId,
      after: { docNo: removed.docNo, title: removed.title },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
