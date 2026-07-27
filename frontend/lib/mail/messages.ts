/**
 * 코넨사인 메일 — 메일함 메시지 조회(목록). P1 은 보낸편지함(sent)을 쓴다.
 * 설계: docs/company-email-blueprint.md §4-P3(목록·스레드는 P3 에서 확장).
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getMailboxByUser, getSystemFolderId } from "@/lib/mail/mailbox";

export interface MailListItem {
  messageId: string;
  direction: string;
  subject: string;
  snippet: string;
  fromAddr: string | null;
  toAddrs: { name?: string; address: string }[];
  hasAttachments: boolean;
  sentAt: string | null;
  createdAt: string;
  isRead: boolean;
  isStarred: boolean;
}

export interface MailFolderInfo {
  folderId: string;
  name: string;
  systemKind: string | null;
  sort: number;
  unread: number;
  total: number;
}

/** 폴더 목록 + 폴더별 안읽음/전체 카운트(3-pane 좌측 트리용). 메일함 없으면 빈 배열. */
export async function listFolders(userId: string): Promise<{ folders: MailFolderInfo[]; address: string | null }> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return { folders: [], address: null };
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT f.folder_id, f.name, f.system_kind, f.sort,
              COUNT(s.message_id) FILTER (WHERE s.is_deleted = 0)::int AS total,
              COUNT(s.message_id) FILTER (WHERE s.is_deleted = 0 AND s.is_read = 0)::int AS unread
         FROM mail_folders f
         LEFT JOIN mail_message_state s ON s.folder_id = f.folder_id
        WHERE f.mailbox_id = $1
        GROUP BY f.folder_id, f.name, f.system_kind, f.sort
        ORDER BY f.sort, f.name`,
      [mailbox.mailboxId]
    )
  );
  return {
    address: mailbox.address,
    folders: rows.map((r) => ({
      folderId: String(r.folder_id),
      name: String(r.name),
      systemKind: r.system_kind != null ? String(r.system_kind) : null,
      sort: Number(r.sort ?? 0),
      unread: Number(r.unread ?? 0),
      total: Number(r.total ?? 0),
    })),
  };
}

export type MailBulkAction = "read" | "unread" | "star" | "unstar" | "trash" | "restore" | "move" | "delete";

/**
 * 일괄 상태 변경(소유 mailbox 한정·멱등).
 * - read/unread/star/unstar: 플래그 갱신
 * - trash: 현재 폴더 state 를 휴지통으로 이동 / restore: 휴지통 → 받은편지함(out 은 보낸편지함)
 * - move: targetKind 시스템 폴더로 이동(archive/spam/inbox)
 * - delete: 휴지통에서 영구 삭제(mail_messages CASCADE)
 */
export async function bulkUpdateMessages(
  userId: string,
  messageIds: string[],
  action: MailBulkAction,
  targetKind?: string
): Promise<{ updated: number }> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox || !messageIds.length) return { updated: 0 };
  const ids = [...new Set(messageIds)].filter(Boolean);
  const mbId = mailbox.mailboxId;
  let updated = 0;

  await withDbWrite(async (db) => {
    if (action === "read" || action === "unread") {
      await db.run(`UPDATE mail_message_state SET is_read = $3 WHERE mailbox_id = $2 AND message_id = ANY($1::text[])`, [
        ids,
        mbId,
        action === "read" ? 1 : 0,
      ]);
      updated = ids.length;
      return;
    }
    if (action === "star" || action === "unstar") {
      await db.run(`UPDATE mail_message_state SET is_starred = $3 WHERE mailbox_id = $2 AND message_id = ANY($1::text[])`, [
        ids,
        mbId,
        action === "star" ? 1 : 0,
      ]);
      updated = ids.length;
      return;
    }
    if (action === "delete") {
      // 휴지통에 있는 내 메시지만 영구 삭제(CASCADE 로 state/첨부 메타 제거. S3 원문은 보존기간 정책).
      await db.run(
        `DELETE FROM mail_messages m
          WHERE m.mailbox_id = $2 AND m.message_id = ANY($1::text[])
            AND EXISTS (
              SELECT 1 FROM mail_message_state s JOIN mail_folders f ON f.folder_id = s.folder_id
               WHERE s.message_id = m.message_id AND f.system_kind = 'trash'
            )`,
        [ids, mbId]
      );
      updated = ids.length;
      return;
    }
    // 이동 계열: trash/restore/move — 대상 시스템 폴더 결정 후 state 재배치.
    let destKind = targetKind ?? "";
    if (action === "trash") destKind = "trash";
    const now = new Date().toISOString();
    for (const messageId of ids) {
      let kind = destKind;
      if (action === "restore") {
        const dir = rowsToObjects(
          await db.exec(`SELECT direction FROM mail_messages WHERE message_id = $1 AND mailbox_id = $2`, [messageId, mbId])
        );
        if (!dir.length) continue;
        kind = String(dir[0].direction) === "out" ? "sent" : "inbox";
      }
      if (!kind) continue;
      const dest = rowsToObjects(
        await db.exec(`SELECT folder_id FROM mail_folders WHERE mailbox_id = $1 AND system_kind = $2`, [mbId, kind])
      );
      if (!dest.length) continue;
      const destFolderId = String(dest[0].folder_id);
      // 기존 배치 제거 후 대상 폴더로(읽음/별표 플래그는 기존 값 유지 시도 — 첫 row 기준).
      const prev = rowsToObjects(
        await db.exec(`SELECT is_read, is_starred FROM mail_message_state WHERE mailbox_id = $2 AND message_id = $1 LIMIT 1`, [
          messageId,
          mbId,
        ])
      );
      const isRead = prev.length ? Number(prev[0].is_read ?? 0) : 1;
      const isStarred = prev.length ? Number(prev[0].is_starred ?? 0) : 0;
      await db.run(`DELETE FROM mail_message_state WHERE mailbox_id = $2 AND message_id = $1`, [messageId, mbId]);
      await db.run(
        `INSERT INTO mail_message_state (message_id, folder_id, mailbox_id, is_read, is_starred, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (message_id, folder_id) DO NOTHING`,
        [messageId, destFolderId, mbId, isRead, isStarred, now]
      );
      updated++;
    }
  });
  return { updated };
}

function parseAddrs(v: unknown): { name?: string; address: string }[] {
  if (Array.isArray(v)) return v as { name?: string; address: string }[];
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 특정 시스템 폴더의 메시지 목록(최신순, 검색 q 옵션). 폴더가 없거나 메일함이 없으면 빈 배열. */
export async function listFolderMessages(
  userId: string,
  folderKind: string,
  opts?: { limit?: number; offset?: number; q?: string }
): Promise<{ items: MailListItem[]; total: number; address: string | null }> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return { items: [], total: 0, address: null };
  const folderId = await getSystemFolderId(mailbox.mailboxId, folderKind);
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const offset = Math.max(opts?.offset ?? 0, 0);
  const q = (opts?.q ?? "").trim();
  const db = await getDb();

  // 검색: 제목/발신자/스니펫/본문 ILIKE(소규모 메일함 전제 — 필요 시 tsvector 인덱스로 승격).
  const searchCond = q ? `AND (m.subject ILIKE $4 OR m.from_addr ILIKE $4 OR m.snippet ILIKE $4 OR m.body_text ILIKE $4)` : "";
  const searchParams = q ? [`%${q}%`] : [];

  const totalRows = rowsToObjects(
    await db.exec(
      `SELECT COUNT(*)::int AS n
         FROM mail_message_state s
         JOIN mail_messages m ON m.message_id = s.message_id
        WHERE s.folder_id = $1 AND s.is_deleted = 0 ${q ? "AND (m.subject ILIKE $2 OR m.from_addr ILIKE $2 OR m.snippet ILIKE $2 OR m.body_text ILIKE $2)" : ""}`,
      q ? [folderId, `%${q}%`] : [folderId]
    )
  );
  const total = totalRows.length ? Number(totalRows[0].n) : 0;

  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.message_id, m.direction, m.subject, m.snippet, m.from_addr, m.to_addrs,
              m.has_attachments, m.sent_at, m.created_at, s.is_read, s.is_starred
         FROM mail_message_state s
         JOIN mail_messages m ON m.message_id = s.message_id
        WHERE s.folder_id = $1 AND s.is_deleted = 0 ${searchCond}
        ORDER BY m.created_at DESC
        LIMIT $2 OFFSET $3`,
      [folderId, limit, offset, ...searchParams]
    )
  );

  const items: MailListItem[] = rows.map((r) => ({
    messageId: String(r.message_id),
    direction: String(r.direction),
    subject: r.subject != null ? String(r.subject) : "",
    snippet: r.snippet != null ? String(r.snippet) : "",
    fromAddr: r.from_addr != null ? String(r.from_addr) : null,
    toAddrs: parseAddrs(r.to_addrs),
    hasAttachments: Number(r.has_attachments ?? 0) === 1,
    sentAt: r.sent_at != null ? String(r.sent_at) : null,
    createdAt: String(r.created_at),
    isRead: Number(r.is_read ?? 0) === 1,
    isStarred: Number(r.is_starred ?? 0) === 1,
  }));

  return { items, total, address: mailbox.address };
}

