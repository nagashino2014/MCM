/*
 * 할 일 체크리스트 템플릿(286 todo_templates, docs/todo-kanban-blueprint.md §26-3).
 *   개인 템플릿(board_id NULL, 작성자만) · 보드 템플릿(보드 멤버 공용, 편집은 작성자·보드 소유자).
 *   항목: { title, stageOrder?, dueOffsetDays?, progressNote? } — 적용 시 하위 작업으로 생성(285 단계 매핑 포함).
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { createItem, getBoard, getItemDetail, listBoards } from "./store";
import type { TodoItemDetail } from "./types";

export interface TodoTemplateItem {
  title: string;
  stageOrder: number | null;
  dueOffsetDays: number | null;
  progressNote: string | null;
}

export interface TodoTemplate {
  templateId: string;
  ownerUserId: string;
  ownerName: string | null;
  boardId: string | null;
  boardName: string | null;
  name: string;
  items: TodoTemplateItem[];
  useCount: number;
  canEdit: boolean;
  createdAt: string;
  updatedAt: string;
}

const fail = (message: string, status = 400): Error => Object.assign(new Error(message), { status });
const newId = () => "tt" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const nowIso = () => new Date().toISOString();

function normalizeItems(value: unknown): TodoTemplateItem[] {
  if (!Array.isArray(value)) throw fail("항목 배열이 필요합니다.");
  const out: TodoTemplateItem[] = [];
  for (const raw of value) {
    const o = (raw && typeof raw === "object" ? raw : { title: raw }) as Record<string, unknown>;
    const title = String(o.title ?? "").trim().slice(0, 200);
    if (!title) continue;
    const so = o.stageOrder == null || o.stageOrder === "" ? null : Number(o.stageOrder);
    const dd = o.dueOffsetDays == null || o.dueOffsetDays === "" ? null : Number(o.dueOffsetDays);
    if (so != null && (!Number.isInteger(so) || so < 1)) throw fail("공정 단계 번호가 올바르지 않습니다.");
    if (dd != null && (!Number.isInteger(dd) || dd < 0 || dd > 365)) throw fail("마감 오프셋(일)은 0~365 사이 정수입니다.");
    out.push({ title, stageOrder: so, dueOffsetDays: dd, progressNote: o.progressNote != null && String(o.progressNote).trim() ? String(o.progressNote).trim().slice(0, 500) : null });
    if (out.length >= 50) break;
  }
  if (!out.length) throw fail("항목을 1개 이상 입력하세요.");
  return out;
}

function mapRow(r: Record<string, unknown>, userId: string, boardOwner: string | null): TodoTemplate {
  const owner = String(r.owner_user_id);
  let items: TodoTemplateItem[] = [];
  try {
    const raw = typeof r.items === "string" ? JSON.parse(r.items) : r.items;
    items = normalizeItems(raw);
  } catch {
    items = [];
  }
  return {
    templateId: String(r.template_id),
    ownerUserId: owner,
    ownerName: r.owner_name != null ? String(r.owner_name) : null,
    boardId: r.board_id != null ? String(r.board_id) : null,
    boardName: r.board_name != null ? String(r.board_name) : null,
    name: String(r.name),
    items,
    useCount: Number(r.use_count ?? 0),
    canEdit: owner === userId || (boardOwner != null && boardOwner === userId),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const SELECT = `SELECT t.*, u.name AS owner_name, b.name AS board_name, b.owner_user_id AS board_owner
                  FROM todo_templates t
                  LEFT JOIN users u ON u.user_id = t.owner_user_id
                  LEFT JOIN todo_boards b ON b.board_id = t.board_id`;

/** 내 개인 템플릿 + (boardId 가 있고 내가 볼 수 있는 보드면) 그 보드 템플릿. 최근 사용·수정순. */
export async function listTemplates(userId: string, boardId?: string | null): Promise<TodoTemplate[]> {
  const db = await getDb();
  let boardOk = false;
  if (boardId) {
    const boards = await listBoards(userId);
    boardOk = boards.some((b) => b.boardId === boardId && b.kind !== "personal");
  }
  const rows = rowsToObjects(
    await db.exec(
      `${SELECT}
        WHERE (t.board_id IS NULL AND t.owner_user_id = $1) ${boardOk ? "OR t.board_id = $2" : ""}
        ORDER BY t.use_count DESC, t.updated_at DESC
        LIMIT 100`,
      boardOk ? [userId, boardId] : [userId]
    )
  );
  return rows.map((r) => mapRow(r, userId, r.board_owner != null ? String(r.board_owner) : null));
}

async function loadTemplate(userId: string, templateId: string): Promise<TodoTemplate> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`${SELECT} WHERE t.template_id = $1`, [templateId]));
  if (!rows.length) throw fail("템플릿을 찾을 수 없습니다.", 404);
  const t = mapRow(rows[0], userId, rows[0].board_owner != null ? String(rows[0].board_owner) : null);
  if (t.boardId) {
    const boards = await listBoards(userId);
    if (!boards.some((b) => b.boardId === t.boardId)) throw fail("이 보드의 템플릿을 볼 수 없습니다.", 403);
  } else if (t.ownerUserId !== userId) {
    throw fail("다른 사람의 개인 템플릿입니다.", 403);
  }
  return t;
}

