import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { LlmError } from "@/lib/ai/llm-json";
import type { ChatAttachment } from "@/lib/ai/llm-json";
import { extractPdfTextLayer, hasUsableTextLayer } from "@/lib/ocr/pdf-text";
import { applyMapping, collectSlots, requestMapping } from "@/lib/recruit/import";
import { createPosting, getTemplate, savePosting } from "@/lib/recruit/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

// 원본 채용공고(PDF/이미지) 업로드 → 선택 템플릿에 내용을 채운 새 공고 초안 생성.
// body: { templateId, title?, file: { name, contentType, base64 } }
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("recruit.manage", { fallbackRoles: ["admin"] });
    const body = await req.json();
    const templateId = String(body?.templateId ?? "");
    const file = body?.file as { name?: string; contentType?: string; base64?: string } | undefined;
    if (!templateId || !file?.base64) {
      return NextResponse.json({ error: "templateId 와 file 이 필요합니다." }, { status: 400 });
    }
    const base64 = String(file.base64).replace(/\s+/g, "");
    const buf = Buffer.from(base64, "base64");
    if (buf.byteLength > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "파일은 20MB 이하만 올릴 수 있습니다." }, { status: 400 });
    }
    const contentType = String(file.contentType || "");
    const name = String(file.name || "upload");

    const template = await getTemplate(templateId);
    if (!template || !template.isActive) {
      return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
    }

    // 입력 구성 — PDF 는 문서 블록(+텍스트 레이어 보조), 이미지는 비전 입력.
    const attachments: ChatAttachment[] = [];
    let text: string | undefined;
    if (contentType === "application/pdf" || /\.pdf$/i.test(name)) {
      attachments.push({ kind: "pdf", base64 });
      const layer = await extractPdfTextLayer(new File([buf], name, { type: "application/pdf" }));
      if (hasUsableTextLayer(layer)) text = layer;
    } else if (IMAGE_TYPES.has(contentType)) {
      attachments.push({ kind: "image", mediaType: contentType as "image/png", base64 });
    } else {
      return NextResponse.json({ error: "PDF 또는 PNG/JPG/GIF/WebP 이미지만 지원합니다." }, { status: 400 });
    }

    const spec = collectSlots(template.designTree);
    const mapping = await requestMapping(spec, { attachments, text });
    const { tree, applied } = applyMapping(template.designTree, spec, mapping);

    const titleFromMapping = Object.values(mapping.texts ?? {}).find((v) => typeof v === "string" && v.length > 4);
    const posting = await createPosting({
      templateId,
      title: body?.title ? String(body.title) : `[가져옴] ${titleFromMapping ?? name.replace(/\.[^.]+$/, "")}`,
      createdBy: ctx.userId,
    });
    await savePosting({ postingId: posting.postingId, contentTree: tree, snapshot: true, updatedBy: ctx.userId });

    return NextResponse.json({ postingId: posting.postingId, applied }, { status: 201 });
  } catch (err) {
    if (err instanceof LlmError) {
      const msg =
        err.message === "llm_not_configured"
          ? "서버에 ANTHROPIC_API_KEY 가 설정되지 않았습니다."
          : err.message.startsWith("llm_timeout")
            ? "분석 시간이 초과됐습니다. 페이지 수가 적은 파일로 다시 시도해 주세요."
            : `분석 실패: ${err.message}`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    return authErrorToResponse(err);
  }
}
