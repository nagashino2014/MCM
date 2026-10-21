/**
 * 메일 가져오기(I-1) — 과거 메일 1통 저장.
 * inbound.ts storeForMailbox 는 신규 수신 전용(방향 'in' 고정·Bcc 빈 값·스팸 판정·안 읽음)이라 쓰지 않는다.
 * 저장 순서(재시도 안전, 설계 §2.6):
 *   1) 원문·첨부를 S3 에 먼저 올린다 — 키는 메시지 해시 기반이라 재시도해도 같은 키에 덮어쓴다.
 *   2) 한 트랜잭션에서 메시지·첨부·폴더 배치를 함께 기록한다. 실패하면 모두 롤백.
 *   3) 같은 Message-ID 가 이미 있으면 메시지는 새로 만들지 않고 이번 폴더 배치·라벨만 추가한다(폴더 소속 유지).
 * 스팸 판정·수신 확인·새 메일 알림은 적용하지 않는다.
 */
import crypto from "node:crypto";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { cleanSnippet, htmlToPlainText } from "@/lib/mail/mime";

export interface ImportTarget {
  mailboxId: string;
  folderId: string;
  direction: "in" | "out";
  isRead: boolean;
  /** mail_message_state.labels 에 더할 라벨(예: import:아마란스/받은메일함). */
  labels: string[];
  /** 원문 S3 키 접두(기본 mail-import). 외부 메일 프로그램이 올린 메일은 mail-client. */
  rawKeyPrefix?: string;
}

export interface ImportResult {
  outcome: "imported" | "duplicate";
  /** 저장된(또는 이미 있던) mail_messages.message_id — IMAP APPEND 가 UID 를 찾을 때 쓴다. */
  messageId: string;
  bytes: number;
  /** 본문에 대용량 첨부 링크로 보이는 것이 있음(원본 파일은 함께 오지 않음). */
  linkAttachment: boolean;
}

/** 파싱 실패 등 이 메일만 건너뛸 오류(작업은 계속). */
export class ImportItemError extends Error {}

function addrList(a: AddressObject | AddressObject[] | undefined): { name?: string; address: string }[] {
  if (!a) return [];
  const arr = Array.isArray(a) ? a : [a];
  const out: { name?: string; address: string }[] = [];
  for (const obj of arr) {
    for (const v of obj.value ?? []) {
      if (v.address) out.push({ name: v.name || undefined, address: v.address });
    }
  }
  return out;
}

