/*
 * To-do · Kanban 저장소(마이그 274) — 보드·열·작업·하위 작업·공유·댓글·활동 로그·설정.
 * 설계: docs/todo-kanban-blueprint.md §6·§9·§10·§15. 모든 조회는 lib/todo/visibility.ts 를 거친다.
 * 쓰기 응답은 갱신된 항목을 돌려준다({ item }). 푸시는 커밋 후 fire-and-forget(lib/todo/notify.ts).
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { postTextMessage } from "@/lib/chat/queries";
import { FIRST_POSITION, between, isValidPosition } from "./position";
import { isValidRecurrence, nextOccurrence } from "./recurrence";
import {
  DEFAULT_TODO_PREFS,
  TODO_ARCHIVE_AFTER_DAYS,
  TODO_BOARD_KINDS,
  TODO_BOARD_LAYOUTS,
  TODO_BOARD_MODES,
  TODO_LINK_KINDS,
  TODO_MEMBER_ROLES,
  TODO_SHARE_ROLES,
  TODO_SNOOZE_PRESETS,
  TODO_STATUSES,
  isTodoBoardColorKey,
  pickBoardColorKey,
  todoBoardColorHex,
  todoItemLink,
  type TodoActivity,
  type TodoActivityAction,
  type TodoBoard,
  type TodoBoardColorKey,
  type TodoBoardKind,
  type TodoBoardMember,
  type TodoBoardMode,
  type TodoColumn,
  type TodoComment,
  type TodoContractCandidate,
  type TodoItem,
  type TodoItemDetail,
  type TodoLinkKind,
  type TodoMemberRole,
  type TodoPrefs,
  type TodoPriority,
  type TodoShare,
  type TodoShareRole,
  type TodoStatus,
} from "./types";
import { loadPhotoUrls, photoOf, type TodoPhotoMap } from "./photo";
import {
  boardRole,
  canCreateDeptBoard,
  canEditItem,
  canManageBoard,
  canSeeItem,
  isTodoAdmin,
  visibleBoardsWhere,
  visibleItemsWhere,
  type BoardAccessRow,
  type ItemAccessRow,
} from "./visibility";
import { notifyTodoAssigned, notifyTodoComment, notifyTodoStatus } from "./notify";

const nowIso = () => new Date().toISOString();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const newId = (prefix: string) => prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

const str = (v: unknown, max: number): string | null => {
  if (v == null) return null;
  const s = String(v).trim().slice(0, max);
  return s ? s : null;
};
const asBool = (v: unknown): boolean => v === true || v === 1 || v === "1" || v === "true";

/** KST 오늘 YYYY-MM-DD(서버 UTC + 9h). */
export const kstToday = (): string => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const kstIso = (date: string, time: string): string => new Date(`${date}T${time}:00+09:00`).toISOString();
const addDaysYmd = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ── 사용자 설정 ──
function mapPrefs(userId: string, r: Record<string, unknown> | undefined): TodoPrefs {
  if (!r) return { userId, ...DEFAULT_TODO_PREFS };
  return {
    userId,
    defaultRemindAllDayTime: String(r.default_remind_all_day_time ?? DEFAULT_TODO_PREFS.defaultRemindAllDayTime),
    defaultRemindBeforeMin: Number(r.default_remind_before_min ?? DEFAULT_TODO_PREFS.defaultRemindBeforeMin),
    digestTime: r.digest_time != null ? String(r.digest_time) : null,
    eveningReviewTime: r.evening_review_time != null ? String(r.evening_review_time) : null,
    quickAddParse: Number(r.quick_add_parse ?? 1) === 1,
    weekStart: Number(r.week_start ?? 1) === 0 ? 0 : 1,
    cardDensity: r.card_density === "compact" ? "compact" : "comfortable",
    showDoneDays: Number(r.show_done_days ?? 7),
    showApprovalEvents: Number(r.show_approval_events ?? 1) === 1,
  };
}

export async function getPrefs(userId: string, db?: PgDatabase): Promise<TodoPrefs> {
  const conn = db ?? (await getDb());
  const rows = rowsToObjects(await conn.exec(`SELECT * FROM todo_user_prefs WHERE user_id = $1`, [userId]));
  return mapPrefs(userId, rows[0]);
}

export async function updatePrefs(userId: string, patch: Record<string, unknown>): Promise<TodoPrefs> {
  const cur = await getPrefs(userId);
  const next: TodoPrefs = { ...cur };
  if (patch.defaultRemindAllDayTime !== undefined) {
    const t = str(patch.defaultRemindAllDayTime, 5);
    if (!t || !TIME_RE.test(t)) throw fail("종일 알림 시각은 HH:mm 으로 입력하세요.");
    next.defaultRemindAllDayTime = t;
  }
  if (patch.defaultRemindBeforeMin !== undefined) {
    const n = Number(patch.defaultRemindBeforeMin);
    if (!Number.isInteger(n) || n < 0 || n > 24 * 60) throw fail("알림 분 값이 올바르지 않습니다.");
    next.defaultRemindBeforeMin = n;
  }
  if (patch.digestTime !== undefined) {
    const t = patch.digestTime == null || patch.digestTime === "" ? null : str(patch.digestTime, 5);
    if (t && !TIME_RE.test(t)) throw fail("아침 요약 시각은 HH:mm 으로 입력하세요.");
    next.digestTime = t;
  }
  if (patch.eveningReviewTime !== undefined) {
    const t = patch.eveningReviewTime == null || patch.eveningReviewTime === "" ? null : str(patch.eveningReviewTime, 5);
    if (t && !TIME_RE.test(t)) throw fail("저녁 리뷰 시각은 HH:mm 으로 입력하세요.");
    next.eveningReviewTime = t;
  }
  if (patch.quickAddParse !== undefined) next.quickAddParse = asBool(patch.quickAddParse);
  if (patch.weekStart !== undefined) next.weekStart = Number(patch.weekStart) === 0 ? 0 : 1;
  if (patch.cardDensity !== undefined) next.cardDensity = patch.cardDensity === "compact" ? "compact" : "comfortable";
  if (patch.showDoneDays !== undefined) {
    const n = Number(patch.showDoneDays);
    if (!Number.isInteger(n) || n < 0 || n > 90) throw fail("완료 표시 일수는 0~90 사이로 입력하세요.");
    next.showDoneDays = n;
  }
  if (patch.showApprovalEvents !== undefined) next.showApprovalEvents = asBool(patch.showApprovalEvents);
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO todo_user_prefs
         (user_id, default_remind_all_day_time, default_remind_before_min, digest_time, evening_review_time,
          quick_add_parse, week_start, card_density, show_done_days, show_approval_events, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (user_id) DO UPDATE SET
         default_remind_all_day_time = EXCLUDED.default_remind_all_day_time,
         default_remind_before_min = EXCLUDED.default_remind_before_min,
         digest_time = EXCLUDED.digest_time,
         evening_review_time = EXCLUDED.evening_review_time,
         quick_add_parse = EXCLUDED.quick_add_parse,
         week_start = EXCLUDED.week_start,
         card_density = EXCLUDED.card_density,
         show_done_days = EXCLUDED.show_done_days,
         show_approval_events = EXCLUDED.show_approval_events,
         updated_at = EXCLUDED.updated_at`,
      [
        userId,
        next.defaultRemindAllDayTime,
        next.defaultRemindBeforeMin,
        next.digestTime,
        next.eveningReviewTime,
        next.quickAddParse ? 1 : 0,
        next.weekStart,
        next.cardDensity,
        next.showDoneDays,
        next.showApprovalEvents ? 1 : 0,
        nowIso(),
      ]
    );
  });
  return next;
}

// ── 알림 시각(§9) ──
/**
 * 기본 remind_at — 시간 있음 → do_time 의 N분 전, 종일 → do_date(없으면 due_date) 의 기본 시각(KST).
 * 하나의 remind_at 만 두므로 do·due 가 둘 다 있으면 do 를 우선한다(due 는 do 보다 뒤가 보통).
 */
export function computeRemindAt(
  item: { doDate: string | null; doTime: string | null; dueDate: string | null },
  prefs: Pick<TodoPrefs, "defaultRemindAllDayTime" | "defaultRemindBeforeMin">
): string | null {
  if (item.doDate && item.doTime) {
    const at = new Date(kstIso(item.doDate, item.doTime));
    at.setUTCMinutes(at.getUTCMinutes() - prefs.defaultRemindBeforeMin);
    return at.toISOString();
  }
  if (item.doDate) return kstIso(item.doDate, prefs.defaultRemindAllDayTime);
  if (item.dueDate) return kstIso(item.dueDate, prefs.defaultRemindAllDayTime);
  return null;
}

// ── 보드 ──
interface DefaultColumnSpec {
  name: string;
  status: TodoStatus | null;
  collapsed?: boolean;
}
/** 개인 기본 보드(§6.2) — 할 일·진행 중·완료. */
const PERSONAL_COLUMNS: DefaultColumnSpec[] = [
  { name: "할 일", status: "todo" },
  { name: "진행 중", status: "doing" },
  { name: "완료", status: "done" },
];
/** 프로젝트·부서·공유 보드(§19-10) — 할 일·진행 중·검토·확인 대기(매핑 없음) + 완료·보류는 접힌 행. */
const TEAM_COLUMNS: DefaultColumnSpec[] = [
  { name: "할 일", status: "todo" },
  { name: "진행 중", status: "doing" },
  { name: "검토", status: "review" },
  { name: "확인 대기", status: null },
  { name: "완료", status: "done", collapsed: true },
  { name: "보류", status: "hold", collapsed: true },
];

interface InsertBoardInput {
  name: string;
  kind: TodoBoardKind;
  scopeRef: string | null;
  isDefault: boolean;
  layout: "list" | "board";
  columnStatusMap: boolean;
  projectName?: string | null;
  clientName?: string | null;
  contractId?: string | null;
  facilityId?: string | null;
  color?: TodoBoardColorKey | null;
  columns?: DefaultColumnSpec[];
}

async function insertBoard(db: PgDatabase, userId: string, input: InsertBoardInput): Promise<string> {
  const boardId = newId("tb_");
  const now = nowIso();
  await db.run(
    `INSERT INTO todo_boards
       (board_id, name, kind, owner_user_id, scope_ref, is_default, layout, column_status_map,
        project_name, client_name, contract_id, facility_id, color,
        created_at, created_by, updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$4,$14,$4)`,
    [
      boardId,
      input.name,
      input.kind,
      userId,
      input.scopeRef,
      input.isDefault ? 1 : 0,
      input.layout,
      input.columnStatusMap ? 1 : 0,
      input.projectName ?? null,
      input.clientName ?? null,
      input.contractId ?? null,
      input.facilityId ?? null,
      input.color ?? null,
      now,
    ]
  );
  let pos: string | null = null;
  for (const c of input.columns ?? PERSONAL_COLUMNS) {
    pos = between(pos, null);
    await db.run(
      `INSERT INTO todo_columns (column_id, board_id, name, position, status_map, collapsed, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
      [newId("tc_"), boardId, c.name, pos, c.status, c.collapsed ? 1 : 0, now]
    );
  }
  return boardId;
}

/** 계약관리 용역 요약(createBoard contract 모드·updateBoard contractId 검증). */
interface ContractBrief {
  contractId: string;
  title: string;
  counterpartyName: string | null;
  facilityId: string | null;
}

async function loadContractBrief(db: PgDatabase, contractId: string): Promise<ContractBrief | null> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id, c.contract_title, cp.company_name AS counterparty_name, c.facility_id
         FROM contracts c
         LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
        WHERE c.contract_id = $1 AND c.deleted_at IS NULL`,
      [contractId]
    )
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    contractId: String(r.contract_id),
    title: String(r.contract_title ?? ""),
    counterpartyName: r.counterparty_name != null ? String(r.counterparty_name) : null,
    facilityId: r.facility_id != null ? String(r.facility_id) : null,
  };
}

/** 계약 수행인력(service_participants) → users.user_id(연결된 활성 직원만, 종료자 제외). */
async function loadContractParticipantUserIds(db: PgDatabase, contractId: string): Promise<string[]> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT p.user_id
         FROM service_participants sp
         JOIN employee_profiles p ON p.employee_id = sp.employee_id
         JOIN users u ON u.user_id = p.user_id
        WHERE sp.contract_id = $1
          AND (sp.participated_to IS NULL OR sp.participated_to = '')
          AND p.user_id IS NOT NULL AND p.status = 'active' AND u.status = 'active'`,
      [contractId]
    )
  );
  return rows.map((r) => String(r.user_id));
}

