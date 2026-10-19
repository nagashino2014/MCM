/*
 * 보드 자동화 규칙 — DB·실행(296, §29-2). 순수 정의는 rules-shared.ts.
 *   CRUD: 보드 admin(myRole=admin)만 편집, 보드를 볼 수 있으면 열람. 보드당 20개.
 *   실행: store 의 updateItem/completeItem 이 커밋 뒤 runItemRules(event) 를 fire-and-forget 으로 호출(순환 import 을 피해 store 는 동적 import).
 *   시간 트리거(due_before)는 remind-tick 의 dispatchTodoRules(). todo_rule_runs(rule, item, run_key) 로 멱등 — 규칙이 일으킨 변경(patch.__rule)은
 *   규칙을 다시 타지 않는다(깊이 1). 실패는 로그만(원 변경은 유지).
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { postTextMessage } from "@/lib/chat/queries";
import { recordTodoNotifications } from "./inbox";
import { TODO_STATUS_LABELS, todoItemLink, type TodoStatus } from "./types";
import { TODO_RULE_MAX_PER_BOARD, describeRule, normalizeAction, normalizeCondition, normalizeTrigger, type TodoBoardRule, type TodoRuleAction, type TodoRuleCondition, type TodoRuleTrigger } from "./rules-shared";

export type { TodoBoardRule } from "./rules-shared";

export interface TodoRuleEvent {
  kind: "completed" | "status" | "subtasks_done";
  itemId: string;
  boardId: string;
  status?: TodoStatus;
  actorUserId: string;
}

const fail = (message: string, status = 400): Error => Object.assign(new Error(message), { status });
const nowIso = () => new Date().toISOString();
const newId = (p: string) => p + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function mapRule(r: Record<string, unknown>): TodoBoardRule {
  const j = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : typeof v === "string" ? (JSON.parse(v) as Record<string, unknown>) : {});
  return {
    ruleId: String(r.rule_id),
    boardId: String(r.board_id),
    name: String(r.name),
    enabled: Number(r.enabled) === 1,
    trigger: j(r.trigger) as unknown as TodoRuleTrigger,
    condition: j(r.condition) as unknown as TodoRuleCondition,
    action: j(r.action) as unknown as TodoRuleAction,
    position: Number(r.position ?? 0),
    runCount: Number(r.run_count ?? 0),
    lastRunAt: r.last_run_at != null ? String(r.last_run_at) : null,
    createdBy: r.created_by != null ? String(r.created_by) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

async function boardRoleOf(userId: string, boardId: string): Promise<"admin" | "member" | "viewer"> {
  const { getBoard } = await import("./store");
  const b = await getBoard(userId, boardId); // 볼 수 없으면 403
  return b.myRole;
}

export async function listRules(userId: string, boardId: string): Promise<TodoBoardRule[]> {
  await boardRoleOf(userId, boardId);
  const db = await getDb();
  return rowsToObjects(await db.exec(`SELECT * FROM todo_board_rules WHERE board_id = $1 ORDER BY position, created_at`, [boardId])).map(mapRule);
}

function normalizeInput(input: Record<string, unknown>, cur?: TodoBoardRule) {
  const name = (typeof input.name === "string" ? input.name.trim() : (cur?.name ?? "")).slice(0, 80);
  if (!name) throw fail("규칙 이름을 입력하세요.");
  const trigger = input.trigger !== undefined ? normalizeTrigger(input.trigger) : cur ? cur.trigger : normalizeTrigger(undefined);
  const condition = input.condition !== undefined ? normalizeCondition(input.condition) : (cur?.condition ?? {});
  const action = input.action !== undefined ? normalizeAction(input.action) : cur ? cur.action : normalizeAction(undefined);
  const enabled = input.enabled === undefined ? (cur?.enabled ?? true) : input.enabled === true || input.enabled === 1 || input.enabled === "1" || input.enabled === "true";
  return { name, trigger, condition, action, enabled };
}

export async function createRule(userId: string, boardId: string, input: Record<string, unknown>): Promise<TodoBoardRule> {
  if ((await boardRoleOf(userId, boardId)) !== "admin") throw fail("보드 관리자만 자동화를 편집할 수 있습니다.", 403);
  const v = normalizeInput(input);
  const ruleId = newId("tr_");
  await withDbWrite(async (db) => {
    const n = Number(rowsToObjects(await db.exec(`SELECT COUNT(*)::int AS n FROM todo_board_rules WHERE board_id = $1`, [boardId]))[0]?.n ?? 0);
    if (n >= TODO_RULE_MAX_PER_BOARD) throw fail(`보드당 자동화 규칙은 ${TODO_RULE_MAX_PER_BOARD}개까지입니다.`);
    await db.run(
      `INSERT INTO todo_board_rules (rule_id, board_id, name, enabled, trigger, condition, action, position, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$10)`,
      [ruleId, boardId, v.name, v.enabled ? 1 : 0, JSON.stringify(v.trigger), JSON.stringify(v.condition), JSON.stringify(v.action), n, userId, nowIso()]
    );
  });
  return (await listRules(userId, boardId)).find((r) => r.ruleId === ruleId)!;
}

export async function updateRule(userId: string, boardId: string, ruleId: string, input: Record<string, unknown>): Promise<TodoBoardRule> {
  if ((await boardRoleOf(userId, boardId)) !== "admin") throw fail("보드 관리자만 자동화를 편집할 수 있습니다.", 403);
  const cur = (await listRules(userId, boardId)).find((r) => r.ruleId === ruleId);
  if (!cur) throw fail("규칙을 찾을 수 없습니다.", 404);
  const v = normalizeInput(input, cur);
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE todo_board_rules SET name = $2, enabled = $3, trigger = $4::jsonb, condition = $5::jsonb, action = $6::jsonb, updated_at = $7 WHERE rule_id = $1 AND board_id = $8`,
      [ruleId, v.name, v.enabled ? 1 : 0, JSON.stringify(v.trigger), JSON.stringify(v.condition), JSON.stringify(v.action), nowIso(), boardId]
    );
  });
  return (await listRules(userId, boardId)).find((r) => r.ruleId === ruleId)!;
}

export async function deleteRule(userId: string, boardId: string, ruleId: string): Promise<void> {
  if ((await boardRoleOf(userId, boardId)) !== "admin") throw fail("보드 관리자만 자동화를 편집할 수 있습니다.", 403);
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM todo_board_rules WHERE rule_id = $1 AND board_id = $2`, [ruleId, boardId]);
  });
}

// ── 실행 ──
interface RuleItem {
  itemId: string;
  boardId: string;
  boardName: string;
  title: string;
  status: TodoStatus;
  priority: number;
  linkKind: string | null;
  ownerUserId: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  completedAt: string | null;
  updatedAt: string;
}

async function loadRuleItem(db: PgDatabase, itemId: string): Promise<RuleItem | null> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT i.item_id, i.board_id, b.name AS board_name, i.title, i.status, i.priority, i.link_kind, i.owner_user_id, i.assignee_user_id, au.name AS assignee_name, i.completed_at, i.updated_at
         FROM todo_items i JOIN todo_boards b ON b.board_id = i.board_id LEFT JOIN users au ON au.user_id = i.assignee_user_id
        WHERE i.item_id = $1 AND i.archived_at IS NULL AND i.parent_item_id IS NULL`,
      [itemId]
    )
  );
  const r = rows[0];
  if (!r) return null;
  return {
    itemId: String(r.item_id),
    boardId: String(r.board_id),
    boardName: String(r.board_name),
    title: String(r.title),
    status: String(r.status) as TodoStatus,
    priority: Number(r.priority ?? 0),
    linkKind: r.link_kind != null ? String(r.link_kind) : null,
    ownerUserId: String(r.owner_user_id),
    assigneeUserId: r.assignee_user_id != null ? String(r.assignee_user_id) : null,
    assigneeName: r.assignee_name != null ? String(r.assignee_name) : null,
    completedAt: r.completed_at != null ? String(r.completed_at) : null,
    updatedAt: String(r.updated_at),
  };
}

function matchesCondition(c: TodoRuleCondition, it: RuleItem): boolean {
  if (c.priorityMin && it.priority < c.priorityMin) return false;
  if (c.titlePrefix && !it.title.startsWith(c.titlePrefix)) return false;
  if (c.linkKind && it.linkKind !== c.linkKind) return false;
  return true;
}

/** 규칙 1건을 할 일 1건에 적용(멱등 키 선점 뒤). actor = 이벤트를 일으킨 사람(없으면 규칙 작성자·할 일 작성자). */
async function applyRule(rule: TodoBoardRule, it: RuleItem, runKey: string, actorUserId: string): Promise<boolean> {
  let claimed = false;
  await withDbWrite(async (db) => {
    const ins = rowsToObjects(
      await db.exec(`INSERT INTO todo_rule_runs (rule_id, item_id, run_key, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING rule_id`, [rule.ruleId, it.itemId, runKey, nowIso()])
    );
    claimed = ins.length > 0;
  });
  if (!claimed) return false;
  const a = rule.action;
  const store = await import("./store");
  try {
    switch (a.kind) {
      case "set_status":
        if (a.status && a.status !== it.status) await store.updateItem(actorUserId, it.itemId, { status: a.status, __rule: true });
        break;
      case "assign": {
        const to = a.assignee === "owner" ? it.ownerUserId : a.assignee;
        if (to && to !== it.assigneeUserId) await store.updateItem(actorUserId, it.itemId, { assigneeUserId: to, __rule: true });
        break;
      }
      case "notify": {
        const text = (a.message ?? "")
          .replace(/\{title\}/g, it.title)
          .replace(/\{status\}/g, TODO_STATUS_LABELS[it.status] ?? it.status)
          .replace(/\{assignee\}/g, it.assigneeName ?? "담당 없음")
          .replace(/\{board\}/g, it.boardName);
        if (a.roomId) await postTextMessage(a.roomId, actorUserId, text);
        if (a.inApp) {
          const to = [...new Set([it.assigneeUserId ?? it.ownerUserId])];
          await recordTodoNotifications(to, { event: "todo.status", title: `자동화 · ${rule.name}`, body: text.slice(0, 200), link: todoItemLink(it.itemId), itemId: it.itemId, actorUserId });
        }
        break;
      }
      case "apply_template": {
        const { applyTemplate } = await import("./templates");
        if (a.templateId) await applyTemplate(actorUserId, it.itemId, a.templateId);
        break;
      }
    }
    await withDbWrite(async (db) => {
      await db.run(`UPDATE todo_board_rules SET run_count = run_count + 1, last_run_at = $2 WHERE rule_id = $1`, [rule.ruleId, nowIso()]);
      await db.run(
        `INSERT INTO todo_activity (activity_id, item_id, user_id, action, detail, created_at) VALUES ($1, $2, $3, 'update', $4::jsonb, $5)`,
        [newId("ta"), it.itemId, actorUserId, JSON.stringify({ rule: rule.name, ruleAction: a.kind, summary: describeRule(rule) }), nowIso()]
      );
    });
    return true;
  } catch (e) {
    console.error("[todo-rules] 규칙 실행 실패", rule.ruleId, it.itemId, e);
    return false;
  }
}

