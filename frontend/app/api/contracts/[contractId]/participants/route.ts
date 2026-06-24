import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requireEditor } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  listContractParticipants,
  saveContractParticipants,
  type ServiceParticipantInput,
} from "@/lib/staffing/participants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { contractId } = await ctx.params;
    return NextResponse.json({ participants: await listContractParticipants(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
    const body = (await req.json()) as { participants?: ServiceParticipantInput[] };
    const items = Array.isArray(body.participants) ? body.participants : [];
    await saveContractParticipants(contractId, items);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "service_participants",
      targetId: contractId,
      after: { count: items.length },
    });
    return NextResponse.json({ participants: await listContractParticipants(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