async function assertFacilityExists(db: PgDatabase, facilityId: string): Promise<void> {
  const rows = rowsToObjects(await db.exec(`SELECT 1 FROM facilities WHERE facility_id = $1`, [facilityId]));
  if (!rows.length) throw fail("사업장을 찾을 수 없습니다.", 404);
}

function parseBoardColor(v: unknown): TodoBoardColorKey | null {
  if (v == null || v === "") return null;
  if (!isTodoBoardColorKey(v)) throw fail("보드 색은 팔레트 키(lavender·mint·rose·lemon·sky·peach·sage·gray)로 지정하세요.");
  return v;
}

/** 개인 기본 보드 — 없으면 만든다(열: 할 일·진행 중·완료, 상태 매핑 on). */
export async function ensureDefaultBoard(userId: string): Promise<string> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT board_id FROM todo_boards WHERE owner_user_id = $1 AND is_default = 1`, [userId])
  );
  if (rows.length) return String(rows[0].board_id);
  return withDbWrite(async (tx) => {
    // 동시 첫 접근 보호 — unique partial index 가 2중 생성을 막고, 여기서는 재조회로 흡수.
    await tx.run(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`todo-default:${userId}`]);
    const again = rowsToObjects(
      await tx.exec(`SELECT board_id FROM todo_boards WHERE owner_user_id = $1 AND is_default = 1`, [userId])
    );
    if (again.length) return String(again[0].board_id);
    return insertBoard(tx, userId, { name: "내 할 일", kind: "personal", scopeRef: null, isDefault: true, layout: "board", columnStatusMap: true });
  });
}

function mapColumn(r: Record<string, unknown>): TodoColumn {
  return {
    columnId: String(r.column_id),
    boardId: String(r.board_id),
    name: String(r.name ?? ""),
    position: String(r.position ?? FIRST_POSITION),
    statusMap: r.status_map != null && (TODO_STATUSES as readonly string[]).includes(String(r.status_map)) ? (String(r.status_map) as TodoStatus) : null,
    wipLimit: r.wip_limit != null ? Number(r.wip_limit) : null,
    collapsed: Number(r.collapsed ?? 0) === 1,
  };
}

async function loadColumns(db: PgDatabase, boardIds: string[]): Promise<Map<string, TodoColumn[]>> {
  const map = new Map<string, TodoColumn[]>();
  if (!boardIds.length) return map;
  const rows = rowsToObjects(
    await db.exec(`SELECT * FROM todo_columns WHERE board_id = ANY($1::text[]) ORDER BY board_id, position COLLATE "C"`, [boardIds])
  );
  for (const r of rows) {
    const c = mapColumn(r);
    const list = map.get(c.boardId) ?? [];
    list.push(c);
    map.set(c.boardId, list);
  }
  return map;
}

function mapBoard(r: Record<string, unknown>, columns: TodoColumn[], myRole: TodoMemberRole): TodoBoard {
  const kind = (TODO_BOARD_KINDS as readonly string[]).includes(String(r.kind)) ? (String(r.kind) as TodoBoardKind) : "personal";
  const color = isTodoBoardColorKey(r.color) ? r.color : null;
  return {
    boardId: String(r.board_id),
    name: String(r.name ?? ""),
    kind,
    ownerUserId: String(r.owner_user_id),
    scopeRef: r.scope_ref != null ? String(r.scope_ref) : null,
    isDefault: Number(r.is_default ?? 0) === 1,
    layout: r.layout === "list" ? "list" : "board",
    columnStatusMap: Number(r.column_status_map ?? 1) === 1,
    projectName: r.project_name != null ? String(r.project_name) : null,
    clientName: r.client_name != null ? String(r.client_name) : null,
    contractId: r.contract_id != null ? String(r.contract_id) : null,
    facilityId: r.facility_id != null ? String(r.facility_id) : null,
    color,
    colorHex: todoBoardColorHex(color, kind),
    archivedAt: r.archived_at != null ? String(r.archived_at) : null,
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    columns,
    myRole,
    memberCount: Number(r.member_count ?? 0),
  };
}

const BOARD_SELECT = (userParam: string) => `
  SELECT b.*,
         (SELECT COUNT(*)::int FROM todo_board_members m WHERE m.board_id = b.board_id) AS member_count,
         (SELECT m.role FROM todo_board_members m WHERE m.board_id = b.board_id AND m.user_id = ${userParam}) AS my_member_role
    FROM todo_boards b`;

const roleFromRow = (r: Record<string, unknown>, userId: string): TodoMemberRole => {
  if (String(r.owner_user_id) === userId) return "admin";
  const v = String(r.my_member_role ?? "");
  return v === "admin" || v === "member" || v === "viewer" ? v : "viewer";
};

/** 내 보드 목록(owner ∪ 멤버, 보관 제외). 개인 기본 보드는 없으면 만든다. */
export async function listBoards(userId: string, opts: { includeArchived?: boolean } = {}): Promise<TodoBoard[]> {
  await ensureDefaultBoard(userId);
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `${BOARD_SELECT("$1")}
        WHERE ${visibleBoardsWhere("$1")} ${opts.includeArchived ? "" : "AND b.archived_at IS NULL"}
        ORDER BY b.is_default DESC, b.kind, b.created_at`,
      [userId]
    )
  );
  const columns = await loadColumns(db, rows.map((r) => String(r.board_id)));
  return rows.map((r) => mapBoard(r, columns.get(String(r.board_id)) ?? [], roleFromRow(r, userId)));
}

/** 관리자용 전사 보드 목록(개인 보드 제외) — todo.admin. */
export async function listAllBoardsForAdmin(userId: string): Promise<TodoBoard[]> {
  if (!(await isTodoAdmin(userId))) throw fail("보드 관리 권한이 없습니다.", 403);
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`${BOARD_SELECT("$1")} WHERE b.kind <> 'personal' ORDER BY b.kind, b.created_at`, [userId])
  );
  const columns = await loadColumns(db, rows.map((r) => String(r.board_id)));
  return rows.map((r) => mapBoard(r, columns.get(String(r.board_id)) ?? [], roleFromRow(r, userId)));
}

async function loadBoardAccess(db: PgDatabase, boardId: string): Promise<BoardAccessRow & { row: Record<string, unknown> }> {
  const rows = rowsToObjects(await db.exec(`SELECT * FROM todo_boards WHERE board_id = $1`, [boardId]));
  if (!rows.length) throw fail("보드를 찾을 수 없습니다.", 404);
  const r = rows[0];
  return { boardId: String(r.board_id), kind: String(r.kind), ownerUserId: String(r.owner_user_id), row: r };
}

export async function getBoard(userId: string, boardId: string): Promise<TodoBoard> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`${BOARD_SELECT("$2")} WHERE b.board_id = $1`, [boardId, userId]));
  if (!rows.length) throw fail("보드를 찾을 수 없습니다.", 404);
  const r = rows[0];
  const access: BoardAccessRow = { boardId, kind: String(r.kind), ownerUserId: String(r.owner_user_id) };
  const role = await boardRole(db, access, userId);
  if (!role && !(access.kind !== "personal" && (await isTodoAdmin(userId)))) throw fail("이 보드를 볼 수 없습니다.", 403);
  const columns = await loadColumns(db, [boardId]);
  return mapBoard(r, columns.get(boardId) ?? [], role ?? "viewer");
}

/**
 * 보드 생성(§19-11). kind=project 는 mode 로 3방식 —
 *   contract: contracts 에서 용역명·발주처(계약상대 업체)·사업장을 읽고 수행인력(service_participants)을 멤버로 자동 추가
 *   manual:   projectName 필수·clientName 선택(사업장 마스터 불필요)
 *   internal: 자체 수행 — clientName NULL
 * color 미지정 시 내 보드(개인 제외)가 쓰는 색을 보고 팔레트(gray 제외)를 순환 배정, internal 은 gray.
 * 입력 타입: lib/todo/types.ts TodoBoardCreateInput.
 */
export async function createBoard(userId: string, input: Record<string, unknown>): Promise<TodoBoard> {
  const kind = (TODO_BOARD_KINDS as readonly string[]).includes(String(input.kind)) ? (String(input.kind) as TodoBoardKind) : "shared";
  if (kind === "personal") throw fail("개인 보드는 자동으로 만들어집니다.");
  if (kind === "dept" && !(await canCreateDeptBoard(userId))) throw fail("부서 보드는 부서장·임원·관리자만 만들 수 있습니다.", 403);
  const layout = (TODO_BOARD_LAYOUTS as readonly string[]).includes(String(input.layout)) ? (String(input.layout) as "list" | "board") : "board";
  const scopeRef = str(input.scopeRef, 80);
  const columnStatusMap = input.columnStatusMap === undefined ? true : asBool(input.columnStatusMap);
  const memberIds = Array.isArray(input.memberIds) ? [...new Set(input.memberIds.map((v) => String(v)).filter((v) => v && v !== userId))] : [];
  const mode: TodoBoardMode | null =
    kind === "project" ? ((TODO_BOARD_MODES as readonly string[]).includes(String(input.mode)) ? (String(input.mode) as TodoBoardMode) : "manual") : null;
  let name = str(input.name, 80);
  let projectName = str(input.projectName, 120);
  let clientName = str(input.clientName, 120);
  let contractId = str(input.contractId, 40);
  let facilityId = str(input.facilityId, 40);
  const explicitColor = parseBoardColor(input.color);

  if (kind !== "project") {
    // 부서·공유 보드 — 이름 필수, 계약 연결 없음(용역명·발주처 메모는 선택).
    if (!name) throw fail("보드 이름을 입력하세요.");
    contractId = null;
  } else if (mode === "manual") {
    if (!projectName) throw fail("프로젝트명을 입력하세요.");
    contractId = null;
  } else if (mode === "internal") {
    if (!projectName) projectName = name;
    if (!projectName) throw fail("프로젝트명을 입력하세요.");
    clientName = null;
    contractId = null;
  } else if (mode === "contract") {
    if (!contractId) throw fail("계약관리에서 용역을 선택하세요.");
  }

  const boardId = await withDbWrite(async (db) => {
    if (contractId) {
      const brief = await loadContractBrief(db, contractId);
      if (!brief) throw fail("계약을 찾을 수 없습니다.", 404);
      projectName = projectName ?? (brief.title || null);
      clientName = clientName ?? brief.counterpartyName;
      facilityId = facilityId ?? brief.facilityId;
      for (const uid of await loadContractParticipantUserIds(db, contractId)) {
        if (uid !== userId && !memberIds.includes(uid)) memberIds.push(uid);
      }
    }
    if (facilityId) await assertFacilityExists(db, facilityId);
    if (kind === "project" && !projectName) throw fail("프로젝트명을 입력하세요.");
    if (!name) name = projectName;
    if (!name) throw fail("보드 이름을 입력하세요.");
    let color = explicitColor;
    if (!color) {
      if (mode === "internal") color = "gray";
      else {
        const used = rowsToObjects(
          await db.exec(`SELECT color FROM todo_boards WHERE kind <> 'personal' AND archived_at IS NULL AND ${visibleBoardsWhere("$1")}`, [userId])
        ).map((r) => (r.color != null ? String(r.color) : null));
        color = pickBoardColorKey(used);
      }
    }
    const id = await insertBoard(db, userId, {
      name,
      kind,
      scopeRef,
      isDefault: false,
      layout,
      columnStatusMap,
      projectName,
      clientName,
      contractId,
      facilityId,
      color,
      columns: TEAM_COLUMNS,
    });
    // 부서 보드 — 부서원 자동 member(§10). 만든 사람의 부서 기준.
    if (kind === "dept") {
      const deptId =
        scopeRef ??
        (rowsToObjects(await db.exec(`SELECT dept_id FROM users WHERE user_id = $1`, [userId]))[0]?.dept_id as string | null | undefined) ??
        null;
      if (deptId) {
        const deptUsers = rowsToObjects(
          await db.exec(
            `SELECT DISTINCT u.user_id FROM users u
              WHERE u.status = 'active' AND u.user_id <> $2
                AND (u.dept_id = $1 OR EXISTS (SELECT 1 FROM employee_profiles p WHERE p.user_id = u.user_id AND p.dept_id = $1 AND p.status = 'active'))`,
            [deptId, userId]
          )
        );
        for (const r of deptUsers) if (!memberIds.includes(String(r.user_id))) memberIds.push(String(r.user_id));
        if (!scopeRef) await db.run(`UPDATE todo_boards SET scope_ref = $2 WHERE board_id = $1`, [id, deptId]);
      }
    }
    const now = nowIso();
    for (const uid of memberIds) {
      await db.run(
        `INSERT INTO todo_board_members (board_id, user_id, role, added_by, created_at) VALUES ($1,$2,'member',$3,$4)
         ON CONFLICT (board_id, user_id) DO NOTHING`,
        [id, uid, userId, now]
      );
    }
    return id;
  });
  return getBoard(userId, boardId);
}

export async function updateBoard(userId: string, boardId: string, patch: Record<string, unknown>): Promise<TodoBoard> {
  await withDbWrite(async (db) => {
    const b = await loadBoardAccess(db, boardId);
    if (!(await canManageBoard(db, userId, b))) throw fail("보드를 수정할 권한이 없습니다.", 403);
    const sets: string[] = [];
    const vals: unknown[] = [boardId];
    const push = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (patch.name !== undefined) {
      const name = str(patch.name, 80);
      if (!name) throw fail("보드 이름을 입력하세요.");
      push("name", name);
    }
    if (patch.layout !== undefined) {
      if (!(TODO_BOARD_LAYOUTS as readonly string[]).includes(String(patch.layout))) throw fail("레이아웃 값이 올바르지 않습니다.");
      push("layout", String(patch.layout));
    }
    if (patch.columnStatusMap !== undefined) push("column_status_map", asBool(patch.columnStatusMap) ? 1 : 0);
    if (patch.archived !== undefined) {
      if (Number(b.row.is_default) === 1 && asBool(patch.archived)) throw fail("개인 기본 보드는 보관할 수 없습니다.");
      push("archived_at", asBool(patch.archived) ? nowIso() : null);
    }
    // ── 프로젝트(용역) 속성(§19-11) ──
    if (patch.projectName !== undefined) {
      const v = str(patch.projectName, 120);
      if (!v && b.kind === "project") throw fail("프로젝트명을 입력하세요.");
      push("project_name", v);
    }
    if (patch.clientName !== undefined) push("client_name", str(patch.clientName, 120));
    if (patch.contractId !== undefined) {
      const v = str(patch.contractId, 40);
      if (v) {
        const brief = await loadContractBrief(db, v);
        if (!brief) throw fail("계약을 찾을 수 없습니다.", 404);
        // 계약을 새로 연결하면서 용역명·발주처가 비어 있으면 계약 값으로 채운다.
        if (patch.projectName === undefined && b.row.project_name == null) push("project_name", brief.title || null);
        if (patch.clientName === undefined && b.row.client_name == null) push("client_name", brief.counterpartyName);
        if (patch.facilityId === undefined && b.row.facility_id == null && brief.facilityId) push("facility_id", brief.facilityId);
      }
      push("contract_id", v);
    }
    if (patch.facilityId !== undefined) {
      const v = str(patch.facilityId, 40);
      if (v) await assertFacilityExists(db, v);
      push("facility_id", v);
    }
    if (patch.color !== undefined) push("color", parseBoardColor(patch.color));
    if (!sets.length) return;
    push("updated_at", nowIso());
    push("updated_by", userId);
    await db.run(`UPDATE todo_boards SET ${sets.join(", ")} WHERE board_id = $1`, vals);
  });
  return getBoard(userId, boardId);
}

export interface ContractCandidateQuery {
  q: string | null;
  /** RBAC 가시 범위(contract.view) — null = 전사. participantOnly 와 함께 쓰이면 합집합. */
  contractIds: string[] | null;
  /** contract.view 가 없는 사용자 — 본인이 수행인력인 계약만. */
  participantOnly: boolean;
  limit?: number;
}

/**
 * 프로젝트 보드 만들기(계약 선택) 검색(§19-11a) — 계약 id·용역명·발주처·사업장·상태·수행 여부 + 기존 보드.
 * 권한 판정(contract.view → resolveVisibleContractIds)은 라우트가 한다.
 */
export async function listContractCandidates(userId: string, q: ContractCandidateQuery): Promise<TodoContractCandidate[]> {
  const db = await getDb();
  const vals: unknown[] = [userId];
  const where: string[] = ["c.deleted_at IS NULL"];
  const participantSql = `EXISTS (
      SELECT 1 FROM service_participants sp JOIN employee_profiles p ON p.employee_id = sp.employee_id
       WHERE sp.contract_id = c.contract_id AND p.user_id = $1)`;
  if (q.participantOnly) {
    where.push(participantSql);
  } else if (q.contractIds) {
    vals.push(q.contractIds);
    where.push(`(c.contract_id = ANY($${vals.length}::text[]) OR ${participantSql})`);
  }
  const term = str(q.q, 80);
  if (term) {
    vals.push(`%${term}%`);
    where.push(
      `(c.contract_title ILIKE $${vals.length} OR cp.company_name ILIKE $${vals.length} OR f.company_name ILIKE $${vals.length} OR c.contract_id ILIKE $${vals.length})`
    );
  }
  const limit = Math.min(200, Math.max(1, q.limit ?? 50));
  vals.push(limit);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id, c.contract_title, c.counterparty_facility_id, cp.company_name AS counterparty_name,
              c.facility_id, f.company_name AS facility_name, c.service_type, c.service_subtype, c.contract_status,
              c.contract_date, c.started_at, c.ended_at,
              ${participantSql} AS is_participant,
              (SELECT tb.board_id FROM todo_boards tb
                WHERE tb.contract_id = c.contract_id AND tb.archived_at IS NULL AND ${visibleBoardsWhere("$1", "tb")}
                ORDER BY tb.created_at LIMIT 1) AS existing_board_id
         FROM contracts c
         LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
         LEFT JOIN facilities f ON f.facility_id = c.facility_id
        WHERE ${where.join(" AND ")}
        ORDER BY (c.contract_status = 'active') DESC, COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at) DESC NULLS LAST, c.contract_title
        LIMIT $${vals.length}`,
      vals
    )
  );
  return rows.map((r) => ({
    contractId: String(r.contract_id),
    contractTitle: String(r.contract_title ?? ""),
    counterpartyFacilityId: r.counterparty_facility_id != null ? String(r.counterparty_facility_id) : null,
    counterpartyName: String(r.counterparty_name ?? ""),
    facilityId: r.facility_id != null ? String(r.facility_id) : null,
    facilityName: r.facility_name != null ? String(r.facility_name) : null,
    serviceType: r.service_type != null ? String(r.service_type) : null,
    serviceSubtype: r.service_subtype != null ? String(r.service_subtype) : null,
    contractStatus: String(r.contract_status ?? "active"),
    contractDate: r.contract_date != null ? String(r.contract_date) : null,
    startedAt: r.started_at != null ? String(r.started_at) : null,
    endedAt: r.ended_at != null ? String(r.ended_at) : null,
    isParticipant: r.is_participant === true || r.is_participant === 1,
    existingBoardId: r.existing_board_id != null ? String(r.existing_board_id) : null,
  }));
}