// "대용량 첨부" 안내 블록(아마란스·네이버 bigfile·타사 그룹웨어) — 문구 근처(앞 300·뒤 600자)에
// 이미지가 아닌 링크가 있을 때만 링크형 첨부로 본다. 문구만 있는 본문은 제외(10-16 표본: 10통 중 6통이 문구만).
const LINK_ATTACH_RE = /(대용량\s*첨부|대용량\s*파일|large\s*attachment)/gi;
const NEAR_LINK_RE = /https?:\/\/[^\s"'<>]+/gi;
const IMAGE_LINK_RE = /\.(png|gif|jpe?g|svg|webp)(\?|$)|pstatic\.net/i;

function hasLinkAttachment(parsed: ParsedMail): boolean {
  const body = `${parsed.html || ""}\n${parsed.text || ""}`;
  for (const m of body.matchAll(LINK_ATTACH_RE)) {
    const near = body.slice(Math.max(0, (m.index ?? 0) - 300), (m.index ?? 0) + m[0].length + 600);
    for (const link of near.match(NEAR_LINK_RE) ?? []) {
      if (!IMAGE_LINK_RE.test(link)) return true;
    }
  }
  return false;
}

async function mergeState(mailboxId: string, messageId: string, t: ImportTarget, now: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO mail_message_state (message_id, folder_id, mailbox_id, is_read, labels, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (message_id, folder_id) DO UPDATE
         SET labels = (SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb)
                         FROM jsonb_array_elements(mail_message_state.labels || EXCLUDED.labels) AS x)`,
      [messageId, t.folderId, mailboxId, t.isRead ? 1 : 0, JSON.stringify(t.labels), now]
    );
  });
}

/** 원문 1통을 가져온다. 크기·파싱 문제는 ImportItemError, 저장소·DB 문제는 일반 오류(작업 일시 중지 대상). */
export async function importRawMessage(raw: Buffer, t: ImportTarget, fallbackDate?: Date): Promise<ImportResult> {
  let parsed: ParsedMail;
  try {
    parsed = await simpleParser(raw);
  } catch (err) {
    throw new ImportItemError(`손상(파싱 실패: ${err instanceof Error ? err.message : String(err)})`);
  }
  const rawHash = crypto.createHash("sha256").update(raw).digest("hex");
  const rfcMessageId = (parsed.messageId && String(parsed.messageId).trim()) || `<import-${rawHash}@mcm.local>`;
  // 메시지 id·첨부 키는 (메일함, Message-ID) 해시로 고정 — 재시도·동시 처리에도 같은 행·같은 키가 된다.
  const idHash = crypto.createHash("sha256").update(`${t.mailboxId}\n${rfcMessageId}`).digest("hex");
  const msgId = `mmsg-i${idHash.slice(0, 13)}`;
  const now = new Date().toISOString();
  const linkAttachment = hasLinkAttachment(parsed);

  const db = await getDb();
  const existing = rowsToObjects(
    await db.exec(`SELECT message_id FROM mail_messages WHERE mailbox_id = $1 AND rfc_message_id = $2 LIMIT 1`, [
      t.mailboxId,
      rfcMessageId,
    ])
  );
  if (existing.length) {
    await mergeState(t.mailboxId, String(existing[0].message_id), t, now);
    return { outcome: "duplicate", messageId: String(existing[0].message_id), bytes: 0, linkAttachment };
  }

  // 1) S3 선업로드(원문 + 첨부).
  const rawKey = [t.rawKeyPrefix ?? "mail-import", t.mailboxId, `${idHash.slice(0, 32)}.eml`].join("/");
  await putContractDocument(rawKey, raw, "message/rfc822");
  const attachments = (parsed.attachments ?? []).filter((a) => a.content && (a.content as Buffer).length);
  const stored: { filename: string; contentType: string; size: number; s3Key: string; contentId: string | null }[] = [];
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i];
    const fname = sanitizeFilename(a.filename || `attachment-${i + 1}`);
    const key = ["mail", t.mailboxId, msgId, `${i + 1}-${fname}`].join("/");
    const buf = a.content as Buffer;
    const s3 = await putContractDocument(key, buf, a.contentType || "application/octet-stream");
    stored.push({
      filename: fname,
      contentType: a.contentType || "application/octet-stream",
      size: buf.length,
      s3Key: s3.storageKey,
      contentId: a.contentId ? String(a.contentId).replace(/[<>]/g, "") : null,
    });
  }

  // 2) 한 트랜잭션 기록.
  const from = addrList(parsed.from);
  const to = addrList(parsed.to);
  const cc = addrList(parsed.cc);
  const bcc = addrList(parsed.bcc);
  const references = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [];
  const threadId = references.length ? String(references[0]) : parsed.inReplyTo ? String(parsed.inReplyTo) : rfcMessageId;
  const html = parsed.html || null;
  const text = parsed.text ?? (html ? htmlToPlainText(html) : "");
  const date = parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : fallbackDate ?? new Date();
  const when = date.toISOString();

  let inserted = false;
  await withDbWrite(async (wdb) => {
    const rows = rowsToObjects(
      await wdb.exec(
        `INSERT INTO mail_messages
           (message_id, mailbox_id, direction, rfc_message_id, thread_id, in_reply_to, references_json,
            from_addr, to_addrs, cc_addrs, bcc_addrs, reply_to, subject, snippet, body_text, body_html,
            raw_s3_key, size_bytes, has_attachments, sent_at, received_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
         ON CONFLICT DO NOTHING
         RETURNING message_id`,
        [
          msgId,
          t.mailboxId,
          t.direction,
          rfcMessageId,
          threadId,
          parsed.inReplyTo ? String(parsed.inReplyTo) : null,
          JSON.stringify(references.map(String)),
          from[0]?.address ?? null,
          JSON.stringify(to),
          JSON.stringify(cc),
          JSON.stringify(bcc),
          parsed.replyTo ? addrList(parsed.replyTo)[0]?.address ?? null : null,
          parsed.subject ?? "",
          cleanSnippet(text || ""),
          text,
          html,
          rawKey,
          raw.length,
          stored.length ? 1 : 0,
          t.direction === "out" ? when : null,
          t.direction === "in" ? when : null,
          // 목록 정렬이 created_at 기준 — 가져온 시각이 아니라 원래 날짜로 둬야 과거 메일이 맨 위로 오지 않는다.
          when,
        ]
      )
    );
    if (!rows.length) return; // 동시에 같은 메일이 먼저 들어옴 → 아래에서 중복 처리
    inserted = true;
    for (const s of stored) {
      await wdb.run(
        `INSERT INTO mail_attachments (attachment_id, message_id, filename, content_type, size_bytes, s3_key, content_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        ["matt-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14), msgId, s.filename, s.contentType, s.size, s.s3Key, s.contentId, now]
      );
    }
    await wdb.run(
      `INSERT INTO mail_message_state (message_id, folder_id, mailbox_id, is_read, labels, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT (message_id, folder_id) DO NOTHING`,
      [msgId, t.folderId, t.mailboxId, t.isRead ? 1 : 0, JSON.stringify(t.labels), now]
    );
  });

  if (!inserted) {
    const again = rowsToObjects(
      await db.exec(`SELECT message_id FROM mail_messages WHERE mailbox_id = $1 AND rfc_message_id = $2 LIMIT 1`, [
        t.mailboxId,
        rfcMessageId,
      ])
    );
    if (!again.length) throw new Error("메일 기록이 충돌했지만 기존 메일을 찾지 못했습니다.");
    await mergeState(t.mailboxId, String(again[0].message_id), t, now);
    return { outcome: "duplicate", messageId: String(again[0].message_id), bytes: 0, linkAttachment };
  }
  return { outcome: "imported", messageId: msgId, bytes: raw.length, linkAttachment };
}
