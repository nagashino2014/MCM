/**
 * 공지·게시판(G6-B) — 전사 공지(scope='company')와 부서 게시판(scope='dept').
 * 목록은 "상단 고정(기간 내) → 최신순"으로 정렬하고, 공지 기간이 지난 글은 종료로 표시한다.
 * 첨부는 board_attachments(로컬/S3 공용 저장 헬퍼)로 관리한다.
 * 설계: docs/groupware-ux-overhaul-blueprint.md §7.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export type BoardScope = "company" | "dept";

export interface BoardPost {
  postId: string;
  scope: BoardScope;
  deptId: string | null;
  deptName: string | null;
  title: string;
  bodyHtml: string;
  noticeFrom: string | null;
  noticeTo: string | null;
  pinned: boolean;
  pinFrom: string | null;
  pinTo: string | null;
  notifyEmail: boolean;
  notifyPush: boolean;
  authorUserId: string | null;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  /** 목록 조회 시 계산 — 지금 시점에 상단 고정 상태인가. */
  pinnedNow?: boolean;
  /** 공지 기간이 끝났는가(기간 미설정이면 false). */
  expired?: boolean;
  attachmentCount?: number;
  unread?: boolean;
}

export interface BoardAttachment {
  attachmentId: string;
  fileName: string;
  contentType: string | null;
  byteSize: number | null;
  storageKey: string;
  createdAt: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const newId = (p: string) => `${p}-${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;

/** YYYYMMDD·YYYY-MM-DD 입력을 ISO(YYYY-MM-DD)로 정규화. 빈 값은 null. */
export function normalizeDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function toPost(r: Record<string, unknown>): BoardPost {
  const t = today();
  const pinned = Number(r.pinned ?? 0) === 1;
  const pinFrom = r.pin_from != null ? String(r.pin_from) : null;
  const pinTo = r.pin_to != null ? String(r.pin_to) : null;
  const noticeTo = r.notice_to != null ? String(r.notice_to) : null;
  return {
    postId: String(r.post_id),
    scope: String(r.scope) === "company" ? "company" : "dept",
    deptId: r.dept_id != null ? String(r.dept_id) : null,
    deptName: r.dept_name != null ? String(r.dept_name) : null,
    title: String(r.title ?? ""),
    bodyHtml: String(r.body_html ?? ""),
    noticeFrom: r.notice_from != null ? String(r.notice_from) : null,
    noticeTo,
    pinned,
    pinFrom,
    pinTo,
    notifyEmail: Number(r.notify_email ?? 0) === 1,
    notifyPush: Number(r.notify_push ?? 0) === 1,
    authorUserId: r.author_user_id != null ? String(r.author_user_id) : null,
    authorName: r.author_name != null ? String(r.author_name) : null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    pinnedNow: pinned && (!pinFrom || pinFrom <= t) && (!pinTo || pinTo >= t),
    expired: noticeTo != null && noticeTo < t,
    attachmentCount: r.attachment_count != null ? Number(r.attachment_count) : undefined,
    unread: r.read_at !== undefined ? r.read_at == null : undefined,
  };
}

/** 목록 — scope 별. dept 는 deptId 필수(본인 소속 부서). 상단 고정(기간 내) 우선, 최신순. */
export async function listPosts(params: {
  scope: BoardScope;
  deptId?: string | null;
  userId: string;
  limit?: number;
}): Promise<BoardPost[]> {
  const db = await getDb();
  const t = today();
  const where = params.scope === "company" ? `p.scope = 'company'` : `p.scope = 'dept' AND p.dept_id = $3`;
  const args: unknown[] = [params.userId, params.limit ?? 100];
  if (params.scope === "dept") args.push(params.deptId ?? "");
  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.*, d.dept_name,
              COALESCE(ep.name, u.email) AS author_name,
              (SELECT count(*) FROM board_attachments a WHERE a.post_id = p.post_id)::int AS attachment_count,
              r.read_at
         FROM board_posts p
         LEFT JOIN departments d ON d.dept_id = p.dept_id
         LEFT JOIN users u ON u.user_id = p.author_user_id
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
         LEFT JOIN board_post_reads r ON r.post_id = p.post_id AND r.user_id = $1
        WHERE p.deleted_at IS NULL AND ${where}
        ORDER BY
          (p.pinned = 1
            AND (p.pin_from IS NULL OR p.pin_from <= '${t}')
            AND (p.pin_to IS NULL OR p.pin_to >= '${t}')) DESC,
          p.created_at DESC
        LIMIT $2`,
      args
    )
  );
  return rows.map(toPost);
}

