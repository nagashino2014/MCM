import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { deleteRule, updateRule } from "@/lib/todo/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ boardId: string; ruleId: string }>;
}

// 보드 자동화 규칙 1건 — PATCH(부분 수정: name/enabled/trigger/condition/action) / DELETE. 보드 admin.
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { boardId, ruleId } = await context.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ rule: await updateRule(ctx.userId, boardId, ruleId, body ?? {}) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { boardId, ruleId } = await context.params;
    await deleteRule(ctx.userId, boardId, ruleId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
