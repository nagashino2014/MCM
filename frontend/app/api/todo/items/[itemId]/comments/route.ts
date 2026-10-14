import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { addComment, deleteComment, listComments } from "@/lib/todo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ itemId: string }>;
}

// 댓글 — GET 목록 / POST { body, mentionUserIds? }(@멘션 푸시) / DELETE ?commentId=(작성자·소유자).
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    return NextResponse.json({ comments: await listComments(ctx.userId, itemId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ comments: await addComment(ctx.userId, itemId, body ?? {}) }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const { itemId } = await context.params;
    const commentId = req.nextUrl.searchParams.get("commentId") ?? "";
    if (!commentId) return NextResponse.json({ error: "commentId 가 필요합니다." }, { status: 400 });
    return NextResponse.json({ comments: await deleteComment(ctx.userId, itemId, commentId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
