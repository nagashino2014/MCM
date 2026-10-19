/*
 * 업무 보고 제출 → 하위 작업 역동기화(docs/todo-kanban-blueprint.md §28-2, 2026-10-19).
 *   saveReport(status submitted) 가 공정표를 갱신한 직후 호출된다. db 만 사용(store·workspace 를 import 하지 않아 순환 없음).
 *   대상: 그 계약/Task 에 연결된(link_kind contract/work_task + link_id) 상위 할 일의 하위 작업 중 stage_order 가 델타 단계와 같은 것.
 *   규칙(결정 F, 보고 값 우선): progress_pct = 단계 진행율(done 100) · actual_date = 단계 actual_date(있을 때만) · 예정일은 단계 planned_date 가 있고
 *   하위에 예정일이 없을 때만. 단계 done 이면 하위를 완료 처리(완료 조건 검사 생략 — 보고가 공식 경로). 이미 완료된 하위의 진행율은 내리지 않는다.
 *   멱등: 값이 같으면 변경·로그·알림 없음. 바뀐 하위의 상위 담당자(보고자 제외)에게 인앱 알림 1건(푸시 없음).
 */
import crypto from "node:crypto";
import { withDbWrite } from "@/lib/db";
import { rowsToObjects } from "@/lib/db";
import { recordTodoNotifications } from "./inbox";
import { todoItemLink } from "./types";

export interface StageSyncInput {
  stageOrder: number;
  stageName: string;
  status: "pending" | "in_progress" | "done";
  progressPct?: number | null;
  plannedDate?: string | null;
  actualDate?: string | null;
}

export interface StageSyncResult {
  matched: number;
  updated: number;
  completed: number;
  notified: number;
}

const newId = () => "ta" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const nowIso = () => new Date().toISOString();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateOrNull = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).slice(0, 10);
  return DATE_RE.test(s) ? s : null;
};

export async function syncTodoSubtasksFromStages(
  subjectKind: "contract" | "task",
  subjectId: string,
  stages: StageSyncInput[],
  reportId: string,
  actorUserId: string,
  /** done 단계의 actual_date 가 비었을 때 쓰는 보고 기준일(saveReport 와 동일 fallback). */
  fallbackActualDate?: string | null
): Promise<StageSyncResult> {
  const result: StageSyncResult = { matched: 0, updated: 0, completed: 0, notified: 0 };
  const byOrder = new Map<number, StageSyncInput>();
  for (const s of stages) if (s.stageName?.trim() && Number.isInteger(s.stageOrder)) byOrder.set(s.stageOrder, s);
  if (!byOrder.size) return result;
  const linkKind = subjectKind === "task" ? "work_task" : "contract";
  const fallback = dateOrNull(fallbackActualDate);

  // 상위별로 모아 알림 1건씩
  const touchedParents = new Map<string, { title: string; recipients: string[]; subtasks: string[] }>();

  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT s.item_id, s.title, s.status, s.progress_pct, s.actual_date, s.do_date, s.stage_order,
                p.item_id AS parent_id, p.title AS parent_title, p.owner_user_id, p.assignee_user_id
           FROM todo_items s
           JOIN todo_items p ON p.item_id = s.parent_item_id
          WHERE p.link_kind = $1 AND p.link_id = $2 AND p.archived_at IS NULL AND s.archived_at IS NULL AND s.stage_order IS NOT NULL
          ORDER BY p.item_id, s.stage_order`,
        [linkKind, subjectId]
      )
    );
    const now = nowIso();
    for (const r of rows) {
      const stage = byOrder.get(Number(r.stage_order));
      if (!stage) continue;
      result.matched += 1;
      const curStatus = String(r.status);
      const curPct = r.progress_pct != null ? Number(r.progress_pct) : null;
      const curActual = dateOrNull(r.actual_date);
      const curDo = dateOrNull(r.do_date);
      const stageDone = stage.status === "done";
      const stagePct = stageDone ? 100 : Math.max(0, Math.min(100, Math.round(Number(stage.progressPct ?? 0))));

      // 목표값 — 완료된 하위는 진행율을 내리지 않는다(완료=100).
      const nextStatus = stageDone ? "done" : curStatus;
      const nextPct = curStatus === "done" ? (curPct ?? 100) : stagePct;
      const nextActual = (stageDone ? dateOrNull(stage.actualDate) ?? fallback : dateOrNull(stage.actualDate)) ?? curActual;
      const nextDo = curDo ?? dateOrNull(stage.plannedDate);

      const pctChanged = nextPct !== curPct;
      const statusChanged = nextStatus !== curStatus;
      const actualChanged = nextActual !== curActual;
      const doChanged = nextDo !== curDo;
      if (!pctChanged && !statusChanged && !actualChanged && !doChanged) continue;

      await db.run(
        `UPDATE todo_items
            SET progress_pct = $2, actual_date = $3, do_date = $4, status = $5,
                completed_at = CASE WHEN $5 = 'done' THEN COALESCE(completed_at, $6) ELSE completed_at END,
                completed_by = CASE WHEN $5 = 'done' THEN COALESCE(completed_by, $7) ELSE completed_by END,
                progress_updated_at = CASE WHEN $8 THEN $6 ELSE progress_updated_at END,
                updated_at = $6, updated_by = $7
          WHERE item_id = $1`,
        [String(r.item_id), nextPct, nextActual, nextDo, nextStatus, now, actorUserId, pctChanged]
      );
      if (pctChanged || actualChanged || doChanged) {
        await db.run(
          `INSERT INTO todo_activity (activity_id, item_id, user_id, action, detail, created_at) VALUES ($1, $2, $3, 'progress', $4::jsonb, $5)`,
          [newId(), String(r.item_id), actorUserId, JSON.stringify({ from: curPct, to: nextPct, stage: Number(r.stage_order), source: "report", reportId, ...(actualChanged ? { actualDate: nextActual } : {}), ...(doChanged ? { doDate: nextDo } : {}) }), now]
        );
      }
      if (statusChanged) {
        await db.run(
          `INSERT INTO todo_activity (activity_id, item_id, user_id, action, detail, created_at) VALUES ($1, $2, $3, 'complete', $4::jsonb, $5)`,
          [newId(), String(r.item_id), actorUserId, JSON.stringify({ from: curStatus, to: "done", source: "report", reportId }), now]
        );
        result.completed += 1;
      }
      result.updated += 1;
      const parentId = String(r.parent_id);
      const entry = touchedParents.get(parentId) ?? {
        title: String(r.parent_title),
        recipients: [...new Set([r.assignee_user_id, r.owner_user_id].map((v) => (v != null ? String(v) : "")).filter((v) => v && v !== actorUserId))],
        subtasks: [],
      };
      entry.subtasks.push(String(r.title));
      touchedParents.set(parentId, entry);
    }
  });

  for (const [parentId, e] of touchedParents) {
    if (!e.recipients.length) continue;
    const body = `${e.title} — ${e.subtasks.slice(0, 3).join(", ")}${e.subtasks.length > 3 ? ` 외 ${e.subtasks.length - 3}건` : ""}`;
    await recordTodoNotifications(e.recipients, { event: "todo.status", title: "업무 보고 제출로 공정 진행율이 갱신됐습니다", body, link: todoItemLink(parentId), itemId: parentId, actorUserId });
    result.notified += e.recipients.length;
  }
  return result;
}
