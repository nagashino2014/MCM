import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guards";
import { completeItem } from "@/lib/todo/store";
import { completeRulesErrorToResponse } from "@/lib/todo/route-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

// 완료/되돌리기. body { done?: boolean, completionNote?: string }(done 기본 true). 반복이면 다음 발생을 next 로 함께 돌려준다.
// 완료 조건(276) 미충족이면 409 { error, code: "complete_rules", missing: ["subtasks"|"note"|"review"], openSubtasks } — 화면은 완료 확인 모달로 안내한다.
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const done = body?.done === undefined ? true : body.done === true || body.done === 1 || body.done === "1";
    const { item, next } = await completeItem(ctx.userId, itemId, done, { completionNote: body?.completionNote });
    return NextResponse.json({ item, next });
  } catch (err) {
    return completeRulesErrorToResponse(err);
  }
}