/** 생성 — items 직접, 또는 fromItemId 의 현재 하위 작업을 그대로 저장. */
export async function createTemplate(
  userId: string,
  input: { name?: unknown; items?: unknown; boardId?: unknown; fromItemId?: unknown }
): Promise<TodoTemplate> {
  const name = String(input.name ?? "").trim().slice(0, 80);
  if (!name) throw fail("템플릿 이름을 입력하세요.");
  let items: TodoTemplateItem[];
  if (typeof input.fromItemId === "string" && input.fromItemId) {
    const detail = await getItemDetail(userId, input.fromItemId);
    const base = detail.doDate ?? null;
    items = normalizeItems(
      detail.subtasks.map((s) => ({
        title: s.title,
        stageOrder: s.stageOrder,
        dueOffsetDays: base && s.dueDate && s.dueDate >= base ? Math.round((Date.parse(`${s.dueDate}T00:00:00Z`) - Date.parse(`${base}T00:00:00Z`)) / 86400000) : null,
        progressNote: null,
      }))
    );
  } else {
    items = normalizeItems(input.items);
  }
  const boardId = typeof input.boardId === "string" && input.boardId ? input.boardId : null;
  if (boardId) {
    const board = await getBoard(userId, boardId);
    if (board.kind === "personal") throw fail("개인 보드에는 보드 템플릿을 만들 수 없습니다(개인 템플릿으로 저장하세요).");
  }
  const id = newId();
  const now = nowIso();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO todo_templates (template_id, owner_user_id, board_id, name, items, use_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 0, $6, $6)`,
      [id, userId, boardId, name, JSON.stringify(items), now]
    );
  });
  return loadTemplate(userId, id);
}

export async function updateTemplate(userId: string, templateId: string, patch: { name?: unknown; items?: unknown }): Promise<TodoTemplate> {
  const cur = await loadTemplate(userId, templateId);
  if (!cur.canEdit) throw fail("이 템플릿을 수정할 권한이 없습니다.", 403);
  const name = patch.name !== undefined ? String(patch.name ?? "").trim().slice(0, 80) : cur.name;
  if (!name) throw fail("템플릿 이름을 입력하세요.");
  const items = patch.items !== undefined ? normalizeItems(patch.items) : cur.items;
  await withDbWrite(async (db) => {
    await db.run(`UPDATE todo_templates SET name = $2, items = $3::jsonb, updated_at = $4 WHERE template_id = $1`, [templateId, name, JSON.stringify(items), nowIso()]);
  });
  return loadTemplate(userId, templateId);
}

export async function deleteTemplate(userId: string, templateId: string): Promise<void> {
  const cur = await loadTemplate(userId, templateId);
  if (!cur.canEdit) throw fail("이 템플릿을 삭제할 권한이 없습니다.", 403);
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM todo_templates WHERE template_id = $1`, [templateId]);
  });
}

/** 템플릿 적용 — 하위 작업을 뒤에 추가. dueOffsetDays 는 상위 할 날(없으면 오늘 KST) 기준, stageOrder 는 관련 공정표에 있을 때만. */
export async function applyTemplate(userId: string, itemId: string, templateId: string): Promise<{ item: TodoItemDetail; created: number }> {
  const detail = await getItemDetail(userId, itemId);
  if (!detail.canEdit) throw fail("이 할 일을 편집할 수 없습니다.", 403);
  if (detail.parentItemId) throw fail("하위 작업에는 템플릿을 적용할 수 없습니다.");
  const tpl = await loadTemplate(userId, templateId);
  const base = detail.doDate ?? new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const stageOk = new Set(detail.stages.map((s) => s.stageOrder));
  let created = 0;
  for (const it of tpl.items) {
    const due = it.dueOffsetDays != null ? new Date(Date.parse(`${base}T12:00:00Z`) + it.dueOffsetDays * 86400000).toISOString().slice(0, 10) : null;
    await createItem(userId, {
      title: it.title,
      parentItemId: itemId,
      dueDate: due,
      stageOrder: it.stageOrder != null && stageOk.has(it.stageOrder) ? it.stageOrder : null,
      progressNote: it.progressNote,
    });
    created += 1;
  }
  await withDbWrite(async (db) => {
    await db.run(`UPDATE todo_templates SET use_count = use_count + 1, updated_at = updated_at WHERE template_id = $1`, [templateId]);
    await db.run(
      `INSERT INTO todo_activity (activity_id, item_id, user_id, action, detail, created_at) VALUES ($1, $2, $3, 'update', $4::jsonb, $5)`,
      ["ta" + crypto.randomUUID().replace(/-/g, "").slice(0, 16), itemId, userId, JSON.stringify({ template: tpl.name, created }), nowIso()]
    );
  });
  return { item: await getItemDetail(userId, itemId), created };
}
