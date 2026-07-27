/**
 * 코넨사인 메일 — 발송 오케스트레이션(P1).
 * 흐름: mailbox 보장 → MIME 조립 → SES SendRawEmail → 성공 시 첨부 S3 + Sent 폴더 적재 → 발송 로그(멱등).
 * 멱등: mail_send_log.dedup_key(클라이언트 idempotencyKey 또는 Message-ID)로 중복 발송(더블클릭/재시도) 억제.
 * 설계: docs/company-email-blueprint.md §4-P1.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { sendRawEmail } from "@/lib/notify/email-ses";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { buildMimeMessage, htmlToPlainText, type MailAddress, type MimeAttachment } from "@/lib/mail/mime";
import { ensureMailbox, getSystemFolderId, MAIL_DOMAIN } from "@/lib/mail/mailbox";
import { encodeRecipient } from "@/lib/mail/receipts";

export interface SendAttachmentInput {
  filename: string;
  contentType: string;
  content: Buffer;
  /** 인라인 이미지(cid) — 본문 <img src="cid:..."> 참조용. 지정 시 MIME disposition=inline. */
  contentId?: string;
}

export interface SendMailInput {
  userId: string;
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  subject: string;
  bodyHtml: string;
  attachments?: SendAttachmentInput[];
  inReplyTo?: string | null;
  references?: string[];
  /** 더블클릭/재시도 중복 억제용. 미지정 시 Message-ID 로 dedup(= 사실상 항상 신규). */
  idempotencyKey?: string;
}

export interface SendMailResult {
  ok: boolean;
  messageId?: string;
  sesMessageId?: string;
  duplicate?: boolean;
  error?: string;
}

function newId(prefix: string): string {
  return prefix + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
}

/** 발송 로그를 1회 선점(claim). 새로 선점하면 send_id, 이미 있으면 null(중복). */
async function claimSend(dedupKey: string, mailboxId: string): Promise<string | null> {
  let sendId: string | null = null;
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(
        `INSERT INTO mail_send_log (send_id, mailbox_id, dedup_key, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (dedup_key) DO NOTHING
         RETURNING send_id`,
        [newId("msl"), mailboxId, dedupKey, new Date().toISOString()]
      )
    );
    sendId = rows.length ? String(rows[0].send_id) : null;
  });
  return sendId;
}

