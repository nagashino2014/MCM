/**
 * 코넨사인 메일 — 수신 확인(읽음 추적, G2-10).
 * 발송 시 수신자별 추적 픽셀(1x1)을 삽입하고, 수신자가 메일을 열면 recordOpen 이 기록한다.
 * listReceipts 는 내 보낸 메일들의 수신자별 열람 여부·시각을 반환(수신 확인 화면).
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getMailboxByUser } from "@/lib/mail/mailbox";

/** 추적 URL 의 수신자 인코딩(base64url). */
export function encodeRecipient(address: string): string {
  return Buffer.from(address.toLowerCase(), "utf8").toString("base64url");
}

export function decodeRecipient(encoded: string): string | null {
  try {
    const s = Buffer.from(encoded, "base64url").toString("utf8");
    return /.+@.+\..+/.test(s) ? s.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** 열람 기록(무인증 픽셀 엔드포인트에서 호출) — 발신 메시지에 한해 upsert. */
export async function recordOpen(messageId: string, recipientEncoded: string): Promise<void> {
  const recipient = decodeRecipient(recipientEncoded);
  if (!recipient) return;
  const db = await getDb();
  // 존재하는 발신 메시지인지 확인(무작위 스캔 방지).
  const rows = rowsToObjects(
    await db.exec(`SELECT 1 FROM mail_messages WHERE message_id = $1 AND direction = 'out'`, [messageId])
  );
  if (!rows.length) return;
  const now = new Date().toISOString();
  await withDbWrite(async (wdb) => {
    await wdb.run(
      `INSERT INTO mail_read_receipts (message_id, recipient, first_opened_at, last_opened_at, open_count)
       VALUES ($1,$2,$3,$3,1)
       ON CONFLICT (message_id, recipient)
       DO UPDATE SET last_opened_at = EXCLUDED.last_opened_at, open_count = mail_read_receipts.open_count + 1`,
      [messageId, recipient, now]
    );
  });
}

export interface ReceiptRecipient {
  address: string;
  kind: "to" | "cc" | "bcc";
  openedAt: string | null; // 최초 열람 시각(null = 미확인)
  openCount: number;
}

export interface ReceiptItem {
  messageId: string;
  subject: string;
  sentAt: string | null;
  createdAt: string;
  recipients: ReceiptRecipient[];
}

function parseAddrs(v: unknown): { address: string }[] {
  if (Array.isArray(v)) return v as { address: string }[];
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

/** 내 보낸 메일들의 수신자별 열람 현황(최신순). */
export async function listReceipts(userId: string, limit = 50): Promise<ReceiptItem[]> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return [];
  const db = await getDb();
  const msgs = rowsToObjects(
    await db.exec(
      `SELECT message_id, subject, sent_at, created_at, to_addrs, cc_addrs, bcc_addrs
         FROM mail_messages WHERE mailbox_id = $1 AND direction = 'out'
        ORDER BY created_at DESC LIMIT $2`,
      [mailbox.mailboxId, Math.min(Math.max(limit, 1), 200)]
    )
  );
  if (!msgs.length) return [];
  const ids = msgs.map((m) => String(m.message_id));
  const receipts = rowsToObjects(
    await db.exec(`SELECT message_id, recipient, first_opened_at, open_count FROM mail_read_receipts WHERE message_id = ANY($1::text[])`, [ids])
  );
  const byMsg = new Map<string, Map<string, { openedAt: string; count: number }>>();
  for (const r of receipts) {
    const mid = String(r.message_id);
    if (!byMsg.has(mid)) byMsg.set(mid, new Map());
    byMsg.get(mid)!.set(String(r.recipient).toLowerCase(), {
      openedAt: String(r.first_opened_at),
      count: Number(r.open_count ?? 1),
    });
  }

  return msgs.map((m) => {
    const mid = String(m.message_id);
    const opens = byMsg.get(mid) ?? new Map<string, { openedAt: string; count: number }>();
    const recipients: ReceiptRecipient[] = [];
    const push = (list: { address: string }[], kind: "to" | "cc" | "bcc") => {
      for (const a of list) {
        if (!a.address) continue;
        const found = opens.get(a.address.toLowerCase());
        recipients.push({ address: a.address, kind, openedAt: found?.openedAt ?? null, openCount: found?.count ?? 0 });
      }
    };
    push(parseAddrs(m.to_addrs), "to");
    push(parseAddrs(m.cc_addrs), "cc");
    push(parseAddrs(m.bcc_addrs), "bcc");
    return {
      messageId: mid,
      subject: m.subject != null ? String(m.subject) : "",
      sentAt: m.sent_at != null ? String(m.sent_at) : null,
      createdAt: String(m.created_at),
      recipients,
    };
  });
}
