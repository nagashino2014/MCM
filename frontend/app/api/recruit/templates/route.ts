import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createTemplate, listTemplates } from "@/lib/recruit/store";
import { putRecruitTemplateSource } from "@/lib/storage/recruit-template-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 채용공고 템플릿 — 목록. 라인업 화면·새 공고 템플릿 선택 모달 공용.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("recruit.view", { fallbackRoles: ["admin", "editor"] });
    const includeInactive = new URL(req.url).searchParams.get("all") === "1";
    return NextResponse.json({ templates: await listTemplates(includeInactive) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

const MAX_SOURCE_BYTES = 2 * 1024 * 1024; // 핸드오프 원본(html/zip) 보관 상한

// 템플릿 등록 — 클라이언트가 핸드오프 HTML 을 파싱한 결과(tree/theme)를 올린다.
// 서버는 sanitizeTree/sanitizeTheme 으로 재정제하고, 원본 파일은 S3 에 보관한다.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("recruit.manage", { fallbackRoles: ["admin"] });
    const body = await req.json();

    let sourceFileKey: string | null = null;
    const source = body?.sourceFile as { name?: string; contentType?: string; base64?: string } | undefined;
    if (source?.base64) {
      const buf = Buffer.from(String(source.base64), "base64");
      if (buf.byteLength > MAX_SOURCE_BYTES) {
        return NextResponse.json({ error: "원본 파일이 2MB 를 초과합니다." }, { status: 400 });
      }
      try {
        sourceFileKey = await putRecruitTemplateSource(
          String(source.name || "handoff.html"),
          buf,
          String(source.contentType || "text/html")
        );
      } catch (e) {
        // 원본 보관 실패(로컬 등 S3 미구성)는 등록 자체를 막지 않는다 — 트리는 DB 에 있다.
        console.warn("[recruit] 템플릿 원본 S3 보관 실패:", (e as Error)?.message);
      }
    }

    const template = await createTemplate({
      name: String(body?.name ?? ""),
      description: body?.description != null ? String(body.description) : undefined,
      tree: body?.tree,
      theme: body?.theme,
      docWidth: Number(body?.docWidth) || 900,
      sourceFileKey,
      createdBy: ctx.userId,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
