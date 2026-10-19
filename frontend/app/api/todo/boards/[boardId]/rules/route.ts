import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { createRule, listRules } from "@/lib/todo/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ boardId: string }>;
}

// 보드 자동화 규칙(296, §29-2) — GET → { rules } / POST { name, trigger, condition?, action, enabled? } → { rule } (보드 admin).
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { boardId } = await context.params;
    return NextResponse.json({ rules: await listRules(ctx.userId, boardId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { boardId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ rule: await createRule(ctx.userId, boardId, body ?? {}) }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
