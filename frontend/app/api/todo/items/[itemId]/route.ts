import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { deleteItem, getItemDetail, updateItem } from "@/lib/todo/store";
import { completeRulesErrorToResponse } from "@/lib/todo/route-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

// 할 일 상세(하위·공유·댓글·활동 포함) / PATCH 부분 수정(상태·날짜·열·position·담당·본문·완료 조건 completeRules·완료 메모 completionNote, 이동 포함) / DELETE(owner).
//   PATCH 로 status 를 done 으로 바꿀 때도 완료 조건(276)을 검사한다 — 미충족이면 409 { error, code: "complete_rules", missing, openSubtasks }.
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    return NextResponse.json({ item: await getItemDetail(ctx.userId, itemId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ item: await updateItem(ctx.userId, itemId, body ?? {}) });
  } catch (err) {
    return completeRulesErrorToResponse(err);
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    await deleteItem(ctx.userId, itemId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
