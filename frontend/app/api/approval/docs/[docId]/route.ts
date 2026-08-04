import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { recordAuditLog } from "@/lib/auth/audit";
import { deleteDoc, getDoc, getUserDeptId, markWatcherRead } from "@/lib/approval/docs";
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
    // 접근 범위: 기안자·결재선 관계자·admin + 문서함 공개 범위 —
    // 전사 문서함 지정 양식의 승인 문서는 전 직원, 완료 문서는 같은 부서까지 열람 허용.
    const involved =
      doc.drafterUserId === ctx.userId || doc.steps.some((s) => s.assigneeUserId === ctx.userId || s.delegatedFrom === ctx.userId);
    const isWatcher = doc.watchers.some((w) => w.userId === ctx.userId);
    // 관계자가 아니어도 결재 운영 권한(approval.manage)이 있으면 열람 가능.
    const isManager = await hasPermission(ctx.userId, "approval.manage");
    let allowed = involved || isWatcher || isManager;
    if (!allowed && doc.status === "approved" && doc.orgFolder) allowed = true;
    if (!allowed && ["approved", "rejected"].includes(doc.status) && doc.deptId) {
      const myDept = await getUserDeptId(ctx.userId);
      if (myDept && myDept === doc.deptId) allowed = true;
    }
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
    // 문서 삭제(관리자) — 승인 완료 포함 전 상태. 테스트·오기안 문서 정리용.
    const canDelete = isManager;
    return NextResponse.json({
      doc: { ...doc, myStepId: myStep?.stepId ?? null, cancelRequest, canRequestCancel, canCancel, canDelete },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 문서 완전 삭제 — 결재 운영 권한(approval.manage) 전용.
// 승인 완료 문서 포함 전 상태 삭제 가능(테스트 문서 정리). 연차 차감 이력도 함께 제거(잔여 복원).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const { docId } = await params;
    const removed = await deleteDoc(docId);
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
