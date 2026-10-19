/*
 * 할 일 인앱 알림함(277 todo_notifications, docs/todo-kanban-blueprint.md §9 2차).
 *   notify.ts 의 푸시 헬퍼가 sendPush 와 나란히 record 를 호출한다 — 푸시는 수신 설정·방해금지로 걸러지지만
 *   인앱 행은 항상 남는다(놓친 알림의 보관함). 웹 탑바 알림함(TodoNotifyBell)·모바일 /todo/inbox 가 읽는다.
 * ★ record 는 fire-and-forget — 실패가 본 업무를 막지 않도록 전부 try/catch.
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export type TodoNotifyEvent = "todo.assigned" | "todo.comment" | "todo.status" | "todo.remind" | "todo.digest" | "todo.weekly";

export interface TodoNotification {
  notifId: string;
  event: TodoNotifyEvent | string;
  title: string;
  body: string | null;
  link: string | null;
  itemId: string | null;
  actorUserId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface TodoNotificationPage {
  items: TodoNotification[];
  unread: number;
}

const newId = () => "tn" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

/** 277 미적용(표 없음, 42P01)이면 알림함은 "비어 있음"으로 동작한다 — 탑바·모바일이 500 으로 붉어지지 않게. */
const isMissingTable = (e: unknown): boolean => (e as { code?: string } | null)?.code === "42P01";

function mapRow(r: Record<string, unknown>): TodoNotification {
  return {
    notifId: String(r.notif_id),
    event: String(r.event),
    title: String(r.title),
    body: r.body != null ? String(r.body) : null,
    link: r.link != null ? String(r.link) : null,
    itemId: r.item_id != null ? String(r.item_id) : null,
    actorUserId: r.actor_user_id != null ? String(r.actor_user_id) : null,
    readAt: r.read_at != null ? String(r.read_at) : null,
    createdAt: String(r.created_at),
  };
}

/** 수신자별 행을 남긴다(한 트랜잭션). 수신자 0명이면 아무 것도 안 한다. 실패는 로그만. */
export async function recordTodoNotifications(
  userIds: string[],
  n: { event: TodoNotifyEvent; title: string; body?: string | null; link?: string | null; itemId?: string | null; actorUserId?: string | null }
): Promise<void> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const now = new Date().toISOString();
  try {
    await withDbWrite(async (db) => {
      for (const userId of ids) {
        await db.run(
          `INSERT INTO todo_notifications (notif_id, user_id, event, title, body, link, item_id, actor_user_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [newId(), userId, n.event, n.title.slice(0, 200), n.body?.slice(0, 500) ?? null, n.link ?? null, n.itemId ?? null, n.actorUserId ?? null, now]
        );
      }
    });
  } catch (e) {
    console.error("[todo-inbox] 알림 기록 실패", n.event, e);
  }
}

export async function countUnreadTodoNotifications(userId: string): Promise<number> {
  const db = await getDb();
  try {
    const rows = rowsToObjects(
      await db.exec(`SELECT COUNT(*)::int AS n FROM todo_notifications WHERE user_id = $1 AND read_at IS NULL`, [userId])
    );
    return Number(rows[0]?.n ?? 0);
  } catch (e) {
    if (isMissingTable(e)) return 0;
    throw e;
  }
}

/** 최근 알림(읽음 포함, 최신순) + 미읽음 수. */
export async function listTodoNotifications(userId: string, limit = 30): Promise<TodoNotificationPage> {
  const db = await getDb();
  const lim = Math.min(100, Math.max(1, Math.trunc(limit) || 30));
  let rows: Record<string, unknown>[];
  try {
    rows = rowsToObjects(
      await db.exec(
        `SELECT notif_id, event, title, body, link, item_id, actor_user_id, read_at, created_at
           FROM todo_notifications
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [userId, lim]
      )
    );
  } catch (e) {
    if (isMissingTable(e)) return { items: [], unread: 0 };
    throw e;
  }
  return { items: rows.map(mapRow), unread: await countUnreadTodoNotifications(userId) };
}

/** 읽음 처리 — ids 또는 전체. 본인 행만. 반환: 갱신 행 수. */
export async function markTodoNotificationsRead(userId: string, ids: string[] | "all"): Promise<number> {
  const now = new Date().toISOString();
  let updated = 0;
  await withDbWrite(async (db) => {
    if (ids === "all") {
      const rows = rowsToObjects(
        await db.exec(`UPDATE todo_notifications SET read_at = $2 WHERE user_id = $1 AND read_at IS NULL RETURNING notif_id`, [userId, now])
      );
      updated = rows.length;
      return;
    }
    const list = [...new Set(ids.filter((v) => typeof v === "string" && v))];
    if (!list.length) return;
    const rows = rowsToObjects(
      await db.exec(
        `UPDATE todo_notifications SET read_at = $2
          WHERE user_id = $1 AND read_at IS NULL AND notif_id = ANY($3::text[])
          RETURNING notif_id`,
        [userId, now, list]
      )
    );
    updated = rows.length;
  });
  return updated;
}
