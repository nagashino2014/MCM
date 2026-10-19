import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { createTemplate, listTemplates } from "@/lib/todo/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 체크리스트 템플릿(286, §26-3) — GET ?boardId= → { templates } / POST { name, items | fromItemId, boardId? } → { template }.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const boardId = req.nextUrl.searchParams.get("boardId");
    return NextResponse.json({ templates: await listTemplates(ctx.userId, boardId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ template: await createTemplate(ctx.userId, body) }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
