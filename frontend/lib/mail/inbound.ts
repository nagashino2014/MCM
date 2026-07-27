/**
 * 코넨사인 메일 — 수신 파이프라인(P2).
 * SES Receipt Rule(S3 저장 + SNS 통지) → SNS→SQS → next tick 이 이 함수로 폴링·파싱·적재.
 * 흐름: SQS 수신 → SES 통지 JSON 파싱 → 수신 버킷에서 원문 MIME GET → mailparser 파싱 →
 *       수신자 로컬파트로 mailbox 해석(별칭 fan-out) → mail_messages(direction='in') + 첨부 + inbox 적재.
 * 멱등: UNIQUE(mailbox_id, rfc_message_id) — 재수신/재처리 시 중복 적재 안 됨.
 * 설계: docs/company-email-blueprint.md §4-P2.
 */
import crypto from "node:crypto";
import {
  SQSClient,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getS3Client } from "@/lib/storage/logo-storage";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { getSystemFolderId, MAIL_DOMAIN } from "@/lib/mail/mailbox";
import { htmlToPlainText } from "@/lib/mail/mime";

let sqs: InstanceType<typeof SQSClient> | null = null;
let cachedQueueUrl: string | null = null;

function getSqs(): InstanceType<typeof SQSClient> {
  sqs ??= new SQSClient({ region: process.env.AWS_REGION ?? "ap-northeast-2" });
  return sqs;
}

function newId(prefix: string): string {
  return prefix + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
}

/** 수신 큐 이름 — env 우선, 없으면 스토리지 버킷(mcm-...-data)에서 접두어 유도. */
function inboundQueueName(): string | null {
  const explicit = process.env.MAIL_INBOUND_QUEUE_NAME?.trim();
  if (explicit) return explicit;
  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (bucket && bucket.endsWith("-data")) return bucket.slice(0, -"-data".length) + "-mail-inbound";
  return null;
}

/** 큐 URL 을 이름으로 조회(캐시). 큐가 아직 없으면 null → tick no-op. */
async function resolveQueueUrl(): Promise<string | null> {
  if (cachedQueueUrl) return cachedQueueUrl;
  const name = inboundQueueName();
  if (!name) return null;
  try {
    const out = await getSqs().send(new GetQueueUrlCommand({ QueueName: name }));
    cachedQueueUrl = out.QueueUrl ?? null;
    return cachedQueueUrl;
  } catch {
    return null; // 큐 미생성(인프라 미적용) 등
  }
}

interface SesNotification {
  bucketName: string;
  objectKey: string;
  destination: string[];
  sesMessageId: string | null;
}

/** SQS 본문(raw delivery = SES 수신 통지 JSON)에서 S3 위치·수신자 추출. */
function parseNotification(body: string): SesNotification | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(body);
  } catch {
    return null;
  }
  // SNS 봉투가 붙어온 경우(raw delivery 미적용 대비) 한 겹 벗긴다.
  if (typeof j.Message === "string" && !("receipt" in j)) {
    try {
      j = JSON.parse(j.Message);
    } catch {
      return null;
    }
  }
  const receipt = j.receipt as { action?: { bucketName?: string; objectKey?: string } } | undefined;
  const mail = j.mail as { destination?: string[]; messageId?: string } | undefined;
  const action = receipt?.action;
  if (!action?.bucketName || !action?.objectKey) return null;
  return {
    bucketName: String(action.bucketName),
    objectKey: String(action.objectKey),
    destination: Array.isArray(mail?.destination) ? mail!.destination!.map(String) : [],
    sesMessageId: mail?.messageId ? String(mail.messageId) : null,
  };
}

