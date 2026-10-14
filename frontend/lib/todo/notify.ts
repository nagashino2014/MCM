/*
 * To-do 알림 — 예정/마감 리마인드·아침 요약 디스패처(tick) + 배정·댓글·상태 변경 푸시 헬퍼.
 * 설계: docs/todo-kanban-blueprint.md §9. 채널은 모바일 푸시(sendPush) + 인앱 알림함(277, inbox.ts record) — 메일은 2차.
 * ★ 헬퍼는 트랜잭션 **커밋 이후** fire-and-forget 으로 호출한다(발송 실패가 본 업무를 막지 않게 전부 try/catch).
 * 멱등: dedupKey 로 mobile_push_log 가 사람당 1회 선점 — todo-remind:<item>:<remind_at> / todo-digest:<user>:<date>.
 * 날짜 판정은 전부 KST(서버 UTC + 9h).
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { sendPush } from "@/lib/notify/push-expo";
import { recordTodoNotifications } from "./inbox";
import { TODO_DEFAULT_DIGEST_TIME, TODO_STATUS_LABELS, todoItemLink, type TodoStatus } from "./types";

const nowIso = () => new Date().toISOString();
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
const kstToday = () => kstNow().toISOString().slice(0, 10);
const kstHhmm = () => {
  const d = kstNow();
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const uniq = (ids: Array<string | null | undefined>): string[] => [...new Set(ids.filter((v): v is string => !!v))];

/** "10/30" 식 짧은 날짜. */
const shortDate = (ymd: string | null): string | null => (ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : null);

