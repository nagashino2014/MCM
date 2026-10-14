/*
 * To-do 가시성·편집 권한 — 단일 진입점(docs/todo-kanban-blueprint.md §6.3·§17).
 *   1. 보드 멤버(admin/member/viewer)는 보드의 모든 작업을 본다.
 *   2. 개인 보드 작업은 owner·담당자 + todo_item_shares 에 있는 사람만.
 *   3. 관리자(todo.admin)는 보드 목록·멤버 관리만 — 개인 작업 본문은 보지 못한다(여기서도 우회 없음).
 *   4. 부서장·임원 공유는 부서 보드 이동 또는 작업 공유로만(자동 상향 공개 없음).
 * 모든 목록 조회는 visibleItemsWhere() 조각을 거친다.
 */
import { getDb, rowsToObjects, type PgDatabase } from "@/lib/db";
import { hasPermission } from "@/lib/auth/rbac";
import type { TodoMemberRole, TodoShareRole } from "./types";

export interface ItemAccessRow {
  itemId: string;
  boardId: string;
  parentItemId: string | null;
  ownerUserId: string;
  assigneeUserId: string | null;
}

export interface BoardAccessRow {
  boardId: string;
  kind: string;
  ownerUserId: string;
}

/** 전사 보드·멤버 관리 권한(todo.admin — tpl-system-admin·tpl-exec). */
export async function isTodoAdmin(userId: string): Promise<boolean> {
  try {
    return await hasPermission(userId, "todo.admin");
  } catch {
    return false;
  }
}

/**
 * 부서장(tpl-dept-lead)·임원(tpl-exec) 템플릿 배정 여부 — 부서 보드 생성 권한(§13-6).
 * user_permission_assignments 활성 행(revoked_at IS NULL, 유효기간 내) 기준.
 */
export async function isDeptLeadOrExec(userId: string, db?: PgDatabase): Promise<boolean> {
  const conn = db ?? (await getDb());
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const rows = rowsToObjects(
    await conn.exec(
      `SELECT 1
         FROM user_permission_assignments a
         JOIN permission_templates t ON t.template_id = a.template_id
        WHERE a.user_id = $1
          AND a.revoked_at IS NULL
          AND a.template_id IN ('tpl-dept-lead', 'tpl-exec')
          AND t.is_active = 1
          AND substr(a.effective_from, 1, 10) <= $2
          AND (a.effective_to IS NULL OR a.effective_to = '' OR substr(a.effective_to, 1, 10) >= $2)
        LIMIT 1`,
      [userId, today]
    )
  );
  return rows.length > 0;
}

/** 부서 보드 생성 가능: 부서장·임원·관리자. */
export async function canCreateDeptBoard(userId: string, db?: PgDatabase): Promise<boolean> {
  if (await isDeptLeadOrExec(userId, db)) return true;
  return isTodoAdmin(userId);
}

/** 보드 안에서의 역할(owner = admin). 멤버가 아니면 null. */
export async function boardRole(db: PgDatabase, board: BoardAccessRow, userId: string): Promise<TodoMemberRole | null> {
  if (board.ownerUserId === userId) return "admin";
  const rows = rowsToObjects(
    await db.exec(`SELECT role FROM todo_board_members WHERE board_id = $1 AND user_id = $2`, [board.boardId, userId])
  );
  if (!rows.length) return null;
  const r = String(rows[0].role);
  return r === "admin" || r === "member" || r === "viewer" ? r : null;
}

/** 작업(또는 그 부모) 공유 역할. 없으면 null. 담당 > 협업 > 참조 순으로 가장 강한 것. */
export async function itemShareRole(db: PgDatabase, item: ItemAccessRow, userId: string): Promise<TodoShareRole | null> {
  const ids = [item.itemId, item.parentItemId].filter((v): v is string => !!v);
  const rows = rowsToObjects(
    await db.exec(`SELECT role FROM todo_item_shares WHERE user_id = $1 AND item_id = ANY($2::text[])`, [userId, ids])
  );
  const roles = rows.map((r) => String(r.role));
  if (roles.includes("assignee")) return "assignee";
  if (roles.includes("collaborator")) return "collaborator";
  if (roles.includes("watcher")) return "watcher";
  return null;
}

async function boardOf(db: PgDatabase, boardId: string): Promise<BoardAccessRow | null> {
  const rows = rowsToObjects(
    await db.exec(`SELECT board_id, kind, owner_user_id FROM todo_boards WHERE board_id = $1`, [boardId])
  );
  if (!rows.length) return null;
  return { boardId: String(rows[0].board_id), kind: String(rows[0].kind), ownerUserId: String(rows[0].owner_user_id) };
}

/** 열람 가능 여부(규칙 1·2). 관리자 우회 없음(규칙 3). */
export async function canSeeItem(db: PgDatabase, userId: string, item: ItemAccessRow): Promise<boolean> {
  if (item.ownerUserId === userId || item.assigneeUserId === userId) return true;
  if (await itemShareRole(db, item, userId)) return true;
  const board = await boardOf(db, item.boardId);
  if (!board) return false;
  return (await boardRole(db, board, userId)) !== null;
}

/**
 * 편집 가능 여부 — owner·담당자·협업 공유·보드 admin/member. 참조자(watcher)·보드 viewer 는 댓글만.
 */
export async function canEditItem(db: PgDatabase, userId: string, item: ItemAccessRow): Promise<boolean> {
  if (item.ownerUserId === userId || item.assigneeUserId === userId) return true;
  const share = await itemShareRole(db, item, userId);
  if (share === "assignee" || share === "collaborator") return true;
  const board = await boardOf(db, item.boardId);
  if (!board) return false;
  const role = await boardRole(db, board, userId);
  return role === "admin" || role === "member";
}

/**
 * 보드 관리(이름·열·멤버·보관) 가능 여부 — owner·보드 admin. todo.admin 은 개인 보드를 제외한 보드만(§6.3 규칙 3).
 */
export async function canManageBoard(db: PgDatabase, userId: string, board: BoardAccessRow): Promise<boolean> {
  if (board.ownerUserId === userId) return true;
  if ((await boardRole(db, board, userId)) === "admin") return true;
  if (board.kind !== "personal" && (await isTodoAdmin(userId))) return true;
  return false;
}

/**
 * 가시 작업 WHERE 조각 — 보드 멤버 ∪ owner ∪ 담당자 ∪ 공유(본인 또는 부모 작업).
 * `userParam` 은 바인딩 자리(예: "$1"), alias 는 todo_items 별칭.
 */
export function visibleItemsWhere(userParam: string, alias = "i"): string {
  return `(
    ${alias}.owner_user_id = ${userParam}
    OR ${alias}.assignee_user_id = ${userParam}
    OR EXISTS (SELECT 1 FROM todo_board_members vbm WHERE vbm.board_id = ${alias}.board_id AND vbm.user_id = ${userParam})
    OR EXISTS (SELECT 1 FROM todo_item_shares vsh
                WHERE vsh.user_id = ${userParam}
                  AND (vsh.item_id = ${alias}.item_id OR vsh.item_id = ${alias}.parent_item_id))
  )`;
}

/** 가시 보드 WHERE 조각 — owner ∪ 멤버. */
export function visibleBoardsWhere(userParam: string, alias = "b"): string {
  return `(
    ${alias}.owner_user_id = ${userParam}
    OR EXISTS (SELECT 1 FROM todo_board_members vbm WHERE vbm.board_id = ${alias}.board_id AND vbm.user_id = ${userParam})
  )`;
}
