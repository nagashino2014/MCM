/**
 * 코넨사인 메일 — 드래프트(임시저장) CRUD(G2-5).
 * 작성기 자동저장(디바운스)이 upsert 하고, 발송 성공 시 삭제한다. 소유 mailbox 한정.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getMailboxByUser } from "@/lib/mail/mailbox";

export interface MailDraft {
  draftId: string;
  to: string;
  cc: string;
  subject: string;
  bodyHtml: string;
  inReplyTo: string | null;
  updatedAt: string;
}

function toDraft(r: Record<string, unknown>): MailDraft {
  const addr = (v: unknown): string => {
    // to_addrs jsonb 는 문자열 배열로 저장(주소 문자열 그대로 — 작성기 입력값 보존).
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "string") {
      try {
        const p = JSON.parse(v);
        return Array.isArray(p) ? p.join(", ") : "";
      } catch {
        return "";
      }
    }
    return "";
  };
  return {
    draftId: String(r.draft_id),
    to: addr(r.to_addrs),
    cc: addr(r.cc_addrs),
    subject: r.subject != null ? String(r.subject) : "",
    bodyHtml: r.body_html != null ? String(r.body_html) : "",
    inReplyTo: r.in_reply_to != null ? String(r.in_reply_to) : null,
    updatedAt: String(r.updated_at),
  };
}

/** 드래프트 목록(최신순). */
export async function listDrafts(userId: string): Promise<MailDraft[]> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT * FROM mail_drafts WHERE mailbox_id = $1 ORDER BY updated_at DESC LIMIT 100`, [mailbox.mailboxId])
  );
  return rows.map(toDraft);
}

/** 드래프트 upsert — draftId 없으면 생성해 반환. */
export async function saveDraft(
  userId: string,
  input: { draftId?: string | null; to: string; cc: string; subject: string; bodyHtml: string; inReplyTo?: string | null }
): Promise<string> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) throw new Error("메일함이 없습니다.");
  const draftId = input.draftId || "mdrf-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const now = new Date().toISOString();
  const toJson = JSON.stringify(
    input.to.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
  );
  const ccJson = JSON.stringify(
    input.cc.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
  );
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO mail_drafts (draft_id, mailbox_id, to_addrs, cc_addrs, subject, body_html, in_reply_to, updated_at)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8)
       ON CONFLICT (draft_id) DO UPDATE SET to_addrs = EXCLUDED.to_addrs, cc_addrs = EXCLUDED.cc_addrs,
         subject = EXCLUDED.subject, body_html = EXCLUDED.body_html, in_reply_to = EXCLUDED.in_reply_to, updated_at = EXCLUDED.updated_at`,
      [draftId, mailbox.mailboxId, toJson, ccJson, input.subject, input.bodyHtml, input.inReplyTo ?? null, now]
    );
  });
  return draftId;
}

/** 드래프트 삭제(발송 성공·수동 삭제). 소유 검증 포함. */
export async function deleteDraft(userId: string, draftId: string): Promise<void> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return;
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM mail_drafts WHERE draft_id = $1 AND mailbox_id = $2`, [draftId, mailbox.mailboxId]);
  });
}
