/**
 * 코넨사인 메일 — 보낸 사람 팝업 메뉴(10-21): 발신자별 자동 분류 규칙 + 개인 메일 주소록(마이그 305).
 * 분류 = 받은편지함 라벨(mail_message_state.category_id, 사용자 폴더 참조). 규칙 지정 시 기존 받은편지함 메일에 소급하고,
 * 새 메일은 수신 파이프라인(inbound.ts)과 내부 배달(브리핑·주간 요약)이 applySenderRuleToNewMail 로 라벨을 붙인다.
 * 규칙이 바꾼 메일은 mail_sender_rule_marks(마이그 337)에 이전 라벨과 함께 기록해 [자동 분류 해제] 때 되돌린다.
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { MAIL_DOMAIN, getMailboxByUser, getSystemFolderId } from "@/lib/mail/mailbox";

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

/** SQL 쪽 같은 정규화 — 표시 이름·대소문자·앞뒤 공백 차이를 무시한다(별칭 m = mail_messages). */
const FROM_KEY_SQL = `lower(btrim(coalesce(substring(m.from_addr from '<([^>]+)>'), m.from_addr, '')))`;

/**
 * MCM 시스템 발신 주소 묶음 — 알림·브리핑(BID_NOTIFY_EMAIL_FROM = no-reply@)과 주간 할 일 요약(noreply@)의 주소가 달라
 * 사용자가 한 발신자로 보는 메일이 나뉘었다(11-03 보고). 묶음 안 주소는 첫 주소 하나의 규칙으로 함께 분류한다.
 */
function systemSenders(): string[] {
  const list = [normalizeSender(process.env.BID_NOTIFY_EMAIL_FROM), `no-reply@${MAIL_DOMAIN}`, `noreply@${MAIL_DOMAIN}`];
  return [...new Set(list.filter((x): x is string => !!x))];
}

/** 규칙 키와 그 키가 묶는 주소들. */
export function senderGroup(sender: string): { key: string; addrs: string[] } {
  const sys = systemSenders();
  return sys.includes(sender) ? { key: sys[0], addrs: sys } : { key: sender, addrs: [sender] };
}

export async function listSenderRules(userId: string): Promise<MailSenderRule[]> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT sender, category_id FROM mail_sender_rules WHERE mailbox_id = $1 ORDER BY sender`, [mailbox.mailboxId])
  );
  // 시스템 발신 묶음은 묶인 주소 모두에 같은 분류를 보여 준다(팝업 체크 표시).
  const out: MailSenderRule[] = [];
  for (const r of rows) {
    const categoryId = String(r.category_id);
    for (const sender of senderGroup(String(r.sender)).addrs) out.push({ sender, categoryId });
  }
  return out;
}

/** 이 메일함에서 발신자에 지정된 규칙(묶음 키 우선). */
async function findRule(mailboxId: string, sender: string): Promise<{ key: string; categoryId: string } | null> {
  const { key, addrs } = senderGroup(sender);
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT category_id FROM mail_sender_rules WHERE mailbox_id = $1 AND sender = ANY($2::text[])
        ORDER BY (sender = $3) DESC LIMIT 1`,
      [mailboxId, addrs, key]
    )
  );
  return rows.length ? { key, categoryId: String(rows[0].category_id) } : null;
}

/**
 * 발신자 규칙 지정/해제 — 해당 사용자 메일함 안에서만 동작한다.
 * 지정: 받은편지함에 있는 그 발신자 메일 전부(다른 분류에 있던 메일 포함)를 그 분류로 옮기고, 처음 옮기는 메일은 이전 라벨을 기록한다.
 * 해제(categoryId=null): 규칙이 옮긴 받은편지함 메일 중 아직 그 분류에 있는 메일을 이전 라벨(없으면 미분류)로 되돌리고 규칙을 지운다.
 *   그 사이 사용자가 직접 다른 분류로 바꾸거나 보관·이동한 메일은 그대로 둔다.
 */
