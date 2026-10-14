import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { shareItem, unshareItem } from "@/lib/todo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

// 작업 공유 — POST { userId, role: assignee|collaborator|watcher } / DELETE ?userId=(owner 또는 본인 해제).
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ item: await shareItem(ctx.userId, itemId, body ?? {}) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    const userId = req.nextUrl.searchParams.get("userId") ?? "";
    if (!userId) return NextResponse.json({ error: "userId 가 필요합니다." }, { status: 400 });
    const item = await unshareItem(ctx.userId, itemId, userId);
    return NextResponse.json({ item });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
