/**
 * 코넨사인 메일 — 보낸 사람 팝업 메뉴(10-21): 발신자별 자동 분류 규칙 + 개인 메일 주소록(마이그 305).
 * 분류 = 받은편지함 라벨(mail_message_state.category_id, 사용자 폴더 참조). 규칙 지정 시 기존 받은편지함 메일에 소급하고,
 * 수신 파이프라인(inbound.ts)이 senderCategoryFor 로 조회해 새 메일에 라벨을 붙인다.
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getMailboxByUser, getSystemFolderId } from "@/lib/mail/mailbox";

export interface MailSenderRule {
  sender: string;
  categoryId: string;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** "이름 <a@b.c>" 도 받아 소문자 주소만 남긴다. 형식이 아니면 null. */
export function normalizeSender(raw: string | null | undefined): string | null {
  const m = String(raw ?? "").match(/<([^>]+)>/);
  const addr = (m ? m[1] : String(raw ?? "")).trim().toLowerCase();
  return EMAIL_RE.test(addr) ? addr : null;
}

export async function listSenderRules(userId: string): Promise<MailSenderRule[]> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT sender, category_id FROM mail_sender_rules WHERE mailbox_id = $1 ORDER BY sender`, [mailbox.mailboxId])
  );
  return rows.map((r) => ({ sender: String(r.sender), categoryId: String(r.category_id) }));
}

/**
 * 발신자 규칙 지정/해제 — categoryId=null 이면 규칙만 지운다(이미 붙은 라벨은 그대로, 메일별 [분류 해제]로 정리).
 * 지정하면 받은편지함에 있는 그 발신자 메일 전체를 같은 분류로 라벨링하고 건수를 돌려준다.
 */
export async function setSenderRule(userId: string, rawSender: string, categoryId: string | null): Promise<{ applied: number }> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) throw new Error("메일함이 없습니다.");
  const sender = normalizeSender(rawSender);
  if (!sender) throw new Error("메일 주소 형식이 아닙니다.");
  const db = await getDb();
  if (categoryId == null) {
    await withDbWrite(async (wdb) => {
      await wdb.run(`DELETE FROM mail_sender_rules WHERE mailbox_id = $1 AND sender = $2`, [mailbox.mailboxId, sender]);
    });
    return { applied: 0 };
  }
  const own = rowsToObjects(
    await db.exec(`SELECT 1 FROM mail_folders WHERE folder_id = $1 AND mailbox_id = $2 AND system_kind IS NULL`, [
      categoryId,
      mailbox.mailboxId,
    ])
  );
  if (!own.length) throw new Error("메일 분류를 찾을 수 없습니다.");
  const inboxId = await getSystemFolderId(mailbox.mailboxId, "inbox");
  let applied = 0;
  await withDbWrite(async (wdb) => {
    await wdb.run(
      `INSERT INTO mail_sender_rules (mailbox_id, sender, category_id, created_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (mailbox_id, sender) DO UPDATE SET category_id = EXCLUDED.category_id`,
      [mailbox.mailboxId, sender, categoryId, new Date().toISOString()]
    );
    const rows = rowsToObjects(
      await wdb.exec(
        `UPDATE mail_message_state s SET category_id = $3
           FROM mail_messages m
          WHERE m.message_id = s.message_id AND s.mailbox_id = $1 AND s.folder_id = $2 AND s.is_deleted = 0
            AND LOWER(m.from_addr) = $4
          RETURNING s.message_id`,
        [mailbox.mailboxId, inboxId, categoryId, sender]
      )
    );
    applied = rows.length;
  });
  return { applied };
}

/** 수신 파이프라인용 — 이 발신자에 지정된 분류(사용자 폴더 id). 없으면 null. */
export async function senderCategoryFor(mailboxId: string, fromAddr: string | null): Promise<string | null> {
  const sender = normalizeSender(fromAddr);
  if (!sender) return null;
  // 규칙 조회가 실패해도(305 미적용 등) 수신 자체는 막지 않는다 — 분류 없이 받는다.
  try {
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(`SELECT category_id FROM mail_sender_rules WHERE mailbox_id = $1 AND sender = $2 LIMIT 1`, [mailboxId, sender])
    );
    return rows.length ? String(rows[0].category_id) : null;
  } catch {
    return null;
  }
}

/** 개인 메일 주소록에 추가(같은 주소면 이름만 갱신). */
export async function addMailContact(userId: string, rawAddress: string, displayName: string | null): Promise<void> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) throw new Error("메일함이 없습니다.");
  const address = normalizeSender(rawAddress);
  if (!address) throw new Error("메일 주소 형식이 아닙니다.");
  const name = (displayName ?? "").trim().slice(0, 100) || null;
  await withDbWrite(async (wdb) => {
    await wdb.run(
      `INSERT INTO mail_contacts (mailbox_id, address, display_name, created_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (mailbox_id, address) DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, mail_contacts.display_name)`,
      [mailbox.mailboxId, address, name, new Date().toISOString()]
    );
  });
}

/** 받는 사람 자동완성용 — 내 메일 주소록에서 이름·주소 부분 일치. */
export async function suggestMailContacts(userId: string, q: string, limit: number): Promise<{ address: string; name: string | null }[]> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return [];
  const db = await getDb();
  const like = `%${q.trim().toLowerCase()}%`;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT address, display_name FROM mail_contacts
        WHERE mailbox_id = $1 AND (address LIKE $2 OR LOWER(COALESCE(display_name, '')) LIKE $2)
        ORDER BY display_name NULLS LAST, address LIMIT $3`,
      [mailbox.mailboxId, like, limit]
    )
  );
  return rows.map((r) => ({ address: String(r.address), name: r.display_name != null ? String(r.display_name) : null }));
}
