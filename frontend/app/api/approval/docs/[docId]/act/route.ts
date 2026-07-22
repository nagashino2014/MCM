import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { actOnDoc } from "@/lib/approval/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ActBody {
  stepId?: string;
  action?: "approve" | "reject";
  comment?: string | null;
}

// POST: 승인/반려 — 본인 pending 단계에만 허용(코어에서 검증)
export async function POST(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const ctx = await requirePermission("approval.act", { fallbackRoles: ["viewer", "editor"] });
    const { docId } = await params;
    const body = (await req.json().catch(() => ({}))) as ActBody;
    if (!body.stepId || !body.action || !["approve", "reject"].includes(body.action)) {
      return NextResponse.json({ error: "stepId/action 이 필요합니다." }, { status: 400 });
    }
    if (body.action === "reject" && !String(body.comment ?? "").trim()) {
      return NextResponse.json({ error: "반려 사유를 입력하세요." }, { status: 400 });
    }
    const res = await actOnDoc({
      docId,
      stepId: body.stepId,
      action: body.action,
      comment: body.comment ?? null,
      actorUserId: ctx.userId,
    });
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "approval_doc_act",
      targetTable: "approval_docs",
      targetId: docId,
      after: { action: body.action, docStatus: res.docStatus },
    });
    return NextResponse.json({ docStatus: res.docStatus });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
