import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createEndpoint, listEndpoints } from "@/lib/scraper/sources-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ sourceId: string }>;
}

export async function GET(_: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { sourceId } = await ctx.params;
    return NextResponse.json({ endpoints: await listEndpoints(sourceId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 엔드포인트 생성(analyze proposal 의 api_config/field_mapping 커밋 포함). */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { sourceId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim() || "기본 엔드포인트";
    const endpoint = await createEndpoint({
      sourceId,
      name,
      apiConfig: body?.apiConfig ?? null,
      fieldMapping: body?.fieldMapping ?? {},
      sinkConfig: body?.sinkConfig ?? null,
    });
    return NextResponse.json({ endpoint });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
