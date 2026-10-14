/*
 * To-do → 캘린더 이벤트 변환(§13-7). do_date/due_date 가 있는 내 가시 작업을 CalendarEvent 로.
 * /api/calendar 의 `todo` 태그 소스(P1) — tag/kind "todo" 는 lib/calendar/types.ts 에 정식 등록돼 있다.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import type { CalendarEvent } from "@/lib/calendar/types";
import { visibleItemsWhere } from "./visibility";
import { TODO_DEFAULT_DURATION_MIN } from "./types";

function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function addMinutes(hhmm: string, min: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + min);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * 월 단위 내 할 일 이벤트. 내 담당(또는 담당 없는 내 작업)만 — 캘린더는 "내 일정" 성격.
 * do_date 가 있으면 그 날(시간 있으면 시간 블록), 없고 due_date 만 있으면 마감일에 종일로 놓는다.
 */
export async function listTodoCalendarEvents(userId: string, month: string): Promise<CalendarEvent[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const { first, last } = monthRange(month);
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT i.item_id, i.title, i.status, i.do_date, i.do_time, i.duration_min, i.due_date, i.note, i.link_kind, i.link_id,
              i.owner_user_id, i.assignee_user_id
         FROM todo_items i
        WHERE ${visibleItemsWhere("$1")}
          AND (i.assignee_user_id = $1 OR (i.assignee_user_id IS NULL AND i.owner_user_id = $1))
          AND i.archived_at IS NULL AND i.parent_item_id IS NULL
          AND COALESCE(i.do_date, i.due_date) BETWEEN $2 AND $3
        ORDER BY COALESCE(i.do_date, i.due_date), i.do_time NULLS LAST`,
      [userId, first, last]
    )
  );
  return rows.map((r) => {
    const date = String(r.do_date ?? r.due_date);
    const startTime = r.do_date != null && r.do_time != null ? String(r.do_time) : null;
    const dur = r.duration_min != null ? Number(r.duration_min) : TODO_DEFAULT_DURATION_MIN;
    const done = String(r.status) === "done";
    const ev: CalendarEvent = {
      id: `todo:${String(r.item_id)}`,
      tag: "todo",
      kind: "todo",
      title: `${done ? "✓ " : ""}${String(r.title)}`,
      startDate: date,
      endDate: date,
      startTime,
      endTime: startTime ? addMinutes(startTime, dur) : null,
      location: null,
      people: [],
      summary: r.note != null ? String(r.note).slice(0, 200) : null,
      docId: r.link_kind === "approval_doc" && r.link_id != null ? String(r.link_id) : null,
      entryId: String(r.item_id),
      canEdit: true,
      canceled: false,
      status: null,
      dateField: r.do_date != null ? "do" : "due",
    };
    return ev;
  });
}
