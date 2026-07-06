import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { linkSignalFacility, updateSignalStatus } from "@/lib/intel/intel-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ signalId: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { signalId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { status?: string; facilityId?: string };
    if (body.facilityId) await linkSignalFacility(signalId, String(body.facilityId));
    if (body.status && ["new", "reviewed", "dismissed"].includes(body.status)) {
      await updateSignalStatus(signalId, body.status as "new" | "reviewed" | "dismissed");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
