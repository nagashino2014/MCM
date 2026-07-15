import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getSource } from "@/lib/scraper/sources-store";
import { analyzeApiSource } from "@/lib/scraper/analyze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// analyze 는 URL fetch + LLM(Sonnet) 이라 시간이 걸린다.
export const maxDuration = 120;

interface Ctx {
  params: Promise<{ sourceId: string }>;
}

/**
 * API Profile 자동생성 — URL 또는 원문(rawText)을 LLM으로 분석해 api_profile+api_config+field_mapping proposal 반환.
 * DB에 저장하지 않는다(사용자 확인 후 소스 PUT + 엔드포인트 POST 로 커밋).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { sourceId } = await ctx.params;
    const source = await getSource(sourceId);
    if (!source) return NextResponse.json({ error: "소스를 찾을 수 없습니다." }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const url = body?.url ? String(body.url) : undefined;
    const rawText = body?.rawText ? String(body.rawText) : undefined;
    if (!url && !rawText) {
      return NextResponse.json({ error: "분석할 URL 또는 명세 원문이 필요합니다." }, { status: 400 });
    }

    const result = await analyzeApiSource({
      slug: source.slug,
      name: source.name,
      baseUrlHint: source.baseUrl ?? undefined,
      url,
      rawText,
      context: body?.context ? String(body.context) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "llm_not_configured") {
      return NextResponse.json({ error: "LLM(ANTHROPIC_API_KEY)이 설정되지 않았습니다." }, { status: 503 });
    }
    return authErrorToResponse(err);
  }
}
