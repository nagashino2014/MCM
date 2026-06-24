import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requireEditor } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  listContractStages,
  saveContractStages,
  type ContractStageInput,
} from "@/lib/contracts/process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { contractId } = await ctx.params;
    return NextResponse.json({ stages: await listContractStages(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
    const body = (await req.json()) as { stages?: ContractStageInput[] };
    const stages = Array.isArray(body.stages) ? body.stages : [];
    await saveContractStages(contractId, stages);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "contract_process_stages",
      targetId: contractId,
      after: { count: stages.length },
    });
    return NextResponse.json({ stages: await listContractStages(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