export async function setSenderRule(
  userId: string,
  rawSender: string,
  categoryId: string | null
): Promise<{ applied: number; reverted: number }> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) throw new Error("메일함이 없습니다.");
  const sender = normalizeSender(rawSender);
  if (!sender) throw new Error("메일 주소 형식이 아닙니다.");
  const mbId = mailbox.mailboxId;
  const { key, addrs } = senderGroup(sender);
  const db = await getDb();
  if (categoryId == null) {
    let reverted = 0;
    await withDbWrite(async (wdb) => {
      const rows = rowsToObjects(
        await wdb.exec(
          `UPDATE mail_message_state s SET category_id = k.prev_category_id
             FROM mail_sender_rule_marks k, mail_folders f
            WHERE k.mailbox_id = $1 AND k.sender = $2 AND s.mailbox_id = $1 AND s.message_id = k.message_id
              AND f.folder_id = s.folder_id AND f.system_kind = 'inbox'
              AND s.category_id IN (SELECT category_id FROM mail_sender_rules WHERE mailbox_id = $1 AND sender = ANY($3::text[]))
            RETURNING s.message_id`,
          [mbId, key, addrs]
        )
      );
      reverted = new Set(rows.map((r) => String(r.message_id))).size;
      await wdb.run(`DELETE FROM mail_sender_rule_marks WHERE mailbox_id = $1 AND sender = $2`, [mbId, key]);
      await wdb.run(`DELETE FROM mail_sender_rules WHERE mailbox_id = $1 AND sender = ANY($2::text[])`, [mbId, addrs]);
    });
    return { applied: 0, reverted };
  }
  const own = rowsToObjects(
    await db.exec(`SELECT 1 FROM mail_folders WHERE folder_id = $1 AND mailbox_id = $2 AND system_kind IS NULL`, [categoryId, mbId])
  );
  if (!own.length) throw new Error("메일 분류를 찾을 수 없습니다.");
  const inboxId = await getSystemFolderId(mbId, "inbox");
  const now = new Date().toISOString();
  let applied = 0;
  await withDbWrite(async (wdb) => {
    await wdb.run(`DELETE FROM mail_sender_rules WHERE mailbox_id = $1 AND sender = ANY($2::text[]) AND sender <> $3`, [mbId, addrs, key]);
    await wdb.run(
      `INSERT INTO mail_sender_rules (mailbox_id, sender, category_id, created_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (mailbox_id, sender) DO UPDATE SET category_id = EXCLUDED.category_id`,
      [mbId, key, categoryId, now]
    );
    // 이전 라벨 기록 — 이미 기록된 메일(분류만 바꾸는 재지정)은 처음 라벨을 유지한다.
    await wdb.run(
      `INSERT INTO mail_sender_rule_marks (mailbox_id, message_id, sender, prev_category_id, created_at)
       SELECT $1, s.message_id, $3, s.category_id, $5
         FROM mail_message_state s JOIN mail_messages m ON m.message_id = s.message_id
        WHERE s.mailbox_id = $1 AND m.mailbox_id = $1 AND s.folder_id = $2 AND s.is_deleted = 0
          AND ${FROM_KEY_SQL} = ANY($4::text[])
       ON CONFLICT (mailbox_id, message_id) DO NOTHING`,
      [mbId, inboxId, key, addrs, now]
    );
    const rows = rowsToObjects(
      await wdb.exec(
        `UPDATE mail_message_state s SET category_id = $3
           FROM mail_messages m
          WHERE m.message_id = s.message_id AND s.mailbox_id = $1 AND m.mailbox_id = $1 AND s.folder_id = $2 AND s.is_deleted = 0
            AND ${FROM_KEY_SQL} = ANY($4::text[])
          RETURNING s.message_id`,
        [mbId, inboxId, categoryId, addrs]
      )
    );
    applied = rows.length;
  });
  return { applied, reverted: 0 };
}

/** 수신 파이프라인용 — 이 발신자에 지정된 분류(사용자 폴더 id). 없으면 null. */
export async function senderCategoryFor(mailboxId: string, fromAddr: string | null): Promise<string | null> {
  const sender = normalizeSender(fromAddr);
  if (!sender) return null;
  // 규칙 조회가 실패해도(305 미적용 등) 수신 자체는 막지 않는다 — 분류 없이 받는다.
  try {
    return (await findRule(mailboxId, sender))?.categoryId ?? null;
  } catch {
    return null;
  }
}

/**
 * 받은편지함에 새로 들어온 메일에 발신자 규칙 라벨을 붙이고 기록한다(수신·내부 배달 공용, 적재가 끝난 뒤 호출).
 * 이미 다른 분류가 붙은 메일은 건드리지 않는다. 실패해도(337 미적용 등) 메일은 그대로 둔다.
 */
export async function applySenderRuleToNewMail(mailboxId: string, messageId: string, fromAddr: string | null): Promise<void> {
  const sender = normalizeSender(fromAddr);
  if (!sender) return;
  try {
    const rule = await findRule(mailboxId, sender);
    if (!rule) return;
    await withDbWrite(async (wdb) => {
      await wdb.run(
        `INSERT INTO mail_sender_rule_marks (mailbox_id, message_id, sender, prev_category_id, created_at)
         SELECT $1, s.message_id, $3, NULL, $5
           FROM mail_message_state s JOIN mail_folders f ON f.folder_id = s.folder_id AND f.system_kind = 'inbox'
          WHERE s.mailbox_id = $1 AND s.message_id = $2 AND (s.category_id IS NULL OR s.category_id = $4)
          LIMIT 1
         ON CONFLICT (mailbox_id, message_id) DO NOTHING`,
        [mailboxId, messageId, rule.key, rule.categoryId, new Date().toISOString()]
      );
      await wdb.run(
        `UPDATE mail_message_state s SET category_id = $3
           FROM mail_folders f
          WHERE f.folder_id = s.folder_id AND f.system_kind = 'inbox' AND s.mailbox_id = $1 AND s.message_id = $2 AND s.category_id IS NULL`,
        [mailboxId, messageId, rule.categoryId]
      );
    });
  } catch {
    // 분류 없이 둔다.
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