export async function getPost(postId: string, userId?: string): Promise<(BoardPost & { attachments: BoardAttachment[] }) | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.*, d.dept_name, COALESCE(ep.name, u.email) AS author_name
         FROM board_posts p
         LEFT JOIN departments d ON d.dept_id = p.dept_id
         LEFT JOIN users u ON u.user_id = p.author_user_id
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
        WHERE p.post_id = $1 AND p.deleted_at IS NULL`,
      [postId]
    )
  );
  if (!rows.length) return null;
  const atts = rowsToObjects(
    await db.exec(
      `SELECT attachment_id, file_name, content_type, byte_size, storage_key, created_at
         FROM board_attachments WHERE post_id = $1 ORDER BY created_at ASC`,
      [postId]
    )
  );
  if (userId) await markRead(postId, userId);
  return {
    ...toPost(rows[0]),
    attachments: atts.map((a) => ({
      attachmentId: String(a.attachment_id),
      fileName: String(a.file_name),
      contentType: a.content_type != null ? String(a.content_type) : null,
      byteSize: a.byte_size != null ? Number(a.byte_size) : null,
      storageKey: String(a.storage_key),
      createdAt: String(a.created_at),
    })),
  };
}

/** 읽음 표시 — 읽은 사람만 행이 생긴다(최초 열람 시각 보존). */
export async function markRead(postId: string, userId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO board_post_reads (post_id, user_id, read_at) VALUES ($1, $2, $3)
       ON CONFLICT (post_id, user_id) DO NOTHING`,
      [postId, userId, new Date().toISOString()]
    );
  });
}

export interface BoardPostInput {
  scope: BoardScope;
  deptId?: string | null;
  title: string;
  bodyHtml: string;
  noticeFrom?: string | null;
  noticeTo?: string | null;
  pinned?: boolean;
  pinFrom?: string | null;
  pinTo?: string | null;
  notifyEmail?: boolean;
  notifyPush?: boolean;
}

export async function createPost(input: BoardPostInput, authorUserId: string): Promise<string> {
  const postId = newId("bpost");
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO board_posts
         (post_id, scope, dept_id, title, body_html, notice_from, notice_to,
          pinned, pin_from, pin_to, notify_email, notify_push, author_user_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
      [
        postId,
        input.scope,
        input.scope === "dept" ? input.deptId ?? null : null,
        input.title.trim(),
        input.bodyHtml,
        normalizeDate(input.noticeFrom),
        normalizeDate(input.noticeTo),
        input.pinned ? 1 : 0,
        input.pinned ? normalizeDate(input.pinFrom) : null,
        input.pinned ? normalizeDate(input.pinTo) : null,
        input.notifyEmail ? 1 : 0,
        input.notifyPush ? 1 : 0,
        authorUserId,
        now,
      ]
    );
  });
  return postId;
}

export async function updatePost(postId: string, input: BoardPostInput): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE board_posts
          SET scope = $2, dept_id = $3, title = $4, body_html = $5, notice_from = $6, notice_to = $7,
              pinned = $8, pin_from = $9, pin_to = $10, notify_email = $11, notify_push = $12, updated_at = $13
        WHERE post_id = $1`,
      [
        postId,
        input.scope,
        input.scope === "dept" ? input.deptId ?? null : null,
        input.title.trim(),
        input.bodyHtml,
        normalizeDate(input.noticeFrom),
        normalizeDate(input.noticeTo),
        input.pinned ? 1 : 0,
        input.pinned ? normalizeDate(input.pinFrom) : null,
        input.pinned ? normalizeDate(input.pinTo) : null,
        input.notifyEmail ? 1 : 0,
        input.notifyPush ? 1 : 0,
        new Date().toISOString(),
      ]
    );
  });
}

/** 소프트 삭제 — 첨부는 남기고 목록에서만 감춘다. */
export async function deletePost(postId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`UPDATE board_posts SET deleted_at = $2 WHERE post_id = $1`, [postId, new Date().toISOString()]);
  });
}

/** 알림 수신자 — 전사는 전 재직자, 부서는 해당 부서원(회사 메일 보유자). */
export async function listNotifyTargets(scope: BoardScope, deptId: string | null): Promise<{ name: string; email: string }[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT ep.name, COALESCE(mb.address, ep.email) AS email
         FROM employee_profiles ep
         JOIN users u ON u.user_id = ep.user_id AND u.status = 'active'
         LEFT JOIN mailboxes mb ON mb.user_id = ep.user_id AND mb.status = 'active'
        WHERE ep.status = 'active'
          AND COALESCE(mb.address, ep.email) IS NOT NULL
          ${scope === "dept" ? "AND ep.dept_id = $1" : ""}`,
      scope === "dept" ? [deptId ?? ""] : []
    )
  );
  return rows.map((r) => ({ name: String(r.name ?? ""), email: String(r.email) }));
}