/** 발송. 성공 시 보낸편지함(Sent)에 적재하고 mail_send_log 를 확정한다. */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const to = (input.to ?? []).filter((a) => a.address && /.+@.+\..+/.test(a.address));
  if (!to.length) return { ok: false, error: "받는 사람이 필요합니다." };
  const cc = (input.cc ?? []).filter((a) => a.address && /.+@.+\..+/.test(a.address));
  const bcc = (input.bcc ?? []).filter((a) => a.address && /.+@.+\..+/.test(a.address));

  const mailbox = await ensureMailbox(input.userId);
  if (mailbox.status !== "active") return { ok: false, error: "발송이 정지된 메일함입니다." };

  const from: MailAddress = { name: mailbox.displayName, address: mailbox.address };
  const messageId = `<${crypto.randomUUID().replace(/-/g, "")}@${MAIL_DOMAIN}>`;
  const dedupKey = input.idempotencyKey ? `idem:${mailbox.mailboxId}:${input.idempotencyKey}` : `mid:${messageId}`;

  // 멱등 선점 — 이미 발송된 요청이면 스킵.
  const sendId = await claimSend(dedupKey, mailbox.mailboxId);
  if (!sendId) return { ok: true, duplicate: true };

  const html = input.bodyHtml ?? "";
  const text = htmlToPlainText(html);
  const attachments: MimeAttachment[] = (input.attachments ?? []).map((a) => ({
    filename: a.filename,
    contentType: a.contentType || "application/octet-stream",
    content: a.content,
    contentId: a.contentId,
  }));

  // 메시지 ID 를 발송 전에 확정 — 수신자별 추적 픽셀 URL(수신 확인, G2-10)에 필요.
  const msgId = newId("mmsg");
  const trackBase = (process.env.APP_PUBLIC_URL ?? "https://koensain.app").replace(/\/+$/, "");

  // 수신자별 개별 발송: 헤더(To/Cc)는 전체 그대로 두고 SES Destinations 만 1명씩 지정 —
  // 각 수신자에게 자기 전용 추적 픽셀이 든 사본이 전달된다(그룹웨어 수신확인 표준 방식).
  const allRecipients = [...to, ...cc, ...bcc];
  let sesMessageId: string | undefined;
  let rawLength = 0;
  const failed: string[] = [];
  for (const r of allRecipients) {
    const pixel = `<img src="${trackBase}/api/mail/track?m=${msgId}&r=${encodeRecipient(r.address)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;overflow:hidden">`;
    const raw = buildMimeMessage({
      from,
      to,
      cc,
      subject: input.subject ?? "",
      text,
      html: html + pixel,
      attachments,
      messageId,
      inReplyTo: input.inReplyTo ?? null,
      references: input.references ?? [],
    });
    if (!rawLength) rawLength = raw.length;
    const res = await sendRawEmail({ raw, source: mailbox.address, destinations: [r.address] });
    if (res.ok) {
      sesMessageId ??= res.sesMessageId;
    } else {
      failed.push(`${r.address}: ${res.error ?? "실패"}`);
    }
  }

  if (!sesMessageId) {
    // 전체 실패 → 선점(claim)을 해제해 같은 idempotencyKey 로 재시도할 수 있게 한다.
    // (남겨두면 dedup UNIQUE 때문에 재시도가 '이미 발송됨'으로 잘못 막힘.)
    console.error("[mail-send] SES 발송 실패", { mailbox: mailbox.address, failed });
    await withDbWrite(async (db) => {
      await db.run(`DELETE FROM mail_send_log WHERE send_id = $1`, [sendId]);
    });
    return { ok: false, error: failed[0] ?? "발송 실패" };
  }
  if (failed.length) console.warn("[mail-send] 일부 수신자 발송 실패", { messageId: msgId, failed });

  // 성공 → 첨부 S3 저장 + Sent 폴더 적재 + 로그 확정. Sent 사본에는 픽셀을 넣지 않는다(자기 열람 오기록 방지).
  const now = new Date().toISOString();
  const sentFolderId = await getSystemFolderId(mailbox.mailboxId, "sent");
  const snippet = text.slice(0, 200);

  // 첨부는 트랜잭션 밖에서 S3 업로드(멱등 키 = message_id/파일명).
  const storedAtts: { filename: string; contentType: string; size: number; s3Key: string; contentId: string | null }[] = [];
  for (const a of input.attachments ?? []) {
    const fname = sanitizeFilename(a.filename || "attachment");
    const storageKey = ["mail", mailbox.mailboxId, msgId, fname].join("/");
    const stored = await putContractDocument(storageKey, a.content, a.contentType || "application/octet-stream");
    storedAtts.push({
      filename: fname,
      contentType: a.contentType || "application/octet-stream",
      size: a.content.length,
      s3Key: stored.storageKey,
      contentId: a.contentId ?? null,
    });
  }

  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO mail_messages
         (message_id, mailbox_id, direction, rfc_message_id, thread_id, in_reply_to, references_json,
          from_addr, to_addrs, cc_addrs, bcc_addrs, reply_to, subject, snippet, body_text, body_html,
          size_bytes, has_attachments, ses_message_id, sent_at, created_at)
       VALUES ($1,$2,'out',$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)`,
      [
        msgId,
        mailbox.mailboxId,
        messageId,
        messageId, // 스레드 시작 = 자기 Message-ID
        input.inReplyTo ?? null,
        JSON.stringify(input.references ?? []),
        mailbox.address,
        JSON.stringify(to),
        JSON.stringify(cc),
        JSON.stringify(bcc),
        null,
        input.subject ?? "",
        snippet,
        text,
        html,
        rawLength,
        attachments.length ? 1 : 0,
        sesMessageId ?? null,
        now,
      ]
    );
    for (const att of storedAtts) {
      await db.run(
        `INSERT INTO mail_attachments (attachment_id, message_id, filename, content_type, size_bytes, s3_key, content_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [newId("matt"), msgId, att.filename, att.contentType, att.size, att.s3Key, att.contentId, now]
      );
    }
    // 보낸편지함 배치(읽음 처리).
    await db.run(
      `INSERT INTO mail_message_state (message_id, folder_id, mailbox_id, is_read, created_at)
       VALUES ($1,$2,$3,1,$4) ON CONFLICT (message_id, folder_id) DO NOTHING`,
      [msgId, sentFolderId, mailbox.mailboxId, now]
    );
    await db.run(
      `UPDATE mail_send_log SET ok = 1, message_id = $2, ses_message_id = $3, to_count = $4 WHERE send_id = $1`,
      [sendId, msgId, sesMessageId ?? null, allRecipients.length]
    );
  });

  return { ok: true, messageId: msgId, sesMessageId };
}
