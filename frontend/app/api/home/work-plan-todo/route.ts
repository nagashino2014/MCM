import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getWorkPlanTodo } from "@/lib/home/work-plan-todo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** H9 — 이번 주 작성 대상 + 반려·보완 재작성 건(내 것). */
export async function GET() {
  try {
    const ctx = await requireSession();
    const todo = await getWorkPlanTodo(ctx.userId);
    return NextResponse.json(todo);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
