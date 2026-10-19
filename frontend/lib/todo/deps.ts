/*
 * 할 일 선행·후행 의존 관계(288 todo_item_deps, docs/todo-kanban-blueprint.md §28-3, 보강 4).
 *   item_id=후행, depends_on_item_id=선행. 자기 참조·순환은 거절(DFS). 범위 = 내가 볼 수 있는 할 일(결정 H).
 *   선행이 완료되지 않은 후행은 "대기" 표시(상태는 바꾸지 않음). 완료 차단은 완료 조건 deps 로 선택(결정 G).
 *   선행 완료 시 후행(남은 선행이 없을 때만) 담당자에게 푸시+인앱 알림.
 */
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { sendPush } from "@/lib/notify/push-expo";
import { recordTodoNotifications } from "./inbox";
import { visibleItemsWhere } from "./visibility";
import { todoItemLink, type TodoDepRef, type TodoDeps, type TodoStatus } from "./types";

export type { TodoDepRef, TodoDeps };

const fail = (message: string, status = 400): Error => Object.assign(new Error(message), { status });
const nowIso = () => new Date().toISOString();

const REF_SELECT = (joinCol: string, whereCol: string) => `
  SELECT t.item_id, t.title, t.status, t.do_date, t.due_date, t.end_date, t.parent_item_id, au.name AS assignee_name, b.name AS board_name,
         CASE WHEN ${visibleItemsWhere("$2", "t")} THEN 1 ELSE 0 END AS visible
    FROM todo_item_deps d
    JOIN todo_items t ON t.item_id = d.${joinCol}
    LEFT JOIN users au ON au.user_id = t.assignee_user_id
    LEFT JOIN todo_boards b ON b.board_id = t.board_id
   WHERE d.${whereCol} = $1 AND t.archived_at IS NULL
   ORDER BY (t.status = 'done'), COALESCE(t.do_date, t.due_date) NULLS LAST, t.title`;

function mapRef(r: Record<string, unknown>): TodoDepRef {
  const visible = Number(r.visible) === 1;
  return {
    itemId: String(r.item_id),
    title: visible ? String(r.title) : "비공개 할 일",
    status: String(r.status) as TodoStatus,
    doDate: visible && r.do_date != null ? String(r.do_date) : null,
    dueDate: visible && r.due_date != null ? String(r.due_date) : null,
    endDate: visible && r.end_date != null ? String(r.end_date) : null,
    assigneeName: visible && r.assignee_name != null ? String(r.assignee_name) : null,
    boardName: visible && r.board_name != null ? String(r.board_name) : null,
    parentItemId: r.parent_item_id != null ? String(r.parent_item_id) : null,
    visible,
  };
}

async function canSee(db: PgDatabase, userId: string, itemId: string): Promise<boolean> {
  const rows = rowsToObjects(await db.exec(`SELECT 1 FROM todo_items i WHERE i.item_id = $1 AND i.archived_at IS NULL AND ${visibleItemsWhere("$2")}`, [itemId, userId]));
  return rows.length > 0;
}

export async function listDeps(userId: string, itemId: string): Promise<TodoDeps> {
  const db = await getDb();
  if (!(await canSee(db, userId, itemId))) throw fail("이 할 일을 볼 수 없습니다.", 403);
  const blockedBy = rowsToObjects(await db.exec(REF_SELECT("depends_on_item_id", "item_id"), [itemId, userId])).map(mapRef);
  const blocks = rowsToObjects(await db.exec(REF_SELECT("item_id", "depends_on_item_id"), [itemId, userId])).map(mapRef);
  return { blockedBy, blocks, openBlockers: blockedBy.filter((d) => d.status !== "done").length };
}

