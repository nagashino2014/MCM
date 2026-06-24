import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { applyPresetToContract } from "@/lib/contracts/process-stage-presets";
import { listContractStages } from "@/lib/contracts/process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

// 프리셋을 계약 공정표로 적용(기존 공정표 교체).
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
    const body = (await req.json()) as { presetId?: string };
    if (!body.presetId) {
      return NextResponse.json({ error: "presetId가 필요합니다." }, { status: 400 });
    }
    await applyPresetToContract(contractId, body.presetId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "contract_process_stages",
      targetId: contractId,
      after: { presetId: body.presetId },
    });
    return NextResponse.json({ stages: await listContractStages(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
