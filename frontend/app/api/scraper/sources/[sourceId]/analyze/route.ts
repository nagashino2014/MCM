import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getSource } from "@/lib/scraper/sources-store";
import { analyzeApiSource } from "@/lib/scraper/analyze";
import { extractGuideFileText } from "@/lib/scraper/file-text";

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

    // 파일 업로드(docx 가이드)는 multipart/form-data, 그 외는 JSON.
    let url: string | undefined;
    let rawText: string | undefined;
    let context: string | undefined;
    let fileText: string | undefined;
    let fileName: string | undefined;
    if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
      const form = await req.formData();
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
      url = body?.url ? String(body.url) : undefined;
      rawText = body?.rawText ? String(body.rawText) : undefined;
      context = body?.context ? String(body.context) : undefined;
    }
    if (!url && !rawText && !fileText) {
      return NextResponse.json({ error: "분석할 URL·가이드 파일 또는 명세 원문이 필요합니다." }, { status: 400 });
    }

    const result = await analyzeApiSource({
      slug: source.slug,
      name: source.name,
      baseUrlHint: source.baseUrl ?? undefined,
      url,
      rawText,
      fileText,
      fileName,
      context,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "llm_not_configured") {
      return NextResponse.json({ error: "LLM(ANTHROPIC_API_KEY)이 설정되지 않았습니다." }, { status: 503 });
    }
    return authErrorToResponse(err);
  }
}
