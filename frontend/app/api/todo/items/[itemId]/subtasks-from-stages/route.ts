import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { createSubtasksFromStages } from "@/lib/todo/stage-subtasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

// 공정표 단계로 하위 작업 만들기(§28-1) — POST → { item, created, skipped }. 관련이 계약/Task 이고 공정표가 있을 때만.
export async function POST(_req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    return NextResponse.json(await createSubtasksFromStages(ctx.userId, itemId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
