import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listTodoNotifications, markTodoNotificationsRead, countUnreadTodoNotifications } from "@/lib/todo/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 할 일 인앱 알림함(277) — GET ?limit= → { items, unread } / PATCH { ids: [...] } | { all: true } → { updated, unread }.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 30);
    return NextResponse.json(await listTodoNotifications(ctx.userId, limit));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown; all?: unknown };
    const target: string[] | "all" = body.all === true ? "all" : Array.isArray(body.ids) ? body.ids.map(String) : [];
    const updated = await markTodoNotificationsRead(ctx.userId, target);
    return NextResponse.json({ updated, unread: await countUnreadTodoNotifications(ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
