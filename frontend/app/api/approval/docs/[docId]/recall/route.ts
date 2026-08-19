import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { recordAuditLog } from "@/lib/auth/audit";
import { recallLetterDoc } from "@/lib/approval/docs";
import { reopenDeliverablesForLetter } from "@/lib/deliverable/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 승인 공문 회수(2026-08-19) — 수정 후 재발송 플로우의 진입점.
// 승인 문서를 draft 로 되돌린다(문서번호 유지). 작성 화면에서 수정 → 재상신 → 재결재
// 승인 시 자동 2차 발송(발송 이력 N차 누적). 기안자 본인 또는 approval.manage.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { docId } = await params;
    await recallLetterDoc(docId, ctx.userId, await hasPermission(ctx.userId, "approval.manage"));
    // 착수계·준공계 연계 공문이면 서류도 다시 열어 준다(sent 잠금 해제) — 회수의 핵심은
    // 첨부 서류(준공계 등) 재작성이라 프론트가 이 목록으로 작성 화면으로 안내한다.
    const deliverables = await reopenDeliverablesForLetter(docId);
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "approval_doc_recall",
      targetTable: "approval_docs",
      targetId: docId,
      after: { reason: "수정 후 재발송(회수)" },
    });
    return NextResponse.json({ ok: true, deliverables });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
