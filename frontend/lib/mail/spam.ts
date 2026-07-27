/**
 * 코넨사인 메일 — 스팸 처리(G2-12).
 * 발신자 차단 목록(mail_spam_senders) + 메일함 설정(mailboxes.settings jsonb)의 키워드 필터.
 * 수신 파이프라인(inbound.ts)이 isSpamFor 로 판정해 스팸함으로 분류한다.
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getMailboxByUser } from "@/lib/mail/mailbox";

export interface MailboxSettings {
  spamKeywords?: string[]; // 제목/발신자에 포함 시 스팸
  spamRetentionDays?: number; // 스팸함 보관기간(기본 30)
  spamAfterRetention?: "delete" | "keep"; // 기간 경과 처리(기본 delete)
  spamAutoDelete?: boolean; // 스팸 분류 즉시 삭제(스팸함 미보관, 기본 false)
  spamHideRemote?: boolean; // 스팸 메일 본문 이미지/링크 숨김(기본 true)
  quotaSplit?: { inbox: number; sent: number; archive: number }; // 총용량 배분 %(기본 50/25/25)
}

export const DEFAULT_SETTINGS: Required<MailboxSettings> = {
  spamKeywords: [],
  spamRetentionDays: 30,
  spamAfterRetention: "delete",
  spamAutoDelete: false,
  spamHideRemote: true,
  quotaSplit: { inbox: 50, sent: 25, archive: 25 },
};

function parseSettings(v: unknown): MailboxSettings {
  if (v && typeof v === "object") return v as MailboxSettings;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return {};
}

export async function getMailboxSettings(userId: string): Promise<{ settings: Required<MailboxSettings>; quotaBytes: number | null; address: string }> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) throw new Error("메일함이 없습니다.");
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT settings, quota_bytes FROM mailboxes WHERE mailbox_id = $1`, [mailbox.mailboxId]));
  const raw = rows.length ? parseSettings(rows[0].settings) : {};
  return {
    settings: { ...DEFAULT_SETTINGS, ...raw, quotaSplit: { ...DEFAULT_SETTINGS.quotaSplit, ...(raw.quotaSplit ?? {}) } },
    quotaBytes: rows.length && rows[0].quota_bytes != null ? Number(rows[0].quota_bytes) : null,
    address: mailbox.address,
  };
}

export async function saveMailboxSettings(userId: string, patch: MailboxSettings): Promise<void> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) throw new Error("메일함이 없습니다.");
  const { settings } = await getMailboxSettings(userId);
  const next = { ...settings, ...patch, quotaSplit: { ...settings.quotaSplit, ...(patch.quotaSplit ?? {}) } };
  await withDbWrite(async (db) => {
    await db.run(`UPDATE mailboxes SET settings = $2::jsonb, updated_at = $3 WHERE mailbox_id = $1`, [
      mailbox.mailboxId,
      JSON.stringify(next),
      new Date().toISOString(),
    ]);
  });
}

/** 발신자 차단(스팸 분류) — retroactive=true 면 받은편지함의 해당 발신자 메일을 소급해 스팸함으로 이동. */
export async function blockSender(userId: string, sender: string, retroactive: boolean): Promise<{ moved: number }> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return { moved: 0 };
  const addr = sender.trim().toLowerCase();
  if (!/.+@.+\..+/.test(addr)) return { moved: 0 };
  let moved = 0;
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO mail_spam_senders (mailbox_id, sender, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [mailbox.mailboxId, addr, new Date().toISOString()]
    );
    if (retroactive) {
      const spam = rowsToObjects(
        await db.exec(`SELECT folder_id FROM mail_folders WHERE mailbox_id = $1 AND system_kind = 'spam'`, [mailbox.mailboxId])
      );
      if (spam.length) {
        const spamId = String(spam[0].folder_id);
        const res = rowsToObjects(
          await db.exec(
            `UPDATE mail_message_state s SET folder_id = $3
              FROM mail_messages m
             WHERE m.message_id = s.message_id AND s.mailbox_id = $1 AND lower(COALESCE(m.from_addr,'')) = $2
               AND s.folder_id <> $3
               AND NOT EXISTS (SELECT 1 FROM mail_message_state x WHERE x.message_id = s.message_id AND x.folder_id = $3)
             RETURNING s.message_id`,
            [mailbox.mailboxId, addr, spamId]
          )
        );
        moved = res.length;
      }
    }
  });
  return { moved };
}

/** 수신 파이프라인용 스팸 판정 — 차단 발신자 or 키워드(제목/발신) 매칭. */
export async function isSpamFor(mailboxId: string, fromAddr: string | null, subject: string): Promise<boolean> {
  const db = await getDb();
  const from = (fromAddr ?? "").toLowerCase();
  if (from) {
    const blocked = rowsToObjects(
      await db.exec(`SELECT 1 FROM mail_spam_senders WHERE mailbox_id = $1 AND sender = $2`, [mailboxId, from])
    );
    if (blocked.length) return true;
  }
  const rows = rowsToObjects(await db.exec(`SELECT settings FROM mailboxes WHERE mailbox_id = $1`, [mailboxId]));
  const settings = rows.length ? parseSettings(rows[0].settings) : {};
  const keywords = Array.isArray(settings.spamKeywords) ? settings.spamKeywords : [];
  const hay = `${subject} ${from}`.toLowerCase();
  return keywords.some((k) => k && hay.includes(String(k).toLowerCase()));
}
