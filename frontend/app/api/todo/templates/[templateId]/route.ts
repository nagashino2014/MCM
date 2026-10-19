import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { deleteTemplate, updateTemplate } from "@/lib/todo/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ templateId: string }>;
}

// 템플릿 수정·삭제(286) — 작성자 또는 보드 소유자.
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { templateId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ template: await updateTemplate(ctx.userId, templateId, body) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { templateId } = await context.params;
    await deleteTemplate(ctx.userId, templateId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