/** 의존 간선 일괄 조회(§29-1 타임라인) — 양쪽이 모두 요청 집합에 있고 가시 범위인 간선만. */
export async function listDepEdges(userId: string, itemIds: string[]): Promise<{ itemId: string; dependsOnItemId: string }[]> {
  if (!itemIds.length) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.item_id, d.depends_on_item_id
         FROM todo_item_deps d
         JOIN todo_items i ON i.item_id = d.item_id
         JOIN todo_items p ON p.item_id = d.depends_on_item_id
        WHERE d.item_id = ANY($2::text[]) AND d.depends_on_item_id = ANY($2::text[])
          AND i.archived_at IS NULL AND p.archived_at IS NULL
          AND ${visibleItemsWhere("$1", "i")} AND ${visibleItemsWhere("$1", "p")}`,
      [userId, itemIds]
    )
  );
  return rows.map((r) => ({ itemId: String(r.item_id), dependsOnItemId: String(r.depends_on_item_id) }));
}

/** 미완료 선행 수(완료 조건 deps 검사용). */
export async function openDepCount(db: PgDatabase, itemId: string): Promise<number> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT COUNT(*)::int AS n FROM todo_item_deps d JOIN todo_items p ON p.item_id = d.depends_on_item_id
        WHERE d.item_id = $1 AND p.status <> 'done' AND p.archived_at IS NULL`,
      [itemId]
    )
  );
  return Number(rows[0]?.n ?? 0);
}

/** 순환 검사 — dependsOn 에서 출발해 선행 방향으로 따라가다 itemId 를 만나면 순환. */
async function wouldCycle(db: PgDatabase, itemId: string, dependsOn: string): Promise<boolean> {
  const seen = new Set<string>();
  const stack = [dependsOn];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === itemId) return true;
    if (seen.has(cur) || seen.size > 500) continue;
    seen.add(cur);
    const rows = rowsToObjects(await db.exec(`SELECT depends_on_item_id FROM todo_item_deps WHERE item_id = $1`, [cur]));
    for (const r of rows) stack.push(String(r.depends_on_item_id));
  }
  return false;
}

