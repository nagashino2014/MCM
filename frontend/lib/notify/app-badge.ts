/**
 * 앱 아이콘 배지 숫자(2026-11-12) — 푸시에 실어 보낼 사용자별 합계.
 *
 * 앱 탭 배지와 같은 기준(`/api/nav/badges`)으로 받은편지함 안읽은 메일 + 내 미결재 + 안읽은 대화를 더한다.
 * iOS 는 푸시에 badge 가 없으면 아이콘 숫자를 바꾸지 않으므로, 앱이 꺼져 있을 때도 숫자가 맞으려면
 * 발송 시점의 합계를 실어야 한다(앱이 켜지면 앱이 같은 합계로 다시 맞춘다 — apps/mobile lib/use-nav-badges.ts).
 * 집계 실패는 배지를 비울 뿐 발송을 막지 않는다.
 */
import { getDb, rowsToObjects } from "@/lib/db";

async function countBy(sql: string, ids: string[], into: Map<string, number>): Promise<void> {
  try {
    const db = await getDb();
    for (const r of rowsToObjects(await db.exec(sql, [ids]))) {
      const id = String(r.user_id);
      into.set(id, (into.get(id) ?? 0) + Number(r.n ?? 0));
    }
  } catch {
    /* 표 미존재 등 — 그 항목만 0 */
  }
}

/** user_id → 배지 합계. 조회에 실패한 사용자는 0. */
export async function countAppBadges(userIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(userIds)].filter(Boolean);
  const out = new Map<string, number>(ids.map((id) => [id, 0]));
  if (!ids.length) return out;
  await countBy(
    `SELECT mb.user_id, COUNT(*)::int AS n
       FROM mail_message_state s
       JOIN mail_folders f ON f.folder_id = s.folder_id
       JOIN mailboxes mb ON mb.mailbox_id = s.mailbox_id
      WHERE mb.user_id = ANY($1::text[]) AND f.system_kind = 'inbox' AND s.is_read = 0 AND s.is_deleted = 0
      GROUP BY mb.user_id`,
    ids,
    out
  );
  await countBy(
    `SELECT s.assignee_user_id AS user_id, COUNT(*)::int AS n
       FROM approval_steps s JOIN approval_docs d ON d.doc_id = s.doc_id
      WHERE s.assignee_user_id = ANY($1::text[]) AND s.status = 'pending' AND d.status = 'in_progress'
      GROUP BY s.assignee_user_id`,
    ids,
    out
  );
  await countBy(
    `SELECT m.user_id, COUNT(*)::int AS n
       FROM chat_messages cm
       JOIN chat_room_members m ON m.room_id = cm.room_id
      WHERE m.user_id = ANY($1::text[]) AND m.left_at IS NULL
        AND cm.message_id > m.last_read_message_id
        AND cm.sender_id <> m.user_id AND cm.deleted_at IS NULL
      GROUP BY m.user_id`,
    ids,
    out
  );
  return out;
}
