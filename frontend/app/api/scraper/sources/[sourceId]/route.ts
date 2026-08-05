import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deleteSource, getSource, listEndpoints, updateSource } from "@/lib/scraper/sources-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ sourceId: string }>;
}

/** 소스 상세 + 엔드포인트 목록. */
export async function GET(_: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { sourceId } = await ctx.params;
    const source = await getSource(sourceId);
    if (!source) return NextResponse.json({ error: "소스를 찾을 수 없습니다." }, { status: 404 });
    const endpoints = await listEndpoints(sourceId);
    return NextResponse.json({ source, endpoints });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 소스 수정(name/baseUrl/apiProfile/enabled). analyze proposal 커밋도 여기(apiProfile). */
export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { sourceId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    await updateSource(
      sourceId,
      {
        name: body?.name,
        baseUrl: body?.baseUrl,
        apiProfile: body?.apiProfile,
        enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
        batchHour: body?.batchHour === null || typeof body?.batchHour === "number" ? body.batchHour : undefined,
        authSecret: body?.authSecret,
      },
      actor.userId
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { sourceId } = await ctx.params;
    await deleteSource(sourceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
