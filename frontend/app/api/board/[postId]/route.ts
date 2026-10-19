import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission, requireSession } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { getUserDeptId } from "@/lib/approval/docs";
import { deletePost, getPost, saveBoardAttachments, updatePost, type BoardScope } from "@/lib/board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTACH_BYTES = 20 * 1024 * 1024;

type RouteContext = { params: Promise<{ postId: string }> };

/** 수정·삭제 권한 — 작성자 본인 또는 게시판 관리 권한 보유자(board.manage). */
async function assertCanEdit(postId: string, userId: string) {
  const post = await getPost(postId);
  if (!post) throw new AuthError("게시글을 찾을 수 없습니다.", 404);
  if (post.authorUserId !== userId && !(await hasPermission(userId, "board.manage"))) {
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
    const canEdit =
      post.authorUserId === session.userId || (await hasPermission(session.userId, "board.manage"));
    return NextResponse.json({ post, canEdit });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH : JSON 또는 multipart(웹 수정 화면 — 작성 화면과 같은 필드 + 추가 첨부 files).
// 수정은 알림을 다시 보내지 않는다(알림 설정 값만 보존).
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireSession();
    const { postId } = await ctx.params;
    const current = await assertCanEdit(postId, session.userId);
    const isForm = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
    const form = isForm ? await req.formData() : null;
    const json = isForm ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
    const str = (key: string): string | null => {
      const v = form ? form.get(key) : json[key];
      return typeof v === "string" && v.trim() ? v : null;
    };
    const flag = (key: string) => (form ? form.get(key) === "1" : json[key] === true);
    const title = String(str("title") ?? "").trim();
    if (!title) return NextResponse.json({ error: "제목을 입력하세요." }, { status: 400 });
    const scope: BoardScope = str("scope") === "company" ? "company" : "dept";
    // 전사 공지로 옮기는 것은 게시판 운영 권한자만. 부서로 옮기면 원래 부서(없으면 작성자 소속)를 쓴다.
    if (scope === "company" && current.scope !== "company") await requirePermission("board.manage");
    const deptId = scope === "dept" ? current.deptId ?? (await getUserDeptId(session.userId)) : null;
    await updatePost(postId, {
      scope,
      deptId,
      title,
      bodyHtml: String((form ? form.get("bodyHtml") : json.bodyHtml) ?? ""),
      noticeFrom: str("noticeFrom"),
      noticeTo: str("noticeTo"),
      pinned: flag("pinned"),
      pinFrom: str("pinFrom"),
      pinTo: str("pinTo"),
      notifyEmail: form ? current.notifyEmail : flag("notifyEmail"),
      notifyPush: form ? current.notifyPush : flag("notifyPush"),
    });
    const files = form ? form.getAll("files").filter((f): f is File => f instanceof File) : [];
    const attachFailed = files.length ? await saveBoardAttachments(postId, files, session.userId, MAX_ATTACH_BYTES) : [];
    return NextResponse.json({ ok: true, attachFailed: attachFailed.length ? attachFailed : undefined });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireSession();
    const { postId } = await ctx.params;
    await assertCanEdit(postId, session.userId);
    await deletePost(postId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
