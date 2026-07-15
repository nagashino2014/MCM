import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getEndpoint, getSource } from "@/lib/scraper/sources-store";
import { collectCustomSource } from "@/lib/intel/custom-sink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface Ctx {
  params: Promise<{ sourceId: string; endpointId: string }>;
}

/**
 * 엔드포인트 실행 — 기본은 미리보기(preview:true, 적재 안 함). body.preview=false 면 실적재.
 * intel sink(collectCustomSource)로 위임. (2차: purpose=bid 는 bid sink로 분기.)
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { sourceId, endpointId } = await ctx.params;
    const source = await getSource(sourceId);
    const endpoint = await getEndpoint(endpointId);
    if (!source || !endpoint || endpoint.sourceId !== sourceId) {
      return NextResponse.json({ error: "소스/엔드포인트를 찾을 수 없습니다." }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const preview = body?.preview !== false; // 기본 미리보기

    const result = await collectCustomSource(source, endpoint, { preview });
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
