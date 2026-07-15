import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deleteEndpoint, updateEndpoint } from "@/lib/scraper/sources-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ sourceId: string; endpointId: string }>;
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { endpointId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    await updateEndpoint(endpointId, {
      name: body?.name,
      apiConfig: body?.apiConfig,
      fieldMapping: body?.fieldMapping,
      sinkConfig: body?.sinkConfig,
      enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { endpointId } = await ctx.params;
    await deleteEndpoint(endpointId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
