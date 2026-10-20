/*
 * To-do → 캘린더 이벤트 변환(§13-7). do_date/due_date 가 있는 내 가시 작업을 CalendarEvent 로.
 * /api/calendar 의 `todo` 태그 소스(P1) — tag/kind "todo" 는 lib/calendar/types.ts 에 정식 등록돼 있다.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import type { CalendarEvent } from "@/lib/calendar/types";
import { visibleItemsWhere } from "./visibility";
import { TODO_DEFAULT_DURATION_MIN, TODO_MILESTONE_LABELS, type TodoMilestoneKind } from "./types";

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
      `SELECT i.item_id, i.title, i.status, i.do_date, i.do_time, i.duration_min, i.due_date, i.end_date, i.note, i.link_kind, i.link_id,
              i.owner_user_id, i.assignee_user_id
         FROM todo_items i
        WHERE ${visibleItemsWhere("$1")}
          AND (i.assignee_user_id = $1 OR (i.assignee_user_id IS NULL AND i.owner_user_id = $1))
          AND i.archived_at IS NULL AND i.parent_item_id IS NULL
          AND (COALESCE(i.do_date, i.due_date) BETWEEN $2 AND $3
               OR (i.do_date IS NOT NULL AND i.end_date IS NOT NULL AND i.do_date <= $3 AND i.end_date >= $2))
        ORDER BY COALESCE(i.do_date, i.due_date), i.do_time NULLS LAST`,
      [userId, first, last]
    )
  );
  // 287 하위 작업 마일스톤(종류가 있는 것) — "상위 제목 · 종류" 로 그 날(실제 일자 우선, 없으면 예정일)에 표시
  const msRows = rowsToObjects(
    await db.exec(
      `SELECT s.item_id, s.title, s.milestone_kind, s.actual_date, s.do_date, s.end_date, s.status, p.item_id AS parent_id, p.title AS parent_title, p.link_kind, p.link_id,
              (SELECT mk.label FROM todo_milestone_kinds mk WHERE mk.kind_key = s.milestone_kind ORDER BY mk.is_active DESC LIMIT 1) AS kind_label
         FROM todo_items s
         JOIN todo_items p ON p.item_id = s.parent_item_id
        WHERE s.milestone_kind IS NOT NULL AND s.archived_at IS NULL AND p.archived_at IS NULL
          AND (p.assignee_user_id = $1 OR p.owner_user_id = $1)
          AND COALESCE(s.actual_date, s.do_date) BETWEEN $2 AND $3
        ORDER BY COALESCE(s.actual_date, s.do_date)`,
      [userId, first, last]
    )
  );
  const milestones: CalendarEvent[] = msRows.map((r) => {
    const date = String(r.actual_date ?? r.do_date);
    const kind = String(r.milestone_kind) as TodoMilestoneKind;
    const kindLabel = (r.kind_label != null ? String(r.kind_label) : null) ?? TODO_MILESTONE_LABELS[kind] ?? kind;
    const subTitle = String(r.title ?? "").trim();
    // 하위 제목이 종류 라벨과 같으면 한 번만
    const label = kind === "other" ? subTitle : subTitle && subTitle !== kindLabel ? `${kindLabel} · ${subTitle}` : kindLabel;
    return {
      id: `todo:${String(r.item_id)}`,
      tag: "todo",
      kind: "todo",
      title: `${r.actual_date != null ? "◆ " : "◇ "}${String(r.parent_title)} · ${label}`,
      startDate: date,
      // 302: 시작일~종료일(실제 일자가 있으면 그 하루)
      endDate: r.actual_date == null && r.end_date != null && String(r.end_date) > date ? String(r.end_date) : date,
      startTime: null,
      endTime: null,
      location: null,
      people: [],
      summary: null,
      docId: null,
      // 상세는 상위 할 일로(하위는 상위 페이지의 하위 작업 섹션에서 편집)
      entryId: String(r.parent_id),
      canEdit: false,
      canceled: false,
      status: null,
      dateField: r.actual_date != null ? undefined : "do",
    };
  });
  const main = rows.map((r) => {
    const date = String(r.do_date ?? r.due_date);
    // 287 기간 일정 — do_date~end_date 바
    const endDate = r.do_date != null && r.end_date != null && String(r.end_date) >= date ? String(r.end_date) : date;
    const startTime = r.do_date != null && r.do_time != null ? String(r.do_time) : null;
    const dur = r.duration_min != null ? Number(r.duration_min) : TODO_DEFAULT_DURATION_MIN;
    const done = String(r.status) === "done";
    const ev: CalendarEvent = {
      id: `todo:${String(r.item_id)}`,
      tag: "todo",
      kind: "todo",
      title: `${done ? "✓ " : ""}${String(r.title)}`,
      startDate: date,
      endDate,
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
  return [...main, ...milestones];
}
