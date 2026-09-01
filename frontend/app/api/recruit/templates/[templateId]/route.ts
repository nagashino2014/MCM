import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getTemplate, setTemplateActive } from "@/lib/recruit/store";

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
