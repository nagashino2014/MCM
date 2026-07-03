import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listFacilityProjectHistory } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("sales.view");
    const { id } = await ctx.params;
    const items = await listFacilityProjectHistory(id);
    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