export interface MailAttachmentMeta {
  attachmentId: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  /** 인라인 이미지(cid) — 뷰어가 본문 <img src="cid:..."> 를 다운로드 URL 로 치환할 때 사용. */
  contentId: string | null;
}

export interface MailMessageDetail {
  messageId: string;
  direction: string;
  subject: string;
  fromAddr: string | null;
  toAddrs: { name?: string; address: string }[];
  ccAddrs: { name?: string; address: string }[];
  bodyHtml: string | null;
  bodyText: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  attachments: MailAttachmentMeta[];
  /** 답장 스레딩용 — 이 메시지의 RFC Message-ID 와 References 체인. */
  rfcMessageId: string | null;
  references: string[];
}

/** 메시지 상세(소유권 검증 = 이 유저의 mailbox 여야 함). 없거나 남의 것이면 null. 조회 시 읽음 처리. */
export async function getMessageDetail(userId: string, messageId: string): Promise<MailMessageDetail | null> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT message_id, direction, subject, from_addr, to_addrs, cc_addrs, body_html, body_text,
              sent_at, received_at, created_at, rfc_message_id, references_json
         FROM mail_messages WHERE message_id = $1 AND mailbox_id = $2`,
      [messageId, mailbox.mailboxId]
    )
  );
  if (!rows.length) return null;
  const r = rows[0];

  const atts = rowsToObjects(
    await db.exec(
      `SELECT attachment_id, filename, content_type, size_bytes, content_id FROM mail_attachments WHERE message_id = $1 ORDER BY created_at`,
      [messageId]
    )
  );

  // 읽음 처리(이 유저 mailbox 의 해당 메시지 상태 전부).
  await withDbWrite(async (wdb) => {
    await wdb.run(`UPDATE mail_message_state SET is_read = 1 WHERE message_id = $1 AND mailbox_id = $2`, [
      messageId,
      mailbox.mailboxId,
    ]);
  });

  return {
    messageId: String(r.message_id),
    direction: String(r.direction),
    subject: r.subject != null ? String(r.subject) : "",
    fromAddr: r.from_addr != null ? String(r.from_addr) : null,
    toAddrs: parseAddrs(r.to_addrs),
    ccAddrs: parseAddrs(r.cc_addrs),
    bodyHtml: r.body_html != null ? String(r.body_html) : null,
    bodyText: r.body_text != null ? String(r.body_text) : null,
    sentAt: r.sent_at != null ? String(r.sent_at) : null,
    receivedAt: r.received_at != null ? String(r.received_at) : null,
    createdAt: String(r.created_at),
    attachments: atts.map((a) => ({
      attachmentId: String(a.attachment_id),
      filename: String(a.filename),
      contentType: a.content_type != null ? String(a.content_type) : null,
      sizeBytes: a.size_bytes != null ? Number(a.size_bytes) : null,
      contentId: a.content_id != null ? String(a.content_id) : null,
    })),
    rfcMessageId: r.rfc_message_id != null ? String(r.rfc_message_id) : null,
    references: (() => {
      const v = r.references_json;
      if (Array.isArray(v)) return v.map(String);
      if (typeof v === "string") {
        try {
          const p = JSON.parse(v);
          return Array.isArray(p) ? p.map(String) : [];
        } catch {
          return [];
        }
      }
      return [];
    })(),
  };
}

/** 첨부 1건 메타 + 소유권 검증(userId 의 mailbox 메시지에 속한 첨부여야 함). S3 키 반환. */
export async function getAttachmentForUser(
  userId: string,
  attachmentId: string
): Promise<{ filename: string; contentType: string | null; s3Key: string } | null> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT a.filename, a.content_type, a.s3_key
         FROM mail_attachments a JOIN mail_messages m ON m.message_id = a.message_id
        WHERE a.attachment_id = $1 AND m.mailbox_id = $2`,
      [attachmentId, mailbox.mailboxId]
    )
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    filename: String(r.filename),
    contentType: r.content_type != null ? String(r.content_type) : null,
    s3Key: String(r.s3_key),
  };
}