async function fetchRawMime(bucket: string, key: string): Promise<Buffer> {
  const out = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = out.Body as unknown as { transformToByteArray?: () => Promise<Uint8Array> };
  if (body?.transformToByteArray) return Buffer.from(await body.transformToByteArray());
  // 폴백: 스트림 수집
  const chunks: Buffer[] = [];
  for await (const c of out.Body as unknown as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

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

interface TargetMailbox {
  mailboxId: string;
  address: string;
}

/** 수신자(우리 도메인) 로컬파트 → mailbox 해석. 별칭이면 대상 mailbox 로 fan-out. */
async function resolveRecipients(destinations: string[]): Promise<TargetMailbox[]> {
  const locals = new Set<string>();
  for (const d of destinations) {
    const m = d.toLowerCase().match(/^([^@]+)@(.+)$/);
    if (m && m[2] === MAIL_DOMAIN) locals.add(m[1]);
  }
  if (!locals.size) return [];
  const db = await getDb();
  const localArr = [...locals];

  const direct = rowsToObjects(
    await db.exec(
      `SELECT mailbox_id, address FROM mailboxes WHERE local_part = ANY($1::text[]) AND status = 'active'`,
      [localArr]
    )
  );
  const result = new Map<string, TargetMailbox>();
  for (const r of direct) result.set(String(r.mailbox_id), { mailboxId: String(r.mailbox_id), address: String(r.address) });

  // 별칭/배포리스트 fan-out.
  const aliases = rowsToObjects(
    await db.exec(
      `SELECT target_mailbox_ids FROM mail_aliases WHERE alias_local = ANY($1::text[]) AND active = 1`,
      [localArr]
    )
  );
  const aliasTargetIds = new Set<string>();
  for (const a of aliases) {
    const ids = a.target_mailbox_ids;
    const parsed = Array.isArray(ids) ? ids : typeof ids === "string" ? JSON.parse(ids || "[]") : [];
    for (const id of parsed) aliasTargetIds.add(String(id));
  }
  if (aliasTargetIds.size) {
    const rows = rowsToObjects(
      await db.exec(`SELECT mailbox_id, address FROM mailboxes WHERE mailbox_id = ANY($1::text[]) AND status = 'active'`, [
        [...aliasTargetIds],
      ])
    );
    for (const r of rows) result.set(String(r.mailbox_id), { mailboxId: String(r.mailbox_id), address: String(r.address) });
  }
  return [...result.values()];
}

/** 파싱된 메일을 한 mailbox 의 받은편지함에 적재(멱등). 새로 적재하면 true. */
async function storeForMailbox(
  target: TargetMailbox,
  parsed: ParsedMail,
  notif: SesNotification
): Promise<boolean> {
  const rfcMessageId =
    (parsed.messageId && String(parsed.messageId)) ||
    (notif.sesMessageId ? `<ses-${notif.sesMessageId}@${MAIL_DOMAIN}>` : `<${crypto.randomUUID()}@${MAIL_DOMAIN}>`);

  const db = await getDb();
  // 멱등 선점: 이미 이 mailbox 에 같은 Message-ID 가 있으면 skip.
  const msgId = newId("mmsg");
  const now = new Date().toISOString();
  const from = addrList(parsed.from);
  const to = addrList(parsed.to);
  const cc = addrList(parsed.cc);
  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : [];
  const threadId = references.length ? String(references[0]) : parsed.inReplyTo ? String(parsed.inReplyTo) : rfcMessageId;
  const html = parsed.html || null;
  const text = parsed.text ?? (html ? htmlToPlainText(html) : "");
  const snippet = (text || "").slice(0, 200);
  const receivedAt = parsed.date ? new Date(parsed.date).toISOString() : now;
  const attachments = (parsed.attachments ?? []).filter((a) => a.content && (a.content as Buffer).length);

  const inserted = rowsToObjects(
    await db.exec(
      `INSERT INTO mail_messages
         (message_id, mailbox_id, direction, rfc_message_id, thread_id, in_reply_to, references_json,
          from_addr, to_addrs, cc_addrs, bcc_addrs, reply_to, subject, snippet, body_text, body_html,
          raw_s3_key, size_bytes, has_attachments, ses_message_id, received_at, created_at)
       VALUES ($1,$2,'in',$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,'[]'::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
       ON CONFLICT (mailbox_id, rfc_message_id) DO NOTHING
       RETURNING message_id`,
      [
        msgId,
        target.mailboxId,
        rfcMessageId,
        threadId,
        parsed.inReplyTo ? String(parsed.inReplyTo) : null,
        JSON.stringify(references.map(String)),
        from[0]?.address ?? null,
        JSON.stringify(to),
        JSON.stringify(cc),
        parsed.replyTo ? addrList(parsed.replyTo)[0]?.address ?? null : null,
        parsed.subject ?? "",
        snippet,
        text,
        html,
        notif.objectKey,
        null,
        attachments.length ? 1 : 0,
        notif.sesMessageId,
        receivedAt,
      ]
    )
  );
  if (!inserted.length) return false; // 이미 적재됨

  // 첨부 저장(app_data 버킷) + inbox 배치.
  const stored: { filename: string; contentType: string; size: number; s3Key: string; contentId: string | null }[] = [];
  for (const a of attachments) {
    const fname = sanitizeFilename(a.filename || "attachment");
    const storageKey = ["mail", target.mailboxId, msgId, fname].join("/");
    const buf = a.content as Buffer;
    const s3 = await putContractDocument(storageKey, buf, a.contentType || "application/octet-stream");
    stored.push({
      filename: fname,
      contentType: a.contentType || "application/octet-stream",
      size: buf.length,
      s3Key: s3.storageKey,
      contentId: a.contentId ? String(a.contentId).replace(/[<>]/g, "") : null,
    });
  }

  const inboxFolderId = await getSystemFolderId(target.mailboxId, "inbox");
  await withDbWrite(async (wdb) => {
    for (const s of stored) {
      await wdb.run(
        `INSERT INTO mail_attachments (attachment_id, message_id, filename, content_type, size_bytes, s3_key, content_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [newId("matt"), msgId, s.filename, s.contentType, s.size, s.s3Key, s.contentId, now]
      );
    }
    await wdb.run(
      `INSERT INTO mail_message_state (message_id, folder_id, mailbox_id, is_read, created_at)
       VALUES ($1,$2,$3,0,$4) ON CONFLICT (message_id, folder_id) DO NOTHING`,
      [msgId, inboxFolderId, target.mailboxId, now]
    );
  });
  return true;
}

export interface InboundTickResult {
  polled: number;
  stored: number;
  skipped?: string;
}

/**
 * 수신 큐를 1배치 폴링해 처리한다. next instrumentation 타이머가 주기 호출.
 * 성공/영구실패(수신자 없음) 메시지는 삭제, 일시 오류는 남겨(가시성 타임아웃 후 재시도, 5회 후 DLQ).
 */
export async function processInboundBatch(): Promise<InboundTickResult> {
  const queueUrl = await resolveQueueUrl();
  if (!queueUrl) return { polled: 0, stored: 0, skipped: "queue-unavailable" };

  const recv = await getSqs().send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 2,
      VisibilityTimeout: 300,
    })
  );
  const messages = recv.Messages ?? [];
  if (!messages.length) return { polled: 0, stored: 0 };

  let stored = 0;
  for (const m of messages) {
    try {
      const notif = parseNotification(m.Body ?? "");
      if (!notif) {
        // 파싱 불가 통지 → 영구 실패로 보고 삭제(재시도 무의미).
        await deleteMsg(queueUrl, m.ReceiptHandle);
        continue;
      }
      const targets = await resolveRecipients(notif.destination);
      if (!targets.length) {
        // 우리 메일함에 해당 수신자 없음 → 영구, 삭제.
        console.warn("[mail-inbound] 수신자 mailbox 없음", notif.destination);
        await deleteMsg(queueUrl, m.ReceiptHandle);
        continue;
      }
      const raw = await fetchRawMime(notif.bucketName, notif.objectKey);
      const parsed = await simpleParser(raw);
      for (const t of targets) {
        if (await storeForMailbox(t, parsed, notif)) stored++;
      }
      await deleteMsg(queueUrl, m.ReceiptHandle);
    } catch (err) {
      // 일시 오류(S3/DB) — 메시지를 남겨 재시도(가시성 타임아웃 후). 로그만.
      console.error("[mail-inbound] 메시지 처리 실패(재시도 예정)", err);
    }
  }
  return { polled: messages.length, stored };
}

async function deleteMsg(queueUrl: string, receiptHandle: string | undefined): Promise<void> {
  if (!receiptHandle) return;
  await getSqs().send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
}