/** 삭제는 owner 만, 개인 기본 보드 불가. 작업·열·멤버는 CASCADE. */
export async function deleteBoard(userId: string, boardId: string): Promise<void> {
  await withDbWrite(async (db) => {
    const b = await loadBoardAccess(db, boardId);
    if (b.ownerUserId !== userId) throw fail("보드 삭제는 만든 사람만 할 수 있습니다.", 403);
    if (Number(b.row.is_default) === 1) throw fail("개인 기본 보드는 삭제할 수 없습니다.");
    await db.run(`DELETE FROM todo_boards WHERE board_id = $1`, [boardId]);
  });
}

// ── 열 ──
async function requireManage(db: PgDatabase, userId: string, boardId: string): Promise<BoardAccessRow> {
  const b = await loadBoardAccess(db, boardId);
  if (!(await canManageBoard(db, userId, b))) throw fail("보드를 수정할 권한이 없습니다.", 403);
  return b;
}

async function columnPositions(db: PgDatabase, boardId: string): Promise<{ columnId: string; position: string }[]> {
  return rowsToObjects(
    await db.exec(`SELECT column_id, position FROM todo_columns WHERE board_id = $1 ORDER BY position COLLATE "C"`, [boardId])
  ).map((r) => ({ columnId: String(r.column_id), position: String(r.position) }));
}

/** 이웃 id 로 새 position 계산(afterId 뒤 / beforeId 앞 / 없으면 맨 뒤). */
function positionBetweenNeighbors(
  sorted: { id: string; position: string }[],
  opts: { afterId?: string | null; beforeId?: string | null; excludeId?: string | null }
): string {
  const list = sorted.filter((x) => x.id !== opts.excludeId);
  if (opts.afterId) {
    const i = list.findIndex((x) => x.id === opts.afterId);
    if (i < 0) throw fail("기준 항목을 찾을 수 없습니다.", 404);
    return between(list[i].position, list[i + 1]?.position ?? null);
  }
  if (opts.beforeId) {
    const i = list.findIndex((x) => x.id === opts.beforeId);
    if (i < 0) throw fail("기준 항목을 찾을 수 없습니다.", 404);
    return between(list[i - 1]?.position ?? null, list[i].position);
  }
  return between(list.length ? list[list.length - 1].position : null, null);
}

function parseStatusMap(v: unknown): TodoStatus | null {
  if (v == null || v === "") return null;
  if (!(TODO_STATUSES as readonly string[]).includes(String(v))) throw fail("상태 매핑 값이 올바르지 않습니다.");
  return String(v) as TodoStatus;
}

