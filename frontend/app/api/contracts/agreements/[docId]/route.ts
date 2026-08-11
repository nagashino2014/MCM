import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { deleteDoc, getDoc } from "@/lib/approval/docs";
import { recordAuditLog } from "@/lib/auth/audit";
import { deleteAgreement } from "@/lib/agreement/store";
import { AGREEMENT_FORM_ID } from "@/lib/agreement/types";

// DELETE: 계약서 삭제 — 대장(contract_agreements) + 전자결재 문서를 함께 지운다
// (2026-08-11 사용자 요청: 목록에서 한 번에 삭제. 테스트 발송분·폐기 건 정리용).
// 승인 완료 건도 지울 수 있어야 하므로 approval.manage 권한을 요구한다
// (기안자 본인의 작성중·반려 문서는 전자결재 화면의 기존 삭제 버튼으로도 가능).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const actor = await requirePermission("contract.view");
    const { docId } = await params;
    const doc = await getDoc(docId);
    if (!doc) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    if (doc.formId !== AGREEMENT_FORM_ID) {
      return NextResponse.json({ error: "계약서 문서가 아닙니다." }, { status: 400 });
    }
    const isManager = await hasPermission(actor.userId, "approval.manage");
    const isOwnDraft = doc.drafterUserId === actor.userId && ["draft", "rejected"].includes(doc.status);
    if (!isManager && !isOwnDraft) {
      return NextResponse.json(
        { error: "결재가 진행 중이거나 완료된 계약서는 관리자만 삭제할 수 있습니다." },
        { status: 403 }
      );
    }

    await deleteAgreement(docId); // 대장 먼저(문서 삭제 후엔 조회 근거가 사라진다)
    const removed = await deleteDoc(docId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_doc_delete", // 문서 삭제와 같은 계열(계약서 대장 동반 삭제)
      targetTable: "contract_agreements",
      targetId: docId,
      after: { docNo: removed.docNo, title: removed.title },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
