import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { convertSignalToProject } from "@/lib/intel/intel-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ signalId: string }>;
}

export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { signalId } = await ctx.params;
    const projectId = await convertSignalToProject(signalId, actor.userId || null);
    return NextResponse.json({ projectId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
