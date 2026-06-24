import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listContractsForTreeByFacility } from "@/lib/ieps/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("facility.view");
    const { id } = await ctx.params;
    return NextResponse.json(await listContractsForTreeByFacility(id));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
