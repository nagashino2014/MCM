import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
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
    const { contractId } = await ctx.params;
    await requirePermission("contract.view", { target: { contractId } });
    return NextResponse.json({ stages: await listContractStages(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
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
