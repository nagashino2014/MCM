import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getTemplate, setTemplateActive, updateTemplate } from "@/lib/recruit/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("recruit.view", { fallbackRoles: ["admin", "editor"] });
    const { templateId } = await context.params;
    const template = await getTemplate(templateId);
    if (!template) return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ template });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 템플릿 갱신 — 이름·설명 수정, 또는 에디터 콘텐츠로 덮어쓰기(tree/theme/docWidth). 주어진 필드만 반영.
export async function PUT(req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("recruit.manage", { fallbackRoles: ["admin"] });
    const { templateId } = await context.params;
    const body = await req.json();
    const template = await updateTemplate({
      templateId,
      name: body?.name != null ? String(body.name) : undefined,
      description: body?.description != null ? String(body.description) : undefined,
      tree: body?.tree ?? undefined,
      theme: body?.theme ?? undefined,
      docWidth: body?.docWidth != null ? Number(body.docWidth) : undefined,
    });
    return NextResponse.json({ template });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 활성/비활성 토글 — 비활성 템플릿은 새 공고 생성 목록에서 빠진다(기존 공고는 영향 없음).
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("recruit.manage", { fallbackRoles: ["admin"] });
    const { templateId } = await context.params;
    const body = await req.json();
    if (typeof body?.isActive !== "boolean") {
      return NextResponse.json({ error: "isActive(boolean) 가 필요합니다." }, { status: 400 });
    }
    await setTemplateActive(templateId, body.isActive);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
