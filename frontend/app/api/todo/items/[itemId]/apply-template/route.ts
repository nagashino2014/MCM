import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { applyTemplate } from "@/lib/todo/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

// 템플릿 적용(286, §26-3) — POST { templateId } → { item, created }. 하위 작업을 뒤에 추가한다.
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as { templateId?: unknown };
    const templateId = typeof body.templateId === "string" ? body.templateId : "";
    if (!templateId) return NextResponse.json({ error: "templateId 가 필요합니다." }, { status: 400 });
    return NextResponse.json(await applyTemplate(ctx.userId, itemId, templateId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
