import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { runRuleChecks } from "@/lib/approval/precheck";
import { runLlmCheck } from "@/lib/approval/precheck-llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST: 상신 전 사전검토. 규칙 엔진은 항상 실행. body.llm=true 면 LLM 보조 검토+유사 문서까지.
 * 규칙만 = 저비용(상신 클릭 시), LLM = "AI 검토" 버튼(§8-4).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { docId } = await params;
    const body = (await req.json().catch(() => ({}))) as { llm?: boolean };

    const rules = await runRuleChecks(docId);
    if (!body.llm) {
      return NextResponse.json({ findings: rules, similar: [], llmAvailable: null });
    }
    const llm = await runLlmCheck(docId);
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "approval_precheck_llm",
      targetTable: "approval_docs",
      targetId: docId,
      after: { findings: llm.findings.length, similar: llm.similar.length, available: llm.llmAvailable },
    });
    return NextResponse.json({
      findings: [...rules, ...llm.findings],
      similar: llm.similar,
      llmAvailable: llm.llmAvailable,
      llmError: llm.error ?? null,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