export async function addColumn(userId: string, boardId: string, input: Record<string, unknown>): Promise<TodoBoard> {
  await withDbWrite(async (db) => {
    await requireManage(db, userId, boardId);
    const name = str(input.name, 40);
    if (!name) throw fail("열 이름을 입력하세요.");
    const cols = (await columnPositions(db, boardId)).map((c) => ({ id: c.columnId, position: c.position }));
    const position = positionBetweenNeighbors(cols, { afterId: str(input.afterColumnId, 40), beforeId: str(input.beforeColumnId, 40) });
    const wip = input.wipLimit == null || input.wipLimit === "" ? null : Number(input.wipLimit);
    if (wip != null && (!Number.isInteger(wip) || wip < 1)) throw fail("WIP 제한은 1 이상의 정수여야 합니다.");
    const now = nowIso();
    await db.run(
      `INSERT INTO todo_columns (column_id, board_id, name, position, status_map, wip_limit, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
      [newId("tc_"), boardId, name, position, parseStatusMap(input.statusMap), wip, now]
    );
  });
  return getBoard(userId, boardId);
}

export async function updateColumn(userId: string, boardId: string, columnId: string, patch: Record<string, unknown>): Promise<TodoBoard> {
  await withDbWrite(async (db) => {
    await requireManage(db, userId, boardId);
    const cur = rowsToObjects(await db.exec(`SELECT * FROM todo_columns WHERE board_id = $1 AND column_id = $2`, [boardId, columnId]))[0];
    if (!cur) throw fail("열을 찾을 수 없습니다.", 404);
    const sets: string[] = [];
    const vals: unknown[] = [columnId];
    const push = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (patch.name !== undefined) {
      const name = str(patch.name, 40);
      if (!name) throw fail("열 이름을 입력하세요.");
      push("name", name);
    }
    if (patch.statusMap !== undefined) push("status_map", parseStatusMap(patch.statusMap));
    if (patch.wipLimit !== undefined) {
      const wip = patch.wipLimit == null || patch.wipLimit === "" ? null : Number(patch.wipLimit);
      if (wip != null && (!Number.isInteger(wip) || wip < 1)) throw fail("WIP 제한은 1 이상의 정수여야 합니다.");
      push("wip_limit", wip);
    }
    if (patch.collapsed !== undefined) push("collapsed", asBool(patch.collapsed) ? 1 : 0);
    if (patch.afterColumnId !== undefined || patch.beforeColumnId !== undefined) {
      const cols = (await columnPositions(db, boardId)).map((c) => ({ id: c.columnId, position: c.position }));
      push(
        "position",
        positionBetweenNeighbors(cols, { afterId: str(patch.afterColumnId, 40), beforeId: str(patch.beforeColumnId, 40), excludeId: columnId })
      );
    }
    if (!sets.length) return;
    push("updated_at", nowIso());
    await db.run(`UPDATE todo_columns SET ${sets.join(", ")} WHERE column_id = $1`, vals);
  });
  return getBoard(userId, boardId);
}

/** 열 삭제 — 그 열의 작업은 열 미배정(NULL)으로 남는다(작업 삭제 없음). */
export async function deleteColumn(userId: string, boardId: string, columnId: string): Promise<TodoBoard> {
  await withDbWrite(async (db) => {
    await requireManage(db, userId, boardId);
    await db.run(`UPDATE todo_items SET column_id = NULL WHERE board_id = $1 AND column_id = $2`, [boardId, columnId]);
    await db.run(`DELETE FROM todo_columns WHERE board_id = $1 AND column_id = $2`, [boardId, columnId]);
  });
  return getBoard(userId, boardId);
}

// ── 멤버 ──
export async function listMembers(userId: string, boardId: string): Promise<TodoBoardMember[]> {
  const db = await getDb();
  const b = await loadBoardAccess(db, boardId);
  const role = await boardRole(db, b, userId);
  if (!role && !(b.kind !== "personal" && (await isTodoAdmin(userId)))) throw fail("이 보드를 볼 수 없습니다.", 403);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.*, u.name FROM todo_board_members m LEFT JOIN users u ON u.user_id = m.user_id
        WHERE m.board_id = $1 ORDER BY m.role, u.name`,
      [boardId]
    )
  );
  const photos = await loadPhotoUrls(db, rows.map((r) => String(r.user_id)));
  return rows.map((r) => ({
    userId: String(r.user_id),
    name: String(r.name ?? ""),
    photoUrl: photoOf(photos, String(r.user_id)),
    role: (TODO_MEMBER_ROLES as readonly string[]).includes(String(r.role)) ? (String(r.role) as TodoMemberRole) : "member",
    addedBy: r.added_by != null ? String(r.added_by) : null,
    createdAt: String(r.created_at ?? ""),
  }));
}

export async function addMember(userId: string, boardId: string, input: Record<string, unknown>): Promise<TodoBoardMember[]> {
  const memberId = str(input.userId, 80);
  if (!memberId) throw fail("추가할 사용자를 선택하세요.");
  const role = (TODO_MEMBER_ROLES as readonly string[]).includes(String(input.role)) ? (String(input.role) as TodoMemberRole) : "member";
  await withDbWrite(async (db) => {
    const b = await requireManage(db, userId, boardId);
    if (memberId === b.ownerUserId) throw fail("보드 소유자는 이미 관리자입니다.");
    const exists = rowsToObjects(await db.exec(`SELECT 1 FROM users WHERE user_id = $1`, [memberId]));
    if (!exists.length) throw fail("사용자를 찾을 수 없습니다.", 404);
    await db.run(
      `INSERT INTO todo_board_members (board_id, user_id, role, added_by, created_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (board_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [boardId, memberId, role, userId, nowIso()]
    );
  });
  return listMembers(userId, boardId);
}

export async function removeMember(userId: string, boardId: string, memberId: string): Promise<TodoBoardMember[]> {
  await withDbWrite(async (db) => {
    // 본인 탈퇴는 허용, 남 제거는 관리 권한.
    if (memberId !== userId) await requireManage(db, userId, boardId);
    await db.run(`DELETE FROM todo_board_members WHERE board_id = $1 AND user_id = $2`, [boardId, memberId]);
  });
  return memberId === userId ? [] : listMembers(userId, boardId);
}

// ── 작업 ──
/**
 * 작업 조회 공통 SELECT — 보드 파생(이름·종류·색·용역·발주처·계약, §19-11)과
 * 개인 보드 할 일의 link_kind=contract 연결 계약(용역명·계약상대 업체)을 함께 읽는다.
 */
const ITEM_SELECT = `
  SELECT i.*, ou.name AS owner_name, au.name AS assignee_name,
         b.name AS board_name, b.kind AS board_kind, b.color AS board_color,
         b.project_name AS board_project_name, b.client_name AS board_client_name, b.contract_id AS board_contract_id,
         lc.contract_title AS link_contract_title, lcp.company_name AS link_counterparty_name,
         (SELECT COUNT(*)::int FROM todo_items s WHERE s.parent_item_id = i.item_id AND s.archived_at IS NULL) AS subtask_total,
         (SELECT COUNT(*)::int FROM todo_items s WHERE s.parent_item_id = i.item_id AND s.archived_at IS NULL AND s.status = 'done') AS subtask_done,
         (SELECT COUNT(*)::int FROM todo_comments c WHERE c.item_id = i.item_id AND c.deleted_at IS NULL) AS comment_count
    FROM todo_items i
    JOIN todo_boards b ON b.board_id = i.board_id
    LEFT JOIN users ou ON ou.user_id = i.owner_user_id
    LEFT JOIN users au ON au.user_id = i.assignee_user_id
    LEFT JOIN contracts lc ON i.link_kind = 'contract' AND lc.contract_id = i.link_id
    LEFT JOIN facilities lcp ON lcp.facility_id = lc.counterparty_facility_id`;

const accessOf = (r: Record<string, unknown>): ItemAccessRow => ({
  itemId: String(r.item_id),
  boardId: String(r.board_id),
  parentItemId: r.parent_item_id != null ? String(r.parent_item_id) : null,
  ownerUserId: String(r.owner_user_id),
  assigneeUserId: r.assignee_user_id != null ? String(r.assignee_user_id) : null,
});

function mapItem(r: Record<string, unknown>, userId: string, canEdit: boolean, photos?: TodoPhotoMap): TodoItem {
  const status = (TODO_STATUSES as readonly string[]).includes(String(r.status)) ? (String(r.status) as TodoStatus) : "todo";
  const pr = Number(r.priority ?? 0);
  const boardKind = (TODO_BOARD_KINDS as readonly string[]).includes(String(r.board_kind)) ? (String(r.board_kind) as TodoBoardKind) : "personal";
  const linkKind =
    r.link_kind != null && (TODO_LINK_KINDS as readonly string[]).includes(String(r.link_kind)) ? (String(r.link_kind) as TodoLinkKind) : null;
  const linkId = r.link_id != null ? String(r.link_id) : null;
  const linkedContract = linkKind === "contract" && linkId ? linkId : null;
  const text = (v: unknown): string | null => (v != null && String(v).trim() ? String(v) : null);
  return {
    itemId: String(r.item_id),
    boardId: String(r.board_id),
    columnId: r.column_id != null ? String(r.column_id) : null,
    parentItemId: r.parent_item_id != null ? String(r.parent_item_id) : null,
    title: String(r.title ?? ""),
    note: r.note != null ? String(r.note) : null,
    status,
    priority: (pr >= 0 && pr <= 3 ? pr : 0) as TodoPriority,
    doDate: r.do_date != null ? String(r.do_date) : null,
    doTime: r.do_time != null ? String(r.do_time) : null,
    durationMin: r.duration_min != null ? Number(r.duration_min) : null,
    dueDate: r.due_date != null ? String(r.due_date) : null,
    allDay: Number(r.all_day ?? 1) === 1,
    remindAt: r.remind_at != null ? String(r.remind_at) : null,
    remindSentAt: r.remind_sent_at != null ? String(r.remind_sent_at) : null,
    snoozedUntil: r.snoozed_until != null ? String(r.snoozed_until) : null,
    recurrence: r.recurrence != null ? String(r.recurrence) : null,
    recurrenceParentId: r.recurrence_parent_id != null ? String(r.recurrence_parent_id) : null,
    position: String(r.position ?? FIRST_POSITION),
    linkKind,
    linkId,
    linkLabel: r.link_label != null ? String(r.link_label) : null,
    color: r.color != null ? String(r.color) : null,
    ownerUserId: String(r.owner_user_id),
    ownerName: r.owner_name != null ? String(r.owner_name) : null,
    ownerPhotoUrl: photos ? photoOf(photos, String(r.owner_user_id)) : null,
    assigneeUserId: r.assignee_user_id != null ? String(r.assignee_user_id) : null,
    assigneeName: r.assignee_name != null ? String(r.assignee_name) : null,
    assigneePhotoUrl: photos && r.assignee_user_id != null ? photoOf(photos, String(r.assignee_user_id)) : null,
    boardName: String(r.board_name ?? ""),
    boardKind,
    boardColor: todoBoardColorHex(r.board_color != null ? String(r.board_color) : null, boardKind),
    // 보드 값 우선, 없으면(개인 보드) link_kind=contract 의 계약에서.
    projectName: text(r.board_project_name) ?? (linkedContract ? text(r.link_contract_title) : null),
    clientName: text(r.board_client_name) ?? (linkedContract ? text(r.link_counterparty_name) : null),
    contractId: text(r.board_contract_id) ?? linkedContract,
    completedAt: r.completed_at != null ? String(r.completed_at) : null,
    completedBy: r.completed_by != null ? String(r.completed_by) : null,
    archivedAt: r.archived_at != null ? String(r.archived_at) : null,
    createdAt: String(r.created_at ?? ""),
    createdBy: r.created_by != null ? String(r.created_by) : null,
    updatedAt: String(r.updated_at ?? ""),
    updatedBy: r.updated_by != null ? String(r.updated_by) : null,
    subtaskTotal: Number(r.subtask_total ?? 0),
    subtaskDone: Number(r.subtask_done ?? 0),
    commentCount: Number(r.comment_count ?? 0),
    canEdit,
    isOwner: String(r.owner_user_id) === userId,
  };
}

/** 목록용 편집 가능 판정 — 보드 역할을 한 번만 읽고 행마다 계산(행별 쿼리 회피). */
async function mapItemsWithEdit(db: PgDatabase, userId: string, rows: Record<string, unknown>[]): Promise<TodoItem[]> {
  if (!rows.length) return [];
  const boardIds = [...new Set(rows.map((r) => String(r.board_id)))];
  const roles = new Map<string, TodoMemberRole>();
  const bRows = rowsToObjects(
    await db.exec(
      `SELECT b.board_id, b.owner_user_id, m.role
         FROM todo_boards b LEFT JOIN todo_board_members m ON m.board_id = b.board_id AND m.user_id = $2
        WHERE b.board_id = ANY($1::text[])`,
      [boardIds, userId]
    )
  );
  for (const b of bRows) {
    if (String(b.owner_user_id) === userId) roles.set(String(b.board_id), "admin");
    else if (b.role != null) roles.set(String(b.board_id), String(b.role) as TodoMemberRole);
  }
  const itemIds = rows.flatMap((r) => [String(r.item_id), ...(r.parent_item_id != null ? [String(r.parent_item_id)] : [])]);
  const shareRows = rowsToObjects(
    await db.exec(`SELECT item_id, role FROM todo_item_shares WHERE user_id = $1 AND item_id = ANY($2::text[])`, [userId, itemIds])
  );
  const shares = new Map<string, string>();
  for (const s of shareRows) shares.set(String(s.item_id), String(s.role));
  const photos = await loadPhotoUrls(
    db,
    rows.flatMap((r) => [String(r.owner_user_id), r.assignee_user_id != null ? String(r.assignee_user_id) : null])
  );
  return rows.map((r) => {
    const a = accessOf(r);
    const share = shares.get(a.itemId) ?? (a.parentItemId ? shares.get(a.parentItemId) : undefined);
    const role = roles.get(a.boardId);
    const canEdit =
      a.ownerUserId === userId ||
      a.assigneeUserId === userId ||
      share === "assignee" ||
      share === "collaborator" ||
      role === "admin" ||
      role === "member";
    return mapItem(r, userId, canEdit, photos);
  });
}

export interface ListItemsQuery {
  view: "my" | "board" | "shared";
  boardId?: string | null;
  from?: string | null;
  to?: string | null;
  /** 완료 포함 여부(기본 false → prefs.show_done_days 이내 완료만 포함하려면 true). */
  done?: boolean;
  includeArchived?: boolean;
}

/** 가시성 적용 목록. 상위 작업만(하위는 집계·상세). */
export async function listItems(userId: string, q: ListItemsQuery): Promise<{ items: TodoItem[]; boards: TodoBoard[] }> {
  const boards = await listBoards(userId);
  const db = await getDb();
  const prefs = await getPrefs(userId, db);
  const vals: unknown[] = [userId];
  const where: string[] = [visibleItemsWhere("$1"), "i.parent_item_id IS NULL"];
  if (!q.includeArchived) where.push("i.archived_at IS NULL");
  if (q.view === "my") {
    where.push("(i.assignee_user_id = $1 OR (i.assignee_user_id IS NULL AND i.owner_user_id = $1))");
  } else if (q.view === "board") {
    const boardId = str(q.boardId, 40);
    if (!boardId) throw fail("board 가 필요합니다.");
    if (!boards.some((b) => b.boardId === boardId)) throw fail("이 보드를 볼 수 없습니다.", 403);
    vals.push(boardId);
    where.push(`i.board_id = $${vals.length}`);
  } else {
    // 공유받음 — 남이 만든 작업 중 나에게 배정·공유됐거나 멤버 보드의 것
    where.push("i.owner_user_id <> $1");
  }
  if (q.done) {
    if (prefs.showDoneDays > 0) {
      vals.push(addDaysYmd(kstToday(), -prefs.showDoneDays));
      where.push(`(i.status <> 'done' OR i.completed_at IS NULL OR substr(i.completed_at, 1, 10) >= $${vals.length})`);
    }
  } else {
    where.push("i.status <> 'done'");
  }
  if (q.from && DATE_RE.test(q.from)) {
    vals.push(q.from);
    where.push(`(COALESCE(i.do_date, i.due_date) >= $${vals.length})`);
  }
  if (q.to && DATE_RE.test(q.to)) {
    vals.push(q.to);
    where.push(`(COALESCE(i.do_date, i.due_date) <= $${vals.length})`);
  }
  const rows = rowsToObjects(
    await db.exec(
      `${ITEM_SELECT} WHERE ${where.join(" AND ")}
        ORDER BY i.board_id, i.column_id NULLS LAST, i.position COLLATE "C", i.created_at`,
      vals
    )
  );
  return { items: await mapItemsWithEdit(db, userId, rows), boards };
}

async function loadItemRow(db: PgDatabase, itemId: string): Promise<Record<string, unknown>> {
  const rows = rowsToObjects(await db.exec(`${ITEM_SELECT} WHERE i.item_id = $1`, [itemId]));
  if (!rows.length) throw fail("할 일을 찾을 수 없습니다.", 404);
  return rows[0];
}

async function requireSee(db: PgDatabase, userId: string, itemId: string): Promise<Record<string, unknown>> {
  const row = await loadItemRow(db, itemId);
  if (!(await canSeeItem(db, userId, accessOf(row)))) throw fail("이 할 일을 볼 수 없습니다.", 403);
  return row;
}

async function requireEdit(db: PgDatabase, userId: string, itemId: string): Promise<Record<string, unknown>> {
  const row = await loadItemRow(db, itemId);
  if (!(await canEditItem(db, userId, accessOf(row)))) throw fail("이 할 일을 수정할 권한이 없습니다.", 403);
  return row;
}

function mapShare(r: Record<string, unknown>, photos?: TodoPhotoMap): TodoShare {
  return {
    userId: String(r.user_id),
    name: String(r.name ?? ""),
    photoUrl: photos ? photoOf(photos, String(r.user_id)) : null,
    role: (TODO_SHARE_ROLES as readonly string[]).includes(String(r.role)) ? (String(r.role) as TodoShareRole) : "watcher",
    addedBy: r.added_by != null ? String(r.added_by) : null,
    createdAt: String(r.created_at ?? ""),
  };
}

function mapComment(r: Record<string, unknown>, photos?: TodoPhotoMap): TodoComment {
  let mentions: string[] = [];
  try {
    const v = typeof r.mentions === "string" ? JSON.parse(r.mentions) : r.mentions;
    if (Array.isArray(v)) mentions = v.map((x) => String(x));
  } catch {
    /* 빈 배열 유지 */
  }
  return {
    commentId: String(r.comment_id),
    itemId: String(r.item_id),
    userId: String(r.user_id),
    userName: r.user_name != null ? String(r.user_name) : null,
    userPhotoUrl: photos ? photoOf(photos, String(r.user_id)) : null,
    body: String(r.body ?? ""),
    mentions,
    createdAt: String(r.created_at ?? ""),
  };
}

function mapActivity(r: Record<string, unknown>): TodoActivity {
  let detail: Record<string, unknown> = {};
  try {
    const v = typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail;
    if (v && typeof v === "object") detail = v as Record<string, unknown>;
  } catch {
    /* 빈 객체 유지 */
  }
  return {
    activityId: String(r.activity_id),
    itemId: String(r.item_id),
    userId: r.user_id != null ? String(r.user_id) : null,
    userName: r.user_name != null ? String(r.user_name) : null,
    action: String(r.action) as TodoActivityAction,
    detail,
    createdAt: String(r.created_at ?? ""),
  };
}

export async function getItemDetail(userId: string, itemId: string): Promise<TodoItemDetail> {
  const db = await getDb();
  const row = await requireSee(db, userId, itemId);
  const [base] = await mapItemsWithEdit(db, userId, [row]);
  const subRows = rowsToObjects(
    await db.exec(`${ITEM_SELECT} WHERE i.parent_item_id = $1 AND i.archived_at IS NULL ORDER BY i.position COLLATE "C", i.created_at`, [itemId])
  );
  const subtasks = await mapItemsWithEdit(db, userId, subRows);
  const shareRows = rowsToObjects(
    await db.exec(
      `SELECT s.*, u.name FROM todo_item_shares s LEFT JOIN users u ON u.user_id = s.user_id WHERE s.item_id = $1 ORDER BY s.role, u.name`,
      [itemId]
    )
  );
  const commentRows = rowsToObjects(
    await db.exec(
      `SELECT c.*, u.name AS user_name FROM todo_comments c LEFT JOIN users u ON u.user_id = c.user_id
        WHERE c.item_id = $1 AND c.deleted_at IS NULL ORDER BY c.created_at`,
      [itemId]
    )
  );
  const photos = await loadPhotoUrls(db, [...shareRows.map((r) => String(r.user_id)), ...commentRows.map((r) => String(r.user_id))]);
  const shares = shareRows.map((r) => mapShare(r, photos));
  const comments = commentRows.map((r) => mapComment(r, photos));
  const activity = rowsToObjects(
    await db.exec(
      `SELECT a.*, u.name AS user_name FROM todo_activity a LEFT JOIN users u ON u.user_id = a.user_id
        WHERE a.item_id = $1 ORDER BY a.created_at DESC LIMIT 100`,
      [itemId]
    )
  ).map(mapActivity);
  return { ...base, subtasks, shares, comments, activity };
}

async function logActivity(db: PgDatabase, itemId: string, userId: string | null, action: TodoActivityAction, detail: Record<string, unknown> = {}) {
  await db.run(
    `INSERT INTO todo_activity (activity_id, item_id, user_id, action, detail, created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [newId("ta_"), itemId, userId, action, JSON.stringify(detail), nowIso()]
  );
}

async function userName(db: PgDatabase, userId: string): Promise<string | null> {
  const rows = rowsToObjects(await db.exec(`SELECT name FROM users WHERE user_id = $1`, [userId]));
  return rows.length ? String(rows[0].name) : null;
}

/** 작업 구독자(owner·담당·공유) — 상태·댓글 푸시 대상. */
async function subscribersOf(db: PgDatabase, itemId: string): Promise<string[]> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT owner_user_id AS uid FROM todo_items WHERE item_id = $1
       UNION SELECT assignee_user_id FROM todo_items WHERE item_id = $1 AND assignee_user_id IS NOT NULL
       UNION SELECT user_id FROM todo_item_shares WHERE item_id = $1`,
      [itemId]
    )
  );
  return [...new Set(rows.map((r) => String(r.uid)).filter(Boolean))];
}

/** 열↔상태 매핑 보드에서 status 에 해당하는 열. */
async function columnForStatus(db: PgDatabase, boardId: string, status: TodoStatus): Promise<string | null> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.column_id FROM todo_columns c JOIN todo_boards b ON b.board_id = c.board_id
        WHERE c.board_id = $1 AND b.column_status_map = 1 AND c.status_map = $2
        ORDER BY c.position COLLATE "C" LIMIT 1`,
      [boardId, status]
    )
  );
  return rows.length ? String(rows[0].column_id) : null;
}

async function columnInfo(db: PgDatabase, boardId: string, columnId: string): Promise<{ statusMap: TodoStatus | null; mapped: boolean }> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.status_map, b.column_status_map FROM todo_columns c JOIN todo_boards b ON b.board_id = c.board_id
        WHERE c.board_id = $1 AND c.column_id = $2`,
      [boardId, columnId]
    )
  );
  if (!rows.length) throw fail("열을 찾을 수 없습니다.", 404);
  const sm = rows[0].status_map != null ? (String(rows[0].status_map) as TodoStatus) : null;
  return { statusMap: sm, mapped: Number(rows[0].column_status_map ?? 1) === 1 };
}

async function lastPositionIn(db: PgDatabase, boardId: string, columnId: string | null, parentItemId: string | null): Promise<string> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT position FROM todo_items
        WHERE board_id = $1 AND column_id IS NOT DISTINCT FROM $2 AND parent_item_id IS NOT DISTINCT FROM $3
        ORDER BY position COLLATE "C" DESC LIMIT 1`,
      [boardId, columnId, parentItemId]
    )
  );
  return between(rows.length ? String(rows[0].position) : null, null);
}

