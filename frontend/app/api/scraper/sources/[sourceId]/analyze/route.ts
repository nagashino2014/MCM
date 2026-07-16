import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getSource, updateSource } from "@/lib/scraper/sources-store";
import { analyzeApiSource, buildProfileFromCatalog, extractCatalog } from "@/lib/scraper/analyze";
import { extractGuideFileText } from "@/lib/scraper/file-text";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// analyze 는 URL fetch + LLM(Sonnet) 이라 시간이 걸린다. 카탈로그 추출(2패스 배치)은 수 분 — ALB idle timeout(300s) 한도까지.
export const maxDuration = 300;

interface Ctx {
  params: Promise<{ sourceId: string }>;
}

/**
 * API 가이드 분석. mode 로 분기:
 * - "quick"(기본): 기존 원샷 자동생성 — api_profile+api_config+field_mapping proposal 반환(저장 안 함).
 * - "catalog": 가이드에서 엔드포인트×파라미터×응답필드 카탈로그 추출 → scraper_sources.catalog 에 저장 후 반환.
 * - "build": 저장된 카탈로그에서 selectedTitles 만 정제 → api_profile(endpoints[]) + 엔드포인트별 proposal 반환(저장 안 함).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { sourceId } = await ctx.params;
    const source = await getSource(sourceId);
    if (!source) return NextResponse.json({ error: "소스를 찾을 수 없습니다." }, { status: 404 });

    // 파일 업로드(docx 가이드)는 multipart/form-data, 그 외는 JSON.
    let mode = "quick";
    let url: string | undefined;
    let rawText: string | undefined;
    let context: string | undefined;
    let fileText: string | undefined;
    let fileName: string | undefined;
    let selectedTitles: string[] = [];
    if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
      const form = await req.formData();
      mode = form.get("mode")?.toString().trim() || "quick";
      url = form.get("url")?.toString().trim() || undefined;
      rawText = form.get("rawText")?.toString().trim() || undefined;
      context = form.get("context")?.toString().trim() || undefined;
      const file = form.get("file");
      if (file instanceof File && file.size > 0) {
        try {
          const ex = await extractGuideFileText(file);
          fileText = ex.text;
          fileName = file.name;
        } catch (e) {
          const code = e instanceof Error ? e.message : "file_error";
          const msg =
            code === "file_type_unsupported"
              ? "현재 docx 파일만 지원합니다(pdf/xlsx는 추후)."
              : code === "file_too_large"
                ? "파일이 너무 큽니다(최대 8MB)."
                : "가이드 파일을 읽지 못했습니다.";
          return NextResponse.json({ error: msg }, { status: 400 });
        }
      }
    } else {
      const body = await req.json().catch(() => ({}));
      mode = body?.mode ? String(body.mode) : "quick";
      url = body?.url ? String(body.url) : undefined;
      rawText = body?.rawText ? String(body.rawText) : undefined;
      context = body?.context ? String(body.context) : undefined;
      selectedTitles = Array.isArray(body?.selectedTitles) ? body.selectedTitles.map(String) : [];
    }

    // ② 선택 엔드포인트 정제 — 저장된 카탈로그 기반(가이드 재입력 불필요).
    if (mode === "build") {
      if (!source.catalog?.endpoints?.length) {
        return NextResponse.json({ error: "저장된 카탈로그가 없습니다. 먼저 카탈로그를 추출하세요." }, { status: 400 });
      }
      if (!selectedTitles.length) {
        return NextResponse.json({ error: "엔드포인트를 1개 이상 선택하세요." }, { status: 400 });
      }
      const built = await buildProfileFromCatalog({
        slug: source.slug,
        name: source.name,
        baseUrlHint: source.baseUrl ?? undefined,
        purpose: source.purpose,
        context,
        catalog: source.catalog,
        selectedTitles,
      });
      // 목록만 있던 카탈로그에 선택분 상세가 보충됐으면 재저장(카드에 파라미터/필드 수 표시).
      if (built.catalog_updated) {
        await updateSource(sourceId, { catalog: source.catalog }, actor.userId);
      }
      return NextResponse.json(built);
    }

    if (!url && !rawText && !fileText) {
      return NextResponse.json({ error: "분석할 URL·가이드 파일 또는 명세 원문이 필요합니다." }, { status: 400 });
    }
    const input = {
      slug: source.slug,
      name: source.name,
      baseUrlHint: source.baseUrl ?? undefined,
      url,
      rawText,
      fileText,
      fileName,
      context,
      purpose: source.purpose,
    };

    // ① 카탈로그 추출 — 소스에 저장 후 반환(취사선택의 원천).
    if (mode === "catalog") {
      const result = await extractCatalog(input);
      await updateSource(sourceId, { catalog: result.catalog }, actor.userId);
      return NextResponse.json(result);
    }

    // 기본: 원샷 자동생성(기존 동작 유지)
    const result = await analyzeApiSource(input);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "llm_not_configured") {
      return NextResponse.json({ error: "LLM(ANTHROPIC_API_KEY)이 설정되지 않았습니다." }, { status: 503 });
    }
    return authErrorToResponse(err);
  }
}
