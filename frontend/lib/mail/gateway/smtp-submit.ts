/**
 * 외부 메일 프로그램 게이트웨이 — SMTP 제출(포트 465, TLS 는 NLB 가 끝냄).
 * 아웃룩이 보낸 원문을 그대로 SES 로 중계하고, 보낸편지함에 사본을 남긴다.
 * - 발신자 위조 방지: 봉투 MAIL FROM 과 헤더 From 이 모두 내 메일함의 발신 가능 주소여야 한다.
 * - Bcc 헤더는 바깥으로 내보내지 않는다(봉투 수신자로만). 보낸 사본에는 숨은 수신자를 Bcc 로 남긴다.
 * - 사내 수신자 단락(280): 외부 MX 도메인의 우리 주소는 봉투만 SES 수신 주소로 바꾼다(웹 발송과 같다).
 * - 같은 Message-ID 재제출은 한 번만 보낸다(mail_send_log dedup). 시간당 발송 한도는 SES 한도를 웹과 나눠 쓴다.
 * 웹 발송의 수신 확인 픽셀은 붙이지 않는다(원문을 고치지 않는다).
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { sendRawEmail } from "@/lib/notify/email-ses";
import { getSystemFolderId, resolveMailboxAddresses } from "@/lib/mail/mailbox";
import { importRawMessage } from "@/lib/mail/import/store";
import { prepareSubmission, SmtpReject } from "@/lib/mail/gateway/smtp-prepare";
import type { GwUser } from "@/lib/mail/gateway/types";

/** 원문 상한 — SES v2 40MB 안쪽, 웹 첨부 25MB(base64 부풀림 포함)와 맞춘다. */
export const SMTP_MAX_BYTES = 36 * 1024 * 1024;
export const SMTP_MAX_RECIPIENTS = 100;
/** 메일함당 시간당 제출 건수 상한(웹 발송 포함 mail_send_log 기준). */
export const SMTP_HOURLY_LIMIT = 200;

async function claimSend(dedupKey: string, mailboxId: string): Promise<string | null> {
  let sendId: string | null = null;
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(
        `INSERT INTO mail_send_log (send_id, mailbox_id, dedup_key, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (dedup_key) DO NOTHING
         RETURNING send_id`,
        ["msl-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14), mailboxId, dedupKey, new Date().toISOString()]
      )
    );
    sendId = rows.length ? String(rows[0].send_id) : null;
  });
  return sendId;
}

/** 제출 1건 처리. 거절은 SmtpReject(응답 코드 포함)로 던진다. */
export async function submitMessage(user: GwUser, mailFrom: string, rcpts: string[], raw: Buffer): Promise<{ duplicate: boolean }> {
  if (!rcpts.length) throw new SmtpReject(554, "No valid recipients");
  if (rcpts.length > SMTP_MAX_RECIPIENTS) throw new SmtpReject(452, "Too many recipients");
  const prep = prepareSubmission(raw, user, mailFrom, rcpts);

  const db = await getDb();
  const recent = rowsToObjects(
    await db.exec(
      `SELECT COUNT(*)::int AS n FROM mail_send_log WHERE mailbox_id = $1 AND created_at > $2`,
      [user.mailboxId, new Date(Date.now() - 3600_000).toISOString()]
    )
  );
  if (Number(recent[0]?.n ?? 0) >= SMTP_HOURLY_LIMIT) throw new SmtpReject(451, "Hourly sending limit reached, try again later");

  const sendId = await claimSend(`smtp:${user.mailboxId}:${prep.messageIdHeader}`, user.mailboxId);
  if (!sendId) return { duplicate: true };

  const internal = await resolveMailboxAddresses(rcpts);
  const destinations = [
    ...new Set(
      rcpts.map((r) => {
        const hit = internal.get(r.trim().toLowerCase());
        return hit && hit.inboundMode === "external" && hit.sesAddress ? hit.sesAddress : r;
      })
    ),
  ];
  const res = await sendRawEmail({ raw: prep.outgoing, source: mailFrom, destinations });
  if (!res.ok) {
    await withDbWrite(async (wdb) => {
      await wdb.run(`DELETE FROM mail_send_log WHERE send_id = $1`, [sendId]);
    });
    console.error("[mail-gw] SES 발송 실패", { mailbox: user.address, error: res.error });
    throw new SmtpReject(451, "Temporary sending failure, try again later");
  }

  // 발송은 끝났다 — 사본 저장 실패는 기록만 남기고 성공으로 응답한다(재전송으로 중복 발송되지 않게).
  try {
    const sentFolderId = await getSystemFolderId(user.mailboxId, "sent");
    const stored = await importRawMessage(prep.sentCopy, {
      mailboxId: user.mailboxId,
      folderId: sentFolderId,
      direction: "out",
      isRead: true,
      labels: [],
      rawKeyPrefix: "mail-client",
    });
    await withDbWrite(async (wdb) => {
      await wdb.run(`UPDATE mail_messages SET ses_message_id = COALESCE(ses_message_id, $2) WHERE message_id = $1`, [
        stored.messageId,
        res.sesMessageId ?? null,
      ]);
      await wdb.run(`UPDATE mail_send_log SET ok = 1, message_id = $2, ses_message_id = $3, to_count = $4 WHERE send_id = $1`, [
        sendId,
        stored.messageId,
        res.sesMessageId ?? null,
        rcpts.length,
      ]);
    });
  } catch (err) {
    console.error("[mail-gw] 보낸 사본 저장 실패", { mailbox: user.address, error: (err as Error).message });
    await withDbWrite(async (wdb) => {
      await wdb.run(`UPDATE mail_send_log SET ok = 1, ses_message_id = $2, to_count = $3, error = $4 WHERE send_id = $1`, [
        sendId,
        res.sesMessageId ?? null,
        rcpts.length,
        "sent copy not stored",
      ]);
    }).catch(() => undefined);
  }
  return { duplicate: false };
}