interface NormalizedItemInput {
  title: string;
  note: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  doDate: string | null;
  doTime: string | null;
  durationMin: number | null;
  dueDate: string | null;
  recurrence: string | null;
  linkKind: TodoLinkKind | null;
  linkId: string | null;
  linkLabel: string | null;
  color: string | null;
}

function normalizeItem(input: Record<string, unknown>, cur?: Record<string, unknown>): NormalizedItemInput {
  const pick = (key: string, col: string) => (input[key] !== undefined ? input[key] : cur?.[col]);
  const title = str(pick("title", "title"), 200);
  if (!title) throw fail("제목을 입력하세요.");
  const statusRaw = String(pick("status", "status") ?? "todo");
  if (!(TODO_STATUSES as readonly string[]).includes(statusRaw)) throw fail("상태 값이 올바르지 않습니다.");
  const prRaw = pick("priority", "priority");
  const priority = prRaw == null || prRaw === "" ? 0 : Number(prRaw);
  if (![0, 1, 2, 3].includes(priority)) throw fail("우선순위 값이 올바르지 않습니다.");
  const dateOrNull = (v: unknown, label: string): string | null => {
    const s = str(v, 10);
    if (!s) return null;
    if (!DATE_RE.test(s)) throw fail(`${label}은 YYYY-MM-DD 형식으로 입력하세요.`);
    return s;
  };
  const doDate = dateOrNull(pick("doDate", "do_date"), "할 날짜");
  const dueDate = dateOrNull(pick("dueDate", "due_date"), "마감일");
  const doTimeRaw = str(pick("doTime", "do_time"), 5);
  if (doTimeRaw && !TIME_RE.test(doTimeRaw)) throw fail("시각은 HH:mm 으로 입력하세요.");
  const doTime = doDate ? doTimeRaw : null;
  const durRaw = pick("durationMin", "duration_min");
  const durationMin = durRaw == null || durRaw === "" ? null : Number(durRaw);
  if (durationMin != null && (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 24 * 60)) throw fail("소요 시간(분)이 올바르지 않습니다.");
  const recurrence = str(pick("recurrence", "recurrence"), 40);
  if (!isValidRecurrence(recurrence)) throw fail("반복 규칙이 올바르지 않습니다.");
  const linkKindRaw = str(pick("linkKind", "link_kind"), 20);
  if (linkKindRaw && !(TODO_LINK_KINDS as readonly string[]).includes(linkKindRaw)) throw fail("연결 종류가 올바르지 않습니다.");
  const linkKind = (linkKindRaw as TodoLinkKind | null) ?? null;
  const color = str(pick("color", "color"), 20);
  if (color && !/^#[0-9a-fA-F]{6}$|^[a-z]{3,20}$/.test(color)) throw fail("색 값이 올바르지 않습니다.");
  return {
    title,
    note: str(pick("note", "note"), 5000),
    status: statusRaw as TodoStatus,
    priority: priority as TodoPriority,
    doDate,
    doTime,
    durationMin: doTime ? durationMin : null,
    dueDate,
    recurrence,
    linkKind,
    linkId: linkKind ? str(pick("linkId", "link_id"), 500) : null,
    linkLabel: linkKind ? str(pick("linkLabel", "link_label"), 200) : null,
    color,
  };
}

export async function createItem(userId: string, input: Record<string, unknown>): Promise<TodoItemDetail> {
  const v = normalizeItem(input);
  // 반복 규칙만 있고 날짜가 없으면 오늘(KST) 이후 첫 발생일을 할 날로 잡는다(퀵애드 "매월 17일 …").
  if (v.recurrence && !v.doDate && !v.dueDate) {
    const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    v.doDate = nextOccurrence(v.recurrence, null, todayKst);
  }
  const parentItemId = str(input.parentItemId, 40);
  // 담당자 기본값 = 작성자(§6.1). 본인 배정은 공유 행·알림을 만들지 않는다.
  let assigneeId = str(input.assigneeUserId, 80) ?? userId;
  const explicitRemind = input.remindAt;
  const itemId = newId("td_");
  let assignedTo: { assigneeUserId: string; byName: string | null } | null = null;
  await withDbWrite(async (db) => {
    let boardId = str(input.boardId, 40);
    let columnId = str(input.columnId, 40);
    let status = v.status;
    if (parentItemId) {
      // 하위 작업은 부모의 보드를 따르고 1단계만 허용.
      const parent = await requireEdit(db, userId, parentItemId);
      if (parent.parent_item_id != null) throw fail("하위 작업 아래에 또 하위 작업을 만들 수 없습니다.");
      boardId = String(parent.board_id);
      columnId = null;
    } else {
      if (!boardId) {
        const rows = rowsToObjects(await db.exec(`SELECT board_id FROM todo_boards WHERE owner_user_id = $1 AND is_default = 1`, [userId]));
        boardId = rows.length ? String(rows[0].board_id) : null;
      }
      if (!boardId) throw fail("보드가 없습니다. 먼저 보드 목록을 불러오세요.");
      const b = await loadBoardAccess(db, boardId);
      const role = await boardRole(db, b, userId);
      if (!role || role === "viewer") throw fail("이 보드에 할 일을 만들 수 없습니다.", 403);
      if (columnId) {
        const ci = await columnInfo(db, boardId, columnId);
        if (ci.mapped && ci.statusMap && input.status === undefined) status = ci.statusMap;
      } else {
        columnId = await columnForStatus(db, boardId, status);
      }
    }
    if (assigneeId) {
      const ex = rowsToObjects(await db.exec(`SELECT 1 FROM users WHERE user_id = $1`, [assigneeId]));
      if (!ex.length) throw fail("담당자를 찾을 수 없습니다.", 404);
    }
    const prefs = await getPrefs(userId, db);
    const remindAt =
      explicitRemind === undefined
        ? computeRemindAt(v, prefs)
        : explicitRemind == null || explicitRemind === ""
          ? null
          : ISO_RE.test(String(explicitRemind))
            ? new Date(String(explicitRemind)).toISOString()
            : (() => {
                throw fail("알림 시각이 올바르지 않습니다.");
              })();
    const position = await lastPositionIn(db, boardId, columnId, parentItemId);
    const now = nowIso();
    const completed = status === "done";
    await db.run(
      `INSERT INTO todo_items
         (item_id, board_id, column_id, parent_item_id, title, note, status, priority, do_date, do_time, duration_min, due_date, all_day,
          remind_at, recurrence, position, link_kind, link_id, link_label, color, owner_user_id, assignee_user_id,
          completed_at, completed_by, created_at, created_by, updated_at, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$21,$25,$21)`,
      [
        itemId,
        boardId,
        columnId,
        parentItemId,
        v.title,
        v.note,
        status,
        v.priority,
        v.doDate,
        v.doTime,
        v.durationMin,
        v.dueDate,
        v.doTime ? 0 : 1,
        remindAt,
        v.recurrence,
        position,
        v.linkKind,
        v.linkId,
        v.linkLabel,
        v.color,
        userId,
        assigneeId,
        completed ? now : null,
        completed ? userId : null,
        now,
      ]
    );
    await logActivity(db, itemId, userId, "create", { title: v.title, boardId, parentItemId });
    if (assigneeId && assigneeId !== userId) {
      await db.run(
        `INSERT INTO todo_item_shares (item_id, user_id, role, added_by, created_at) VALUES ($1,$2,'assignee',$3,$4)
         ON CONFLICT (item_id, user_id) DO UPDATE SET role = 'assignee'`,
        [itemId, assigneeId, userId, now]
      );
      await logActivity(db, itemId, userId, "assign", { to: assigneeId });
      assignedTo = { assigneeUserId: assigneeId, byName: await userName(db, userId) };
    }
    assigneeId = assigneeId ?? null;
  });
  if (assignedTo) {
    const a = assignedTo as { assigneeUserId: string; byName: string | null };
    notifyTodoAssigned({ itemId, title: v.title, assigneeUserId: a.assigneeUserId, byUserId: userId, byName: a.byName });
  }
  return getItemDetail(userId, itemId);
}

export interface MoveInput {
  boardId?: string | null;
  columnId?: string | null;
  afterItemId?: string | null;
  beforeItemId?: string | null;
}

/**
 * 부분 수정 — 상태·날짜·열·position·담당·본문. diff 기반 활동 로그, 열↔상태 동기화, remind_at 재계산.
 * 이동(boardId/columnId/afterItemId/beforeItemId)도 같은 PATCH 로 받는다.
 */
export async function updateItem(userId: string, itemId: string, patch: Record<string, unknown>): Promise<TodoItemDetail> {
  let pushes: Array<() => void> = [];
  await withDbWrite(async (db) => {
    const cur = await requireEdit(db, userId, itemId);
    const v = normalizeItem(patch, cur);
    const changes: Record<string, [unknown, unknown]> = {};
    const note = (k: string, before: unknown, after: unknown) => {
      if ((before ?? null) !== (after ?? null)) changes[k] = [before ?? null, after ?? null];
    };
    let boardId = String(cur.board_id);
    let columnId = cur.column_id != null ? String(cur.column_id) : null;
    let position = String(cur.position);
    let status = v.status;
    const parentItemId = cur.parent_item_id != null ? String(cur.parent_item_id) : null;

    // ── 이동 ──
    const move: MoveInput = {
      boardId: str(patch.boardId, 40),
      columnId: patch.columnId === undefined ? undefined : str(patch.columnId, 40),
      afterItemId: str(patch.afterItemId, 40),
      beforeItemId: str(patch.beforeItemId, 40),
    };
    if (move.boardId && move.boardId !== boardId) {
      if (parentItemId) throw fail("하위 작업은 부모와 함께 이동합니다.");
      if (String(cur.owner_user_id) !== userId) throw fail("다른 보드로 옮기는 것은 만든 사람만 할 수 있습니다.", 403);
      const b = await loadBoardAccess(db, move.boardId);
      const role = await boardRole(db, b, userId);
      if (!role || role === "viewer") throw fail("대상 보드에 쓸 권한이 없습니다.", 403);
      note("boardId", boardId, move.boardId);
      boardId = move.boardId;
      columnId = move.columnId === undefined ? await columnForStatus(db, boardId, status) : move.columnId;
      await db.run(`UPDATE todo_items SET board_id = $2, column_id = NULL WHERE parent_item_id = $1`, [itemId, boardId]);
    }
    if (move.columnId !== undefined && move.columnId !== columnId) {
      note("columnId", columnId, move.columnId);
      columnId = move.columnId;
    }
    if (columnId && (move.columnId !== undefined || move.boardId)) {
      const ci = await columnInfo(db, boardId, columnId);
      if (ci.mapped && ci.statusMap && patch.status === undefined) status = ci.statusMap;
    }
    if (patch.status !== undefined && status !== String(cur.status) && !move.columnId && !move.boardId) {
      // 상태만 바뀌면 매핑된 열로 따라간다.
      const mapped = await columnForStatus(db, boardId, status);
      if (mapped && mapped !== columnId) {
        note("columnId", columnId, mapped);
        columnId = mapped;
      }
    }
    const columnChanged = columnId !== (cur.column_id != null ? String(cur.column_id) : null) || boardId !== String(cur.board_id);
    if (move.afterItemId || move.beforeItemId) {
      const sorted = rowsToObjects(
        await db.exec(
          `SELECT item_id, position FROM todo_items
            WHERE board_id = $1 AND column_id IS NOT DISTINCT FROM $2 AND parent_item_id IS NOT DISTINCT FROM $3
            ORDER BY position COLLATE "C"`,
          [boardId, columnId, parentItemId]
        )
      ).map((r) => ({ id: String(r.item_id), position: String(r.position) }));
      position = positionBetweenNeighbors(sorted, { afterId: move.afterItemId, beforeId: move.beforeItemId, excludeId: itemId });
    } else if (patch.position !== undefined) {
      const p = str(patch.position, 200);
      if (!p || !isValidPosition(p)) throw fail("position 값이 올바르지 않습니다.");
      position = p;
    } else if (columnChanged) {
      position = await lastPositionIn(db, boardId, columnId, parentItemId);
    }
    if (position !== String(cur.position)) note("position", String(cur.position), position);

    // ── 담당 ──
    let assigneeId = cur.assignee_user_id != null ? String(cur.assignee_user_id) : null;
    if (patch.assigneeUserId !== undefined) {
      const next = str(patch.assigneeUserId, 80);
      if (next) {
        const ex = rowsToObjects(await db.exec(`SELECT 1 FROM users WHERE user_id = $1`, [next]));
        if (!ex.length) throw fail("담당자를 찾을 수 없습니다.", 404);
      }
      if (next !== assigneeId) {
        note("assigneeUserId", assigneeId, next);
        assigneeId = next;
      }
    }

    // ── 상태·완료 ──
    note("status", String(cur.status), status);
    const now = nowIso();
    let completedAt = cur.completed_at != null ? String(cur.completed_at) : null;
    let completedBy = cur.completed_by != null ? String(cur.completed_by) : null;
    if (status === "done" && String(cur.status) !== "done") {
      completedAt = now;
      completedBy = userId;
    } else if (status !== "done" && String(cur.status) === "done") {
      completedAt = null;
      completedBy = null;
    }

    // ── 본문 diff ──
    note("title", cur.title, v.title);
    note("note", cur.note, v.note);
    note("priority", Number(cur.priority ?? 0), v.priority);
    note("doDate", cur.do_date, v.doDate);
    note("doTime", cur.do_time, v.doTime);
    note("durationMin", cur.duration_min != null ? Number(cur.duration_min) : null, v.durationMin);
    note("dueDate", cur.due_date, v.dueDate);
    note("recurrence", cur.recurrence, v.recurrence);
    note("linkKind", cur.link_kind, v.linkKind);
    note("linkId", cur.link_id, v.linkId);
    note("linkLabel", cur.link_label, v.linkLabel);
    note("color", cur.color, v.color);

    // ── 알림 시각 — 명시 override 우선, 날짜·시각이 바뀌면 기본 규칙으로 재계산 ──
    let remindAt = cur.remind_at != null ? String(cur.remind_at) : null;
    let remindSentAt = cur.remind_sent_at != null ? String(cur.remind_sent_at) : null;
    let snoozedUntil = cur.snoozed_until != null ? String(cur.snoozed_until) : null;
    if (patch.remindAt !== undefined) {
      const raw = patch.remindAt;
      const next = raw == null || raw === "" ? null : ISO_RE.test(String(raw)) ? new Date(String(raw)).toISOString() : undefined;
      if (next === undefined) throw fail("알림 시각이 올바르지 않습니다.");
      if (next !== remindAt) {
        note("remindAt", remindAt, next);
        remindAt = next;
        remindSentAt = null;
        snoozedUntil = null;
      }
    } else if (changes.doDate || changes.doTime || changes.dueDate) {
      const prefs = await getPrefs(userId, db);
      const next = computeRemindAt(v, prefs);
      if (next !== remindAt) {
        note("remindAt", remindAt, next);
        remindAt = next;
        remindSentAt = null;
        snoozedUntil = null;
      }
    }

    if (!Object.keys(changes).length) return;
    await db.run(
      `UPDATE todo_items SET
         board_id = $2, column_id = $3, position = $4, title = $5, note = $6, status = $7, priority = $8,
         do_date = $9, do_time = $10, duration_min = $11, due_date = $12, all_day = $13,
         remind_at = $14, remind_sent_at = $15, snoozed_until = $16, recurrence = $17,
         link_kind = $18, link_id = $19, link_label = $20, color = $21, assignee_user_id = $22,
         completed_at = $23, completed_by = $24, updated_at = $25, updated_by = $26
       WHERE item_id = $1`,
      [
        itemId,
        boardId,
        columnId,
        position,
        v.title,
        v.note,
        status,
        v.priority,
        v.doDate,
        v.doTime,
        v.durationMin,
        v.dueDate,
        v.doTime ? 0 : 1,
        remindAt,
        remindSentAt,
        snoozedUntil,
        v.recurrence,
        v.linkKind,
        v.linkId,
        v.linkLabel,
        v.color,
        assigneeId,
        completedAt,
        completedBy,
        now,
        userId,
      ]
    );

    // ── 활동 로그(분류별) ──
    const byName = await userName(db, userId);
    if (changes.status) {
      const action: TodoActivityAction = status === "done" ? "complete" : String(cur.status) === "done" ? "reopen" : "status";
      await logActivity(db, itemId, userId, action, { from: changes.status[0], to: changes.status[1] });
      const recipients = await subscribersOf(db, itemId);
      pushes.push(() => notifyTodoStatus({ itemId, title: v.title, status, byUserId: userId, byName, recipients }));
    }
    if (changes.assigneeUserId) {
      await logActivity(db, itemId, userId, "assign", { from: changes.assigneeUserId[0], to: changes.assigneeUserId[1] });
      const prev = changes.assigneeUserId[0] as string | null;
      if (prev) await db.run(`DELETE FROM todo_item_shares WHERE item_id = $1 AND user_id = $2 AND role = 'assignee'`, [itemId, prev]);
      if (assigneeId && assigneeId !== String(cur.owner_user_id)) {
        await db.run(
          `INSERT INTO todo_item_shares (item_id, user_id, role, added_by, created_at) VALUES ($1,$2,'assignee',$3,$4)
           ON CONFLICT (item_id, user_id) DO UPDATE SET role = 'assignee'`,
          [itemId, assigneeId, userId, now]
        );
      }
      if (assigneeId) {
        const to = assigneeId;
        pushes.push(() => notifyTodoAssigned({ itemId, title: v.title, assigneeUserId: to, byUserId: userId, byName }));
      }
    }
    if (changes.doDate || changes.dueDate || changes.doTime) {
      await logActivity(db, itemId, userId, "due", {
        doDate: changes.doDate ?? undefined,
        doTime: changes.doTime ?? undefined,
        dueDate: changes.dueDate ?? undefined,
      });
    }
    if (changes.boardId || changes.columnId || changes.position) {
      await logActivity(db, itemId, userId, "move", {
        boardId: changes.boardId ?? undefined,
        columnId: changes.columnId ?? undefined,
        reordered: !!changes.position,
      });
    }
    const rest = Object.fromEntries(
      Object.entries(changes).filter(
        ([k]) => !["status", "assigneeUserId", "doDate", "doTime", "dueDate", "boardId", "columnId", "position", "remindAt"].includes(k)
      )
    );
    if (Object.keys(rest).length) await logActivity(db, itemId, userId, "update", { changes: rest });
  });
  for (const p of pushes) p();
  pushes = [];
  return getItemDetail(userId, itemId);
}

/** 삭제 — owner 만(하위 작업·댓글·활동 CASCADE). */
export async function deleteItem(userId: string, itemId: string): Promise<void> {
  await withDbWrite(async (db) => {
    const cur = await loadItemRow(db, itemId);
    if (String(cur.owner_user_id) !== userId) throw fail("삭제는 만든 사람만 할 수 있습니다.", 403);
    await db.run(`DELETE FROM todo_items WHERE item_id = $1`, [itemId]);
  });
}

/**
 * 완료/되돌리기. 완료 시 반복 규칙이 있으면 다음 발생 1건을 새로 만든다(지난 반복은 오늘 이후 첫 발생).
 * 되돌리기(done=false)는 status 를 todo 로.
 */
export async function completeItem(userId: string, itemId: string, done: boolean): Promise<{ item: TodoItemDetail; next: TodoItem | null }> {
  let nextId: string | null = null;
  let statusPush: (() => void) | null = null;
  await withDbWrite(async (db) => {
    const cur = await requireEdit(db, userId, itemId);
    const wasDone = String(cur.status) === "done";
    if (done === wasDone) return;
    const now = nowIso();
    const status: TodoStatus = done ? "done" : "todo";
    const boardId = String(cur.board_id);
    const mapped = await columnForStatus(db, boardId, status);
    const columnId = mapped ?? (cur.column_id != null ? String(cur.column_id) : null);
    await db.run(
      `UPDATE todo_items SET status = $2, column_id = $3, completed_at = $4, completed_by = $5, updated_at = $6, updated_by = $7
        WHERE item_id = $1`,
      [itemId, status, columnId, done ? now : null, done ? userId : null, now, userId]
    );
    await logActivity(db, itemId, userId, done ? "complete" : "reopen", { from: String(cur.status), to: status });
    const byName = await userName(db, userId);
    const recipients = await subscribersOf(db, itemId);
    const title = String(cur.title);
    if (done) statusPush = () => notifyTodoStatus({ itemId, title, status: "done", byUserId: userId, byName, recipients });

    if (done && cur.recurrence && cur.parent_item_id == null) {
      const today = kstToday();
      const from = cur.do_date != null ? String(cur.do_date) : cur.due_date != null ? String(cur.due_date) : null;
      const nextDate = nextOccurrence(String(cur.recurrence), from, today);
      if (nextDate) {
        const shift = (ymd: unknown): string | null => {
          if (ymd == null || !from) return null;
          const diff = Math.round((new Date(`${String(ymd)}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86400000);
          return addDaysYmd(nextDate, diff);
        };
        const doDate = cur.do_date != null ? nextDate : null;
        const dueDate = cur.do_date != null ? shift(cur.due_date) : nextDate;
        const doTime = cur.do_time != null ? String(cur.do_time) : null;
        const prefs = await getPrefs(String(cur.owner_user_id), db);
        const remindAt = computeRemindAt({ doDate, doTime, dueDate }, prefs);
        const openStatus: TodoStatus = "todo";
        const openColumn = await columnForStatus(db, boardId, openStatus);
        nextId = newId("td_");
        const position = await lastPositionIn(db, boardId, openColumn, null);
        await db.run(
          `INSERT INTO todo_items
             (item_id, board_id, column_id, parent_item_id, title, note, status, priority, do_date, do_time, duration_min, due_date, all_day,
              remind_at, recurrence, recurrence_parent_id, position, link_kind, link_id, link_label, color, owner_user_id, assignee_user_id,
              created_at, created_by, updated_at, updated_by)
           VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$23,$24)`,
          [
            nextId,
            boardId,
            openColumn,
            cur.title,
            cur.note,
            openStatus,
            Number(cur.priority ?? 0),
            doDate,
            doTime,
            cur.duration_min,
            dueDate,
            doTime ? 0 : 1,
            remindAt,
            cur.recurrence,
            cur.recurrence_parent_id != null ? String(cur.recurrence_parent_id) : itemId,
            position,
            cur.link_kind,
            cur.link_id,
            cur.link_label,
            cur.color,
            cur.owner_user_id,
            cur.assignee_user_id,
            now,
            userId,
          ]
        );
        // 공유는 그대로 승계
        await db.run(
          `INSERT INTO todo_item_shares (item_id, user_id, role, added_by, created_at)
           SELECT $2, user_id, role, added_by, $3 FROM todo_item_shares WHERE item_id = $1
           ON CONFLICT (item_id, user_id) DO NOTHING`,
          [itemId, nextId, now]
        );
        await logActivity(db, nextId, userId, "create", { recurrenceFrom: itemId, doDate, dueDate });
      }
    }
  });
  if (statusPush) (statusPush as () => void)();
  const item = await getItemDetail(userId, itemId);
  let next: TodoItem | null = null;
  if (nextId) {
    const db = await getDb();
    const rows = rowsToObjects(await db.exec(`${ITEM_SELECT} WHERE i.item_id = $1`, [nextId]));
    next = rows.length ? (await mapItemsWithEdit(db, userId, rows))[0] : null;
  }
  return { item, next };
}

/** 스누즈 — preset(10m·1h·3h·tomorrow) 또는 until(ISO). remind_at 을 다시 잡고 발송 기록을 비운다. */
export async function snoozeItem(userId: string, itemId: string, input: { preset?: unknown; until?: unknown }): Promise<TodoItemDetail> {
  await withDbWrite(async (db) => {
    await requireEdit(db, userId, itemId);
    let until: string;
    const preset = str(input.preset, 20);
    if (preset) {
      const p = TODO_SNOOZE_PRESETS.find((x) => x.key === preset);
      if (!p) throw fail("스누즈 프리셋이 올바르지 않습니다.");
      if (p.minutes === "tomorrow") {
        const prefs = await getPrefs(userId, db);
        until = kstIso(addDaysYmd(kstToday(), 1), prefs.defaultRemindAllDayTime);
      } else {
        until = new Date(Date.now() + p.minutes * 60000).toISOString();
      }
    } else {
      const raw = str(input.until, 40);
      if (!raw || !ISO_RE.test(raw)) throw fail("스누즈 시각이 올바르지 않습니다.");
      until = new Date(raw).toISOString();
    }
    await db.run(
      `UPDATE todo_items SET snoozed_until = $2, remind_at = $2, remind_sent_at = NULL, updated_at = $3, updated_by = $4 WHERE item_id = $1`,
      [itemId, until, nowIso(), userId]
    );
    await logActivity(db, itemId, userId, "snooze", { until });
  });
  return getItemDetail(userId, itemId);
}

// ── 댓글 ──
export async function listComments(userId: string, itemId: string): Promise<TodoComment[]> {
  const db = await getDb();
  await requireSee(db, userId, itemId);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.*, u.name AS user_name FROM todo_comments c LEFT JOIN users u ON u.user_id = c.user_id
        WHERE c.item_id = $1 AND c.deleted_at IS NULL ORDER BY c.created_at`,
      [itemId]
    )
  );
  const photos = await loadPhotoUrls(db, rows.map((r) => String(r.user_id)));
  return rows.map((r) => mapComment(r, photos));
}

/** 본문의 `@이름` 을 users.name 과 정확히 맞춰 user_id 로. 동명이인은 전부 포함(화면이 미리 선택했다면 mentionUserIds 로 넘긴다). */
async function resolveMentions(db: PgDatabase, body: string, explicit: string[]): Promise<string[]> {
  const names = [...new Set([...body.matchAll(/@([^\s@#!,.:;'"()]+)/g)].map((m) => m[1]))];
  const ids = new Set(explicit);
  if (names.length) {
    const rows = rowsToObjects(
      await db.exec(`SELECT user_id FROM users WHERE status = 'active' AND name = ANY($1::text[])`, [names])
    );
    for (const r of rows) ids.add(String(r.user_id));
  }
  return [...ids];
}

export async function addComment(userId: string, itemId: string, input: Record<string, unknown>): Promise<TodoComment[]> {
  const body = str(input.body, 4000);
  if (!body) throw fail("댓글 내용을 입력하세요.");
  const explicit = Array.isArray(input.mentionUserIds) ? input.mentionUserIds.map((v) => String(v)).filter(Boolean) : [];
  const commentId = newId("tcm_");
  let push: (() => void) | null = null;
  await withDbWrite(async (db) => {
    const cur = await requireSee(db, userId, itemId); // 참조자도 댓글 가능
    const mentions = await resolveMentions(db, body, explicit);
    const now = nowIso();
    await db.run(
      `INSERT INTO todo_comments (comment_id, item_id, user_id, body, mentions, created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [commentId, itemId, userId, body, JSON.stringify(mentions), now]
    );
    await logActivity(db, itemId, userId, "comment", { commentId, mentions });
    const subscribers = await subscribersOf(db, itemId);
    const byName = await userName(db, userId);
    const title = String(cur.title);
    push = () => notifyTodoComment({ itemId, title, commentId, byUserId: userId, byName, body, mentioned: mentions, subscribers });
  });
  if (push) (push as () => void)();
  return listComments(userId, itemId);
}

export async function deleteComment(userId: string, itemId: string, commentId: string): Promise<TodoComment[]> {
  await withDbWrite(async (db) => {
    const cur = await requireSee(db, userId, itemId);
    const rows = rowsToObjects(await db.exec(`SELECT user_id FROM todo_comments WHERE comment_id = $1 AND item_id = $2`, [commentId, itemId]));
    if (!rows.length) throw fail("댓글을 찾을 수 없습니다.", 404);
    if (String(rows[0].user_id) !== userId && String(cur.owner_user_id) !== userId) throw fail("댓글은 작성자나 할 일 소유자만 삭제할 수 있습니다.", 403);
    await db.run(`UPDATE todo_comments SET deleted_at = $2 WHERE comment_id = $1`, [commentId, nowIso()]);
  });
  return listComments(userId, itemId);
}

// ── 공유 ──
export async function shareItem(userId: string, itemId: string, input: Record<string, unknown>): Promise<TodoItemDetail> {
  const targetId = str(input.userId, 80);
  if (!targetId) throw fail("공유할 사용자를 선택하세요.");
  const role = (TODO_SHARE_ROLES as readonly string[]).includes(String(input.role)) ? (String(input.role) as TodoShareRole) : "watcher";
  let assignPush: (() => void) | null = null;
  await withDbWrite(async (db) => {
    const cur = await requireEdit(db, userId, itemId);
    if (targetId === String(cur.owner_user_id)) throw fail("만든 사람에게는 공유할 필요가 없습니다.");
    const ex = rowsToObjects(await db.exec(`SELECT 1 FROM users WHERE user_id = $1`, [targetId]));
    if (!ex.length) throw fail("사용자를 찾을 수 없습니다.", 404);
    const now = nowIso();
    await db.run(
      `INSERT INTO todo_item_shares (item_id, user_id, role, added_by, created_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (item_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [itemId, targetId, role, userId, now]
    );
    if (role === "assignee") {
      await db.run(`UPDATE todo_items SET assignee_user_id = $2, updated_at = $3, updated_by = $4 WHERE item_id = $1`, [itemId, targetId, now, userId]);
      await logActivity(db, itemId, userId, "assign", { from: cur.assignee_user_id ?? null, to: targetId });
      const byName = await userName(db, userId);
      const title = String(cur.title);
      assignPush = () => notifyTodoAssigned({ itemId, title, assigneeUserId: targetId, byUserId: userId, byName });
    }
    await logActivity(db, itemId, userId, "share", { userId: targetId, role });
  });
  if (assignPush) (assignPush as () => void)();
  return getItemDetail(userId, itemId);
}

/** 공유 해제 — owner 만(본인 공유 해제는 허용). 담당 해제면 assignee 도 비운다. */
export async function unshareItem(userId: string, itemId: string, targetId: string): Promise<TodoItemDetail | null> {
  await withDbWrite(async (db) => {
    const cur = await loadItemRow(db, itemId);
    if (String(cur.owner_user_id) !== userId && targetId !== userId) throw fail("공유 해제는 만든 사람만 할 수 있습니다.", 403);
    await db.run(`DELETE FROM todo_item_shares WHERE item_id = $1 AND user_id = $2`, [itemId, targetId]);
    if (cur.assignee_user_id != null && String(cur.assignee_user_id) === targetId) {
      await db.run(`UPDATE todo_items SET assignee_user_id = NULL, updated_at = $2, updated_by = $3 WHERE item_id = $1`, [itemId, nowIso(), userId]);
      await logActivity(db, itemId, userId, "assign", { from: targetId, to: null });
    }
    await logActivity(db, itemId, userId, "share", { userId: targetId, removed: true });
  });
  return targetId === userId ? null : getItemDetail(userId, itemId);
}

/** 메신저로 보내기(§10) — 텍스트+링크. 카드형은 2차. */
export async function sendItemToChat(userId: string, itemId: string, input: Record<string, unknown>): Promise<{ messageId: number }> {
  const roomId = Number(input.roomId);
  if (!Number.isInteger(roomId) || roomId <= 0) throw fail("대화방을 선택하세요.");
  const db = await getDb();
  const cur = await requireSee(db, userId, itemId);
  const base = (process.env.APP_PUBLIC_URL ?? "https://koensain.app").replace(/\/+$/, "");
  const due = cur.due_date != null ? ` · 마감 ${Number(String(cur.due_date).slice(5, 7))}/${Number(String(cur.due_date).slice(8, 10))}` : "";
  const when = cur.do_date != null ? ` · ${Number(String(cur.do_date).slice(5, 7))}/${Number(String(cur.do_date).slice(8, 10))}${cur.do_time ? " " + cur.do_time : ""}` : "";
  const extra = str(input.message, 500);
  const text = `📌 할 일: ${String(cur.title)}${when}${due}\n${base}${todoItemLink(itemId)}${extra ? `\n${extra}` : ""}`;
  let messageId: number;
  try {
    messageId = await postTextMessage(roomId, userId, text);
  } catch (e) {
    throw fail((e as Error).message || "메신저 전송에 실패했습니다.", 400);
  }
  await withDbWrite(async (tx) => logActivity(tx, itemId, userId, "share", { chatRoomId: roomId, messageId }));
  return { messageId };
}

// ── 위젯·홈·뱃지 ──
/** 다음 N시간 안에 예정(do_time)이거나 오늘·지연된 내 작업 — 데스크탑 위젯 브릿지용. */
export async function listDueSoon(userId: string, hours = 24): Promise<TodoItem[]> {
  const db = await getDb();
  const today = kstToday();
  const horizon = addDaysYmd(today, Math.max(1, Math.ceil(hours / 24)));
  const rows = rowsToObjects(
    await db.exec(
      `${ITEM_SELECT}
        WHERE ${visibleItemsWhere("$1")}
          AND (i.assignee_user_id = $1 OR (i.assignee_user_id IS NULL AND i.owner_user_id = $1))
          AND i.status <> 'done' AND i.archived_at IS NULL AND i.parent_item_id IS NULL
          AND ((i.do_date IS NOT NULL AND i.do_date <= $3) OR (i.due_date IS NOT NULL AND i.due_date <= $3))
        ORDER BY COALESCE(i.do_date, i.due_date), i.do_time NULLS LAST, i.priority DESC
        LIMIT 50`,
      [userId, today, horizon]
    )
  );
  return mapItemsWithEdit(db, userId, rows);
}

export interface TodoTodaySummary {
  today: string;
  overdue: TodoItem[];
  todayItems: TodoItem[];
  thisWeek: TodoItem[];
  counts: { overdue: number; today: number; thisWeek: number };
}

/** 홈 위젯(H12) — 지연·오늘·이번 주 상위 5건씩 + 건수. */
export async function listTodayForHome(userId: string): Promise<TodoTodaySummary> {
  const db = await getDb();
  const today = kstToday();
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // 월=0
  const weekEnd = addDaysYmd(today, 6 - dow);
  const rows = rowsToObjects(
    await db.exec(
      `${ITEM_SELECT}
        WHERE ${visibleItemsWhere("$1")}
          AND (i.assignee_user_id = $1 OR (i.assignee_user_id IS NULL AND i.owner_user_id = $1))
          AND i.status <> 'done' AND i.archived_at IS NULL AND i.parent_item_id IS NULL
          AND COALESCE(i.do_date, i.due_date) <= $2
        ORDER BY COALESCE(i.do_date, i.due_date), i.do_time NULLS LAST, i.priority DESC, i.position COLLATE "C"`,
      [userId, weekEnd]
    )
  );
  const items = await mapItemsWithEdit(db, userId, rows);
  const keyDate = (it: TodoItem) => it.doDate ?? it.dueDate ?? "";
  const overdue = items.filter((it) => keyDate(it) < today || (it.dueDate != null && it.dueDate < today));
  const todayItems = items.filter((it) => !overdue.includes(it) && (keyDate(it) === today || it.dueDate === today));
  const thisWeek = items.filter((it) => !overdue.includes(it) && !todayItems.includes(it));
  return {
    today,
    overdue: overdue.slice(0, 5),
    todayItems: todayItems.slice(0, 5),
    thisWeek: thisWeek.slice(0, 5),
    counts: { overdue: overdue.length, today: todayItems.length, thisWeek: thisWeek.length },
  };
}

/** 메뉴 뱃지 — 오늘+지연(내 담당, 미완료). */
export async function countDueBadge(userId: string): Promise<number> {
  const db = await getDb();
  const today = kstToday();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT COUNT(*)::int AS n FROM todo_items i
        WHERE (i.assignee_user_id = $1 OR (i.assignee_user_id IS NULL AND i.owner_user_id = $1))
          AND i.status <> 'done' AND i.archived_at IS NULL AND i.parent_item_id IS NULL
          AND ((i.do_date IS NOT NULL AND i.do_date <= $2) OR (i.due_date IS NOT NULL AND i.due_date <= $2))`,
      [userId, today]
    )
  );
  return rows.length ? Number(rows[0].n) : 0;
}

/** 완료 30일 경과 작업 자동 보관(tick). */
export async function archiveCompletedItems(): Promise<{ archived: number }> {
  const cutoff = new Date(Date.now() - TODO_ARCHIVE_AFTER_DAYS * 86400000).toISOString();
  let archived = 0;
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(
        `UPDATE todo_items SET archived_at = $1
          WHERE status = 'done' AND archived_at IS NULL AND completed_at IS NOT NULL AND completed_at < $2
          RETURNING item_id`,
        [nowIso(), cutoff]
      )
    );
    archived = rows.length;
  });
  return { archived };
}
