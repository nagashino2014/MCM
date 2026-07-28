import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { deletePost, getPost, updatePost, type BoardScope } from "@/lib/board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ postId: string }> };

/** 수정·삭제 권한 — 작성자 본인 또는 관리자. */
async function assertCanEdit(postId: string, userId: string, role: string) {
  const post = await getPost(postId);
  if (!post) throw new AuthError("게시글을 찾을 수 없습니다.", 404);
  if (role !== "admin" && post.authorUserId !== userId) {
    throw new AuthError("본인이 작성한 글만 수정·삭제할 수 있습니다.", 403);
  }
  return post;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireSession();
    const { postId } = await ctx.params;
    const post = await getPost(postId, session.userId); // 조회 시 읽음 표시
    if (!post) return NextResponse.json({ error: "게시글을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ post, canEdit: session.role === "admin" || post.authorUserId === session.userId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireSession();
    const { postId } = await ctx.params;
    const current = await assertCanEdit(postId, session.userId, session.role);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = String(body.title ?? "").trim();
    if (!title) return NextResponse.json({ error: "제목을 입력하세요." }, { status: 400 });
    await updatePost(postId, {
      scope: (body.scope === "company" ? "company" : "dept") as BoardScope,
      deptId: current.deptId,
      title,
      bodyHtml: String(body.bodyHtml ?? ""),
      noticeFrom: body.noticeFrom as string | null,
      noticeTo: body.noticeTo as string | null,
      pinned: body.pinned === true,
      pinFrom: body.pinFrom as string | null,
      pinTo: body.pinTo as string | null,
      notifyEmail: body.notifyEmail === true,
      notifyPush: body.notifyPush === true,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireSession();
    const { postId } = await ctx.params;
    await assertCanEdit(postId, session.userId, session.role);
    await deletePost(postId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