/** 이벤트 트리거 — store 가 커밋 뒤 호출(fire-and-forget). 상위 할 일만 대상. */
export async function runItemRules(ev: TodoRuleEvent): Promise<number> {
  try {
    const db = await getDb();
    const rules = rowsToObjects(await db.exec(`SELECT * FROM todo_board_rules WHERE board_id = $1 AND enabled = 1 ORDER BY position, created_at`, [ev.boardId])).map(mapRule);
    const hit = rules.filter((r) => r.trigger.kind === ev.kind && (ev.kind !== "status" || r.trigger.status === ev.status));
    if (!hit.length) return 0;
    const it = await loadRuleItem(db, ev.itemId);
    if (!it) return 0;
    let n = 0;
    for (const r of hit) {
      if (!matchesCondition(r.condition, it)) continue;
      const runKey = ev.kind === "completed" ? `completed:${it.completedAt ?? it.updatedAt}` : ev.kind === "status" ? `status:${ev.status}:${it.updatedAt}` : `subtasks_done:${kstToday()}`;
      if (await applyRule(r, it, runKey, ev.actorUserId)) n += 1;
    }
    return n;
  } catch (e) {
    console.error("[todo-rules] 이벤트 처리 실패", ev, e);
    return 0;
  }
}

/** 시간 트리거(마감 N일 전) — remind-tick 이 5분마다 호출. 하루 1회(run_key due_before:<date>). */
export async function dispatchTodoRules(): Promise<{ rulesRun: number; rulesEvaluated: number }> {
  const today = kstToday();
  const db = await getDb();
  const rules = rowsToObjects(await db.exec(`SELECT * FROM todo_board_rules WHERE enabled = 1 AND trigger->>'kind' = 'due_before'`)).map(mapRule);
  let run = 0;
  for (const r of rules) {
    const target = addDays(today, r.trigger.days ?? 1);
    const rows = rowsToObjects(
      await db.exec(
        `SELECT i.item_id FROM todo_items i
          WHERE i.board_id = $1 AND i.parent_item_id IS NULL AND i.archived_at IS NULL AND i.status <> 'done'
            AND COALESCE(i.due_date, i.do_date) = $2
            AND NOT EXISTS (SELECT 1 FROM todo_rule_runs x WHERE x.rule_id = $3 AND x.item_id = i.item_id AND x.run_key = $4)`,
        [r.boardId, target, r.ruleId, `due_before:${today}`]
      )
    );
    for (const row of rows) {
      const it = await loadRuleItem(db, String(row.item_id));
      if (!it || !matchesCondition(r.condition, it)) continue;
      if (await applyRule(r, it, `due_before:${today}`, r.createdBy ?? it.ownerUserId)) run += 1;
    }
  }
  return { rulesRun: run, rulesEvaluated: rules.length };
}
