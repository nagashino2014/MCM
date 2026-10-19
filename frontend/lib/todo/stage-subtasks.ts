/*
 * 공정표 단계로 하위 작업 만들기(docs/todo-kanban-blueprint.md §28-1, 2026-10-19).
 *   관련이 계약(contract) / 업무추진계획 Task(work_task) 인 할 일에서 그 공정표의 단계마다 하위 작업 1건을 뒤에 추가한다.
 *   제목=단계명 · stage_order 매핑 · 예정일=단계 planned_date · 이미 done 인 단계는 완료 상태·100%·실제일(결정 E) · in_progress 는 단계 진행율.
 *   같은 stage_order 가 이미 매핑된 하위가 있으면 건너뛴다. 마일스톤 종류는 단계명 키워드(TODO_MILESTONE_STAGE_HINTS 역방향)로 자동.
 */
import crypto from "node:crypto";
import { withDbWrite } from "@/lib/db";
import { listContractStages } from "@/lib/contracts/process-stages";
import { listTaskStages } from "@/lib/work-plan/task-stages";
import { createItem, getItemDetail } from "./store";
import { TODO_MILESTONE_STAGE_HINTS, type TodoItemDetail, type TodoMilestoneKind } from "./types";

const fail = (message: string, status = 400): Error => Object.assign(new Error(message), { status });

/** 단계명 → 마일스톤 종류(키워드 포함, 사전 순서대로 첫 일치). 없으면 null. */
export function milestoneKindForStage(stageName: string): TodoMilestoneKind | null {
  const name = stageName.replace(/\s+/g, "");
  for (const [kind, hints] of Object.entries(TODO_MILESTONE_STAGE_HINTS) as [TodoMilestoneKind, string[]][]) {
    if (hints.some((h) => name.includes(h.replace(/\s+/g, "")))) return kind;
  }
  return null;
}

export async function createSubtasksFromStages(userId: string, itemId: string): Promise<{ item: TodoItemDetail; created: number; skipped: number }> {
  const detail = await getItemDetail(userId, itemId);
  if (!detail.canEdit) throw fail("이 할 일을 편집할 수 없습니다.", 403);
  if (detail.parentItemId) throw fail("하위 작업 아래에는 만들 수 없습니다.");
  if (!detail.reportSubject || !detail.linkId) throw fail("관련 연결이 계약(용역) 또는 업무추진계획 Task 일 때만 공정표 단계를 가져올 수 있습니다.");
  const rows = detail.reportSubject === "contract" ? await listContractStages(detail.linkId) : await listTaskStages(detail.linkId);
  if (!rows.length) throw fail("관련 대상에 공정표가 없습니다.");
  const existing = new Set(detail.subtasks.map((s) => s.stageOrder).filter((n): n is number => n != null));
  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.stageName.trim()) continue;
    if (existing.has(r.stageOrder)) {
      skipped += 1;
      continue;
    }
    const done = r.status === "done";
    await createItem(userId, {
      title: r.stageName.trim(),
      parentItemId: itemId,
      doDate: r.plannedDate,
      stageOrder: r.stageOrder,
      milestoneKind: milestoneKindForStage(r.stageName),
      status: done ? "done" : r.status === "in_progress" ? "doing" : "todo",
      progressPct: done ? 100 : r.progressPct > 0 ? Math.min(100, Math.round(r.progressPct)) : null,
      actualDate: done ? r.actualDate : null,
    });
    created += 1;
  }
  if (created) {
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO todo_activity (activity_id, item_id, user_id, action, detail, created_at) VALUES ($1, $2, $3, 'update', $4::jsonb, $5)`,
        ["ta" + crypto.randomUUID().replace(/-/g, "").slice(0, 16), itemId, userId, JSON.stringify({ fromStages: created, skipped }), new Date().toISOString()]
      );
    });
  }
  return { item: await getItemDetail(userId, itemId), created, skipped };
}
