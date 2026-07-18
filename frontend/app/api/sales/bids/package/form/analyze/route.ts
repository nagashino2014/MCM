import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { analyzeFormProfile } from "@/lib/bid/form-analyze";
import { LlmError } from "@/lib/ai/llm-json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST: 발주처 양식(HWPX) LLM 분석 → 표준 문서 타입·셀 매핑(form_profile) 생성·저장
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as { formId?: string };
    const formId = String(body.formId ?? "");
    if (!formId) {
      return NextResponse.json({ error: "formId 가 필요합니다." }, { status: 400 });
    }
    const profile = await analyzeFormProfile(formId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "bid_package_forms",
      targetId: formId,
      after: { kind: "form_profile", documents: profile.documents.length },
    });
    return NextResponse.json({ profile });
  } catch (err) {
    if (err instanceof LlmError) {
      const msg = err.message === "llm_not_configured"
        ? "LLM 분석이 설정되지 않았습니다(ANTHROPIC_API_KEY)."
        : `양식 분석 실패: ${err.message}`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    return authErrorToResponse(err);
  }
}