export async function addDep(userId: string, itemId: string, dependsOn: string): Promise<TodoDeps> {
  if (!dependsOn || dependsOn === itemId) throw fail("자기 자신을 선행으로 둘 수 없습니다.");
  await withDbWrite(async (db) => {
    if (!(await canSee(db, userId, itemId))) throw fail("이 할 일을 볼 수 없습니다.", 403);
    if (!(await canSee(db, userId, dependsOn))) throw fail("선행으로 지정할 할 일을 볼 수 없습니다.", 403);
    if (await wouldCycle(db, itemId, dependsOn)) throw fail("순환 의존이 됩니다 — 선행의 선행에 이 할 일이 있습니다.");
    await db.run(
      `INSERT INTO todo_item_deps (item_id, depends_on_item_id, created_by, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [itemId, dependsOn, userId, nowIso()]
    );
    await db.run(
      `INSERT INTO todo_activity (activity_id, item_id, user_id, action, detail, created_at) VALUES ($1, $2, $3, 'update', $4::jsonb, $5)`,
      ["ta" + crypto.randomUUID().replace(/-/g, "").slice(0, 16), itemId, userId, JSON.stringify({ dependsOn, added: true }), nowIso()]
    );
  });
  return listDeps(userId, itemId);
}

export async function removeDep(userId: string, itemId: string, dependsOn: string): Promise<TodoDeps> {
  await withDbWrite(async (db) => {
    if (!(await canSee(db, userId, itemId))) throw fail("이 할 일을 볼 수 없습니다.", 403);
    await db.run(`DELETE FROM todo_item_deps WHERE item_id = $1 AND depends_on_item_id = $2`, [itemId, dependsOn]);
    await db.run(
      `INSERT INTO todo_activity (activity_id, item_id, user_id, action, detail, created_at) VALUES ($1, $2, $3, 'update', $4::jsonb, $5)`,
      ["ta" + crypto.randomUUID().replace(/-/g, "").slice(0, 16), itemId, userId, JSON.stringify({ dependsOn, removed: true }), nowIso()]
    );
  });
  return listDeps(userId, itemId);
}

/** 선행 후보 검색 — 제목·프로젝트명 ILIKE, 가시 범위, 보관·완료 제외, 자기 자신·이미 선행인 것 제외. */
export async function searchItems(userId: string, q: string, opts?: { excludeItemId?: string | null; limit?: number }): Promise<TodoDepRef[]> {
  const term = q.trim().replace(/\s+/g, " ");
  if (term.length < 1) return [];
  const db = await getDb();
  const vals: unknown[] = [userId, `%${term}%`, Math.min(50, Math.max(1, opts?.limit ?? 20))];
  let exclude = "";
  if (opts?.excludeItemId) {
    vals.push(opts.excludeItemId);
    exclude = `AND t.item_id <> $4 AND NOT EXISTS (SELECT 1 FROM todo_item_deps x WHERE x.item_id = $4 AND x.depends_on_item_id = t.item_id)`;
  }
  const rows = rowsToObjects(
    await db.exec(
      `SELECT t.item_id, t.title, t.status, t.do_date, t.due_date, t.end_date, t.parent_item_id, au.name AS assignee_name, b.name AS board_name, 1 AS visible
         FROM todo_items t
         LEFT JOIN users au ON au.user_id = t.assignee_user_id
         LEFT JOIN todo_boards b ON b.board_id = t.board_id
        WHERE ${visibleItemsWhere("$1", "t")} AND t.archived_at IS NULL AND t.status <> 'done'
          AND (t.title ILIKE $2 OR COALESCE(b.project_name, '') ILIKE $2 OR COALESCE(b.name, '') ILIKE $2)
          ${exclude}
        ORDER BY COALESCE(t.do_date, t.due_date) NULLS LAST, t.updated_at DESC
        LIMIT $3`,
      vals
    )
  );
  return rows.map(mapRef);
}

/**
 * 선행이 완료됐을 때(completeItem 뒤, fire-and-forget) — 그 선행을 기다리던 후행 중 남은 선행이 없는 것의 담당자에게 알림.
 * 완료를 되돌리면 알림하지 않는다.
 */
export async function notifyDependentsUnblocked(db: PgDatabase, doneItemId: string, byUserId: string, byName: string | null): Promise<void> {
  try {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT t.item_id, t.title, t.owner_user_id, t.assignee_user_id, p.title AS prev_title
           FROM todo_item_deps d
           JOIN todo_items t ON t.item_id = d.item_id
           JOIN todo_items p ON p.item_id = d.depends_on_item_id
          WHERE d.depends_on_item_id = $1 AND t.status <> 'done' AND t.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM todo_item_deps d2 JOIN todo_items p2 ON p2.item_id = d2.depends_on_item_id
                             WHERE d2.item_id = t.item_id AND p2.status <> 'done' AND p2.archived_at IS NULL)`,
        [doneItemId]
      )
    );
    for (const r of rows) {
      const itemId = String(r.item_id);
      const recipients = [...new Set([r.assignee_user_id, r.owner_user_id].map((v) => (v != null ? String(v) : "")).filter((v) => v && v !== byUserId))];
      if (!recipients.length) continue;
      const title = "선행 작업 완료 — 시작할 수 있습니다";
      const body = `${byName ? byName + " · " : ""}'${String(r.prev_title)}' 완료 → ${String(r.title)}`;
      void recordTodoNotifications(recipients, { event: "todo.status", title, body, link: todoItemLink(itemId), itemId, actorUserId: byUserId });
      void sendPush(recipients, { event: "todo.status", title, body, link: todoItemLink(itemId), targetRef: itemId, dedupKey: `todo-unblocked:${itemId}:${doneItemId}` }).catch(() => {});
    }
  } catch (e) {
    console.error("[todo] 후행 알림 실패", e);
  }
}