// ── 예정/마감 리마인드(5분 tick) ──
export async function dispatchTodoReminders(): Promise<{ remindersSent: number; candidates: number }> {
  const now = nowIso();
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT i.item_id, i.title, i.do_date, i.do_time, i.due_date, i.remind_at, i.owner_user_id, i.assignee_user_id
         FROM todo_items i
        WHERE i.remind_at IS NOT NULL
          AND i.remind_at <= $1
          AND i.remind_sent_at IS NULL
          AND i.status <> 'done'
          AND i.archived_at IS NULL
          AND (i.snoozed_until IS NULL OR i.snoozed_until <= $1)
        ORDER BY i.remind_at
        LIMIT 200`,
      [now]
    )
  );
  let sent = 0;
  for (const r of rows) {
    const itemId = String(r.item_id);
    const remindAt = String(r.remind_at);
    // 발송 기록을 먼저 선점(같은 tick 이 겹쳐도 1회) — 선점 실패면 다른 프로세스가 처리 중.
    let claimed = false;
    try {
      await withDbWrite(async (tx) => {
        const upd = rowsToObjects(
          await tx.exec(
            `UPDATE todo_items SET remind_sent_at = $2
              WHERE item_id = $1 AND remind_sent_at IS NULL AND remind_at = $3
              RETURNING item_id`,
            [itemId, now, remindAt]
          )
        );
        claimed = upd.length > 0;
      });
    } catch (e) {
      console.error("[todo-remind] claim 실패", itemId, e);
      continue;
    }
    if (!claimed) continue;
    const recipients = uniq([r.assignee_user_id ? String(r.assignee_user_id) : String(r.owner_user_id)]);
    const doDate = r.do_date != null ? String(r.do_date) : null;
    const doTime = r.do_time != null ? String(r.do_time) : null;
    const dueDate = r.due_date != null ? String(r.due_date) : null;
    const when = doDate ? `${shortDate(doDate)}${doTime ? " " + doTime : ""}` : dueDate ? `마감 ${shortDate(dueDate)}` : "";
    try {
      const title = doTime ? "곧 시작하는 일정" : "오늘 할 일";
      const body = `${String(r.title)}${when ? ` · ${when}` : ""}`;
      await recordTodoNotifications(recipients, { event: "todo.remind", title, body, link: todoItemLink(itemId), itemId });
      const res = await sendPush(recipients, {
        event: "todo.remind",
        title,
        body,
        link: todoItemLink(itemId),
        targetRef: itemId,
        dedupKey: `todo-remind:${itemId}:${remindAt}`,
      });
      if (res.ok) sent += 1;
    } catch (e) {
      console.error("[todo-remind] 발송 실패", itemId, e);
    }
  }
  return { remindersSent: sent, candidates: rows.length };
}

// ── 아침 요약(KST 일 1회, 0건이면 미발송) ──
export async function dispatchTodoDigest(): Promise<{ digestsSent: number; evaluated: number }> {
  const today = kstToday();
  const hhmm = kstHhmm();
  const db = await getDb();
  // prefs 행이 없으면 기본 08:30 켜짐(§13-8). 행이 있고 digest_time NULL 이면 끔.
  const users = rowsToObjects(
    await db.exec(
      `SELECT u.user_id,
              CASE WHEN p.user_id IS NULL THEN $2 ELSE p.digest_time END AS digest_time,
              p.digest_sent_on
         FROM users u
         LEFT JOIN todo_user_prefs p ON p.user_id = u.user_id
        WHERE u.status = 'active'
          AND (CASE WHEN p.user_id IS NULL THEN $2 ELSE p.digest_time END) IS NOT NULL
          AND (CASE WHEN p.user_id IS NULL THEN $2 ELSE p.digest_time END) <= $3
          AND (p.digest_sent_on IS NULL OR p.digest_sent_on <> $1)
          AND EXISTS (SELECT 1 FROM todo_items i
                       WHERE (i.assignee_user_id = u.user_id OR (i.assignee_user_id IS NULL AND i.owner_user_id = u.user_id))
                         AND i.status <> 'done' AND i.archived_at IS NULL)`,
      [today, TODO_DEFAULT_DIGEST_TIME, hhmm]
    )
  );
  let sent = 0;
  for (const u of users) {
    const userId = String(u.user_id);
    try {
      const cnt = rowsToObjects(
        await db.exec(
          `SELECT
             COUNT(*) FILTER (WHERE i.do_date = $2 OR (i.do_date IS NULL AND i.due_date = $2))::int AS today_n,
             COUNT(*) FILTER (WHERE (i.do_date IS NOT NULL AND i.do_date < $2) OR (i.due_date IS NOT NULL AND i.due_date < $2))::int AS overdue_n
           FROM todo_items i
          WHERE (i.assignee_user_id = $1 OR (i.assignee_user_id IS NULL AND i.owner_user_id = $1))
            AND i.status <> 'done' AND i.archived_at IS NULL AND i.parent_item_id IS NULL`,
          [userId, today]
        )
      )[0];
      const todayN = Number(cnt?.today_n ?? 0);
      const overdueN = Number(cnt?.overdue_n ?? 0);
      // 발송 여부와 무관하게 오늘 평가했음을 기록(5분마다 재집계 방지).
      await withDbWrite(async (tx) => {
        await tx.run(
          `INSERT INTO todo_user_prefs (user_id, digest_sent_on, updated_at) VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET digest_sent_on = EXCLUDED.digest_sent_on, updated_at = EXCLUDED.updated_at`,
          [userId, today, nowIso()]
        );
      });
      if (todayN + overdueN === 0) continue;
      const parts = [`오늘 할 일 ${todayN}건`];
      if (overdueN > 0) parts.push(`지연 ${overdueN}건`);
      await recordTodoNotifications([userId], { event: "todo.digest", title: "오늘의 할 일", body: parts.join(" · "), link: "/todo" });
      const res = await sendPush([userId], {
        event: "todo.digest",
        title: "오늘의 할 일",
        body: parts.join(" · "),
        link: "/todo",
        targetRef: `digest:${today}`,
        dedupKey: `todo-digest:${userId}:${today}`,
      });
      if (res.ok) sent += 1;
    } catch (e) {
      console.error("[todo-digest] 발송 실패", userId, e);
    }
  }
  return { digestsSent: sent, evaluated: users.length };
}

// ── 이벤트 푸시 헬퍼(커밋 후 fire-and-forget) ──
export function notifyTodoAssigned(params: { itemId: string; title: string; assigneeUserId: string; byUserId: string; byName?: string | null }): void {
  if (!params.assigneeUserId || params.assigneeUserId === params.byUserId) return;
  const body = `${params.byName ? params.byName + " · " : ""}${params.title}`;
  void recordTodoNotifications([params.assigneeUserId], {
    event: "todo.assigned",
    title: "할 일이 배정됐습니다",
    body,
    link: todoItemLink(params.itemId),
    itemId: params.itemId,
    actorUserId: params.byUserId,
  });
  void sendPush([params.assigneeUserId], {
    event: "todo.assigned",
    title: "할 일이 배정됐습니다",
    body,
    link: todoItemLink(params.itemId),
    targetRef: params.itemId,
    dedupKey: `todo-assign:${params.itemId}:${params.assigneeUserId}:${Date.now()}`,
  }).catch((e) => console.error("[todo] 배정 푸시 실패", e));
}

export function notifyTodoComment(params: {
  itemId: string;
  title: string;
  commentId: string;
  byUserId: string;
  byName?: string | null;
  body: string;
  /** 멘션된 사람(항상 발송) */
  mentioned: string[];
  /** 구독자(owner·담당·공유) */
  subscribers: string[];
}): void {
  const recipients = uniq([...params.mentioned, ...params.subscribers]).filter((id) => id !== params.byUserId);
  if (!recipients.length) return;
  const preview = params.body.replace(/\s+/g, " ").slice(0, 80);
  const title = `${params.byName ?? "동료"}님의 댓글 · ${params.title}`.slice(0, 80);
  void recordTodoNotifications(recipients, {
    event: "todo.comment",
    title,
    body: preview,
    link: todoItemLink(params.itemId),
    itemId: params.itemId,
    actorUserId: params.byUserId,
  });
  void sendPush(recipients, {
    event: "todo.comment",
    title,
    body: preview,
    link: todoItemLink(params.itemId),
    targetRef: params.itemId,
    dedupKey: `todo-comment:${params.commentId}`,
  }).catch((e) => console.error("[todo] 댓글 푸시 실패", e));
}

export function notifyTodoStatus(params: {
  itemId: string;
  title: string;
  status: TodoStatus;
  byUserId: string;
  byName?: string | null;
  recipients: string[];
}): void {
  // §9: 완료·검토 요청만 기본 발송.
  if (params.status !== "done" && params.status !== "review") return;
  const recipients = uniq(params.recipients).filter((id) => id !== params.byUserId);
  if (!recipients.length) return;
  const title = params.status === "done" ? "할 일이 완료됐습니다" : "검토 요청";
  const body = `${params.byName ? params.byName + " · " : ""}${params.title} → ${TODO_STATUS_LABELS[params.status]}`;
  void recordTodoNotifications(recipients, {
    event: "todo.status",
    title,
    body,
    link: todoItemLink(params.itemId),
    itemId: params.itemId,
    actorUserId: params.byUserId,
  });
  void sendPush(recipients, {
    event: "todo.status",
    title,
    body,
    link: todoItemLink(params.itemId),
    targetRef: params.itemId,
    dedupKey: `todo-status:${params.itemId}:${params.status}:${Date.now()}`,
  }).catch((e) => console.error("[todo] 상태 푸시 실패", e));
}
