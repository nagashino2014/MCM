import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { AuthError, authErrorToResponse, requireAdmin, requireSession } from "@/lib/auth/guards";
import { getUserDeptId } from "@/lib/approval/docs";
import { createPost, listNotifyTargets, listPosts, type BoardScope } from "@/lib/board";
import { getBoardAttachmentStorageKey, putBoardAttachment } from "@/lib/storage/board-attachment-storage";
import { withDbWrite } from "@/lib/db";
import { sendNotifyEmail } from "@/lib/notify/email-ses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTACH_BYTES = 20 * 1024 * 1024;

// GET ?scope=company|dept : 목록. dept 는 본인 소속 부서 글만 본다.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const scope = (req.nextUrl.searchParams.get("scope") === "dept" ? "dept" : "company") as BoardScope;
    const deptId = scope === "dept" ? await getUserDeptId(ctx.userId) : null;
    if (scope === "dept" && !deptId) {
      return NextResponse.json({ posts: [], deptId: null, message: "소속 부서가 지정되지 않았습니다." });
    }
    return NextResponse.json({ posts: await listPosts({ scope, deptId, userId: ctx.userId }), deptId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST(multipart) : 글 작성 + 첨부 업로드 + (선택) 메일 알림.
// 전사 공지는 관리자만, 부서 게시판은 소속 부서원이 작성한다.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const form = await req.formData();
    const scope: BoardScope = String(form.get("scope") ?? "dept") === "company" ? "company" : "dept";
    if (scope === "company") await requireAdmin();

    const myDept = await getUserDeptId(ctx.userId);
    if (scope === "dept" && !myDept) {
      return NextResponse.json({ error: "소속 부서가 지정되지 않아 부서 게시판에 글을 쓸 수 없습니다." }, { status: 400 });
    }
    const title = String(form.get("title") ?? "").trim();
    if (!title) return NextResponse.json({ error: "제목을 입력하세요." }, { status: 400 });
    const text = (key: string): string | null => {
      const v = form.get(key);
      return typeof v === "string" && v.trim() ? v : null;
    };

    const postId = await createPost(
      {
        scope,
        deptId: myDept,
        title,
        bodyHtml: String(form.get("bodyHtml") ?? ""),
        noticeFrom: text("noticeFrom"),
        noticeTo: text("noticeTo"),
        pinned: form.get("pinned") === "1",
        pinFrom: text("pinFrom"),
        pinTo: text("pinTo"),
        notifyEmail: form.get("notifyEmail") === "1",
        notifyPush: form.get("notifyPush") === "1",
      },
      ctx.userId
    );

    // 첨부 저장(트랜잭션 밖에서 업로드 후 메타만 기록).
    // 글은 이미 저장됐으므로 첨부가 실패해도 등록 자체는 성공으로 응답한다
    // (실패를 에러로 돌려주면 사용자가 재등록해 글이 중복된다).
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    const attachFailed: string[] = [];
    for (const f of files) {
      if (f.size === 0 || f.size > MAX_ATTACH_BYTES) continue;
      try {
        const buf = Buffer.from(await f.arrayBuffer());
        const { storageKey, fileName } = getBoardAttachmentStorageKey({ postId, fileName: f.name || "file" });
        const stored = await putBoardAttachment(storageKey, buf, f.type || "application/octet-stream");
        await withDbWrite(async (db) => {
          await db.run(
            `INSERT INTO board_attachments
               (attachment_id, post_id, file_name, content_type, byte_size, sha256,
                storage_provider, storage_bucket, storage_key, public_path, created_by, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              "batt-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14),
              postId,
              fileName,
              f.type || null,
              f.size,
              crypto.createHash("sha256").update(buf).digest("hex"),
              stored.storageProvider,
              stored.storageBucket,
              stored.storageKey,
              stored.publicPath,
              ctx.userId,
              new Date().toISOString(),
            ]
          );
        });
      } catch (e) {
        console.error("[board] 첨부 저장 실패:", f.name, e);
        attachFailed.push(f.name || "파일");
      }
    }

    // 알림은 커밋 후 fire-and-forget(실패해도 글 작성은 성공으로 둔다).
    if (form.get("notifyEmail") === "1") {
      void (async () => {
        try {
          const targets = await listNotifyTargets(scope, myDept);
          if (targets.length) {
            const base = process.env.APP_PUBLIC_URL?.replace(/\/$/, "") ?? "";
            await sendNotifyEmail({
              to: targets.map((t) => t.email),
              subject: `[${scope === "company" ? "전사 공지" : "부서 공지"}] ${title}`,
              text: `새 공지가 등록되었습니다.\n\n제목: ${title}\n${base ? `\n확인: ${base}/board?post=${postId}` : ""}`,
            });
          }
        } catch {
          // 알림 실패는 무시(글은 이미 저장됨)
        }
      })();
    }

    return NextResponse.json({
      ok: true,
      postId,
      pushQueued: form.get("notifyPush") === "1",
      attachFailed: attachFailed.length ? attachFailed : undefined,
    });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status: 400 });
    return authErrorToResponse(err);
  }
}
