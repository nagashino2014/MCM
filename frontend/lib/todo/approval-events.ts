/*
 * 결재 일정 읽기 표시(§11·§19-12) — 내 할 일 날짜 섹션·캘린더·프로젝트 보드에 회색 읽기 전용 행으로 끼워 넣는 결재 문서 일정.
 *   - 내 문서(view=my): 휴가·출장·교육(+영업·차량·회의·면접·미팅)은 lib/calendar/queries.ts listCalendarEvents(self 태그)를 재사용하고,
 *     어느 캘린더에도 없는 초과근무(frm-overtime-request, field_values.work_period/work_time)는 approval_docs 를 직접 읽는다.
 *   - 보드 문서(view=board): 보드 멤버 전원의 출장·교육·초과근무 문서 중 **보드의 contract_id 와 일치하는 것만**(listBoardApprovalEvents).
 *   상신부터(status in_progress|approved).
 *   - 결재 대기(listMyPendingApprovals, 2026-10-13): 내가 결재할 차례인 문서를 kind "pending" 으로 오늘 한 건씩 — view=my·홈 위젯에만 합친다.
 * 계약 식별(§19-12): 문서 field_values 의 contract_select 값({title, contractId|manual} — 키는 빌더가 정하므로 shape 로 탐색,
 *   lib/approval/ref-link.ts findContractValue 와 같은 규칙) → contractId. 값이 없거나 직접입력이면 계약명 텍스트
 *   (contract_select.title · 출장 122 시드 contract_name · 초과근무 084 시드 project_name)를 contracts.contract_title 과 정확 일치로 맞춘다.
 *   커버리지: 초과근무 = contract_select(141 fillMap, 키 미고정) / 출장 = 시드는 text contract_name(빌더 개정으로 contract_select 면 shape 탐색) /
 *   교육 = 계약 필드 없음(항상 null).
 */
import { getDb, rowsToObjects, type PgDatabase } from "@/lib/db";
import { listCalendarEvents } from "@/lib/calendar/queries";
import { loadEntryAccess } from "@/lib/calendar/entries";
import { OVERTIME_FORM_ID } from "@/lib/approval/overtime";
import { EDUCATION_FORM_ID, TRIP_FORM_ID, extractTripDestination, normalizeContractClass, parsePeriod } from "@/lib/approval/trip";
import { parseTimeRange } from "@/lib/approval/fields";
import { boardRole } from "./visibility";
import { loadPhotoUrls, photoOf } from "./photo";
import { todoApprovalColorHex, type TodoApprovalEvent } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const endKey = to.slice(0, 7);
  for (let i = 0; i < 12; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= endKey) break;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function parseFieldValues(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      /* 빈 객체 */
    }
  }
  return {};
}

// ── 계약 식별 ──
export interface DocContractRef {
  /** contract_select 로 선택된 계약 id(직접입력·텍스트만이면 null). */
  contractId: string | null;
  /** 계약명 텍스트 — id 가 없을 때 contracts.contract_title 정확 일치로 맞춘다. */
  title: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 문서 field_values 에서 계약 참조를 뽑는다(키와 무관하게 contract_select shape 우선, 그다음 계약명 텍스트). */
export function extractDocContractRef(values: Record<string, unknown>): DocContractRef {
  for (const v of Object.values(values)) {
    if (isObj(v) && typeof v.title === "string" && ("contractId" in v || "manual" in v)) {
      const id = typeof v.contractId === "string" && v.contractId.trim() && !v.manual ? v.contractId.trim() : null;
      const title = v.title.trim() || null;
      if (id || title) return { contractId: id, title };
    }
  }
  for (const key of ["contract_name", "project_name", "contract_title"]) {
    const t = values[key];
    if (typeof t === "string" && t.trim()) return { contractId: null, title: t.trim() };
  }
  return { contractId: null, title: null };
}

interface ContractInfo {
  contractId: string;
  title: string;
  clientName: string | null;
}

const normTitle = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** 참조 목록을 contracts 로 해소 — id 직접 + 제목 정확 일치(공백·대소문자 무시). 반환: 입력 index → 계약. */
async function resolveContractRefs(db: PgDatabase, refs: DocContractRef[]): Promise<(ContractInfo | null)[]> {
  const ids = [...new Set(refs.map((r) => r.contractId).filter((v): v is string => !!v))];
  const titles = [...new Set(refs.filter((r) => !r.contractId && r.title).map((r) => normTitle(r.title as string)))];
  if (!ids.length && !titles.length) return refs.map(() => null);
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id, c.contract_title, cp.company_name AS counterparty_name,
              lower(regexp_replace(btrim(c.contract_title), '\\s+', ' ', 'g')) AS norm_title
         FROM contracts c
         LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
        WHERE c.deleted_at IS NULL
          AND (c.contract_id = ANY($1::text[]) OR lower(regexp_replace(btrim(c.contract_title), '\\s+', ' ', 'g')) = ANY($2::text[]))
        ORDER BY COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at) DESC NULLS LAST`,
      [ids, titles]
    )
  );
  const byId = new Map<string, ContractInfo>();
  const byTitle = new Map<string, ContractInfo>();
  for (const r of rows) {
    const info: ContractInfo = {
      contractId: String(r.contract_id),
      title: String(r.contract_title ?? ""),
      clientName: r.counterparty_name != null ? String(r.counterparty_name) : null,
    };
    byId.set(info.contractId, info);
    const nt = String(r.norm_title ?? "");
    if (!byTitle.has(nt)) byTitle.set(nt, info); // 동명 계약은 최신 1건
  }
  return refs.map((r) => {
    if (r.contractId) return byId.get(r.contractId) ?? null;
    if (r.title) return byTitle.get(normTitle(r.title)) ?? null;
    return null;
  });
}

interface DocMeta {
  values: Record<string, unknown>;
  drafterUserId: string | null;
  drafterName: string | null;
}

/** 이벤트의 docId 로 문서를 다시 읽어 계약·기안자를 채운다(캘린더 재사용 경로). */
async function enrichEvents(db: PgDatabase, events: TodoApprovalEvent[]): Promise<void> {
  const docIds = [...new Set(events.map((e) => e.docId).filter((v): v is string => !!v))];
  if (!docIds.length) return;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.field_values, d.drafter_user_id, COALESCE(NULLIF(d.drafter_name, ''), u.name) AS drafter_name
         FROM approval_docs d LEFT JOIN users u ON u.user_id = d.drafter_user_id
        WHERE d.doc_id = ANY($1::text[])`,
      [docIds]
    )
  );
  const metas = new Map<string, DocMeta>();
  for (const r of rows) {
    metas.set(String(r.doc_id), {
      values: parseFieldValues(r.field_values),
      drafterUserId: r.drafter_user_id != null ? String(r.drafter_user_id) : null,
      drafterName: r.drafter_name != null ? String(r.drafter_name) : null,
    });
  }
  const targets = events.filter((e) => e.docId && metas.has(e.docId));
  const refs = targets.map((e) => extractDocContractRef(metas.get(e.docId as string)!.values));
  const infos = await resolveContractRefs(db, refs);
  targets.forEach((e, i) => {
    const meta = metas.get(e.docId as string)!;
    const info = infos[i];
    e.contractId = info?.contractId ?? null;
    e.projectName = info?.title ?? refs[i].title ?? null;
    e.clientName = info?.clientName ?? null;
    e.drafterUserId = meta.drafterUserId;
    e.drafterName = meta.drafterName;
  });
}

const baseEvent = (
  partial: Omit<
    TodoApprovalEvent,
    "contractId" | "projectName" | "clientName" | "kindColor" | "drafterUserId" | "drafterName" | "drafterPhotoUrl" | "formName" | "docNo" | "submittedAt"
  >
): TodoApprovalEvent => ({
  ...partial,
  contractId: null,
  projectName: null,
  clientName: null,
  kindColor: todoApprovalColorHex(partial.kind),
  drafterUserId: null,
  drafterName: null,
  drafterPhotoUrl: null,
  formName: null,
  docNo: null,
  submittedAt: null,
});

/** 초과근무 문서(내 기안) — 기간이 [from,to] 와 겹치는 것. */
async function listMyOvertime(db: PgDatabase, userId: string, from: string, to: string): Promise<TodoApprovalEvent[]> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.title, d.status,
              d.field_values->'work_period'->>'from' AS from_date,
              COALESCE(NULLIF(d.field_values->'work_period'->>'to',''), d.field_values->'work_period'->>'from') AS to_date,
              d.field_values->'work_time' AS work_time
         FROM approval_docs d
        WHERE d.form_id = $1 AND d.status IN ('in_progress','approved')
          AND d.drafter_user_id = $2
          AND (d.field_values->'work_period'->>'from') <= $4
          AND COALESCE(NULLIF(d.field_values->'work_period'->>'to',''), d.field_values->'work_period'->>'from') >= $3`,
      [OVERTIME_FORM_ID, userId, from, to]
    )
  );
  return rows
    .filter((r) => r.from_date != null && DATE_RE.test(String(r.from_date)))
    .map((r) => {
      const t = parseTimeRange(r.work_time);
      return baseEvent({
        id: `doc:${String(r.doc_id)}:overtime`,
        kind: "overtime" as const,
        title: String(r.title ?? "초과근무"),
        startDate: String(r.from_date),
        endDate: DATE_RE.test(String(r.to_date ?? "")) ? String(r.to_date) : String(r.from_date),
        startTime: t.start || null,
        endTime: t.end || null,
        docId: String(r.doc_id),
        status: r.status === "approved" ? ("approved" as const) : ("in_progress" as const),
      });
    });
}

const sortEvents = (out: TodoApprovalEvent[]) =>
  out.sort((a, b) => (a.startDate === b.startDate ? (a.startTime ?? "").localeCompare(b.startTime ?? "") : a.startDate.localeCompare(b.startDate)));

/**
 * [from, to] 구간의 내 결재 일정(읽기 전용). 월 단위 조회를 합쳐 구간으로 자른다(최대 12개월).
 * 계약 식별(contractId·용역명·발주처)과 종류 색을 함께 채운다.
 */
export async function listTodoApprovalEvents(userId: string, from: string, to: string): Promise<TodoApprovalEvent[]> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return [];
  const db = await getDb();
  const access = await loadEntryAccess(userId);
  const out: TodoApprovalEvent[] = [];
  const seen = new Set<string>();
  for (const month of monthsBetween(from, to)) {
    const events = await listCalendarEvents({ userId, month, tags: ["self"], includeSales: false, access });
    for (const ev of events) {
      if (ev.endDate < from || ev.startDate > to) continue;
      if (ev.canceled) continue;
      if (ev.kind === "todo") continue; // 할 일 자체는 결재 일정이 아니다(캘린더 todo 태그 통합 후 방어)
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      out.push(
        baseEvent({
          id: ev.id,
          kind: ev.kind,
          title: ev.title,
          startDate: ev.startDate,
          endDate: ev.endDate,
          startTime: ev.startTime ?? null,
          endTime: ev.endTime ?? null,
          docId: ev.docId,
          status: ev.status,
        })
      );
    }
  }
  for (const ev of await listMyOvertime(db, userId, from, to)) {
    if (!seen.has(ev.id)) {
      seen.add(ev.id);
      out.push(ev);
    }
  }
  await enrichEvents(db, out);
  return sortEvents(out);
}

// ── 보드(용역) 모드 ──
const BOARD_FORM_PERIOD_KEYS: Record<string, { kind: TodoApprovalEvent["kind"]; periodKey: string }> = {
  [TRIP_FORM_ID]: { kind: "trip", periodKey: "trip_period" },
  [EDUCATION_FORM_ID]: { kind: "education", periodKey: "edu_period" },
  [OVERTIME_FORM_ID]: { kind: "overtime", periodKey: "work_period" },
};

/**
 * 보드 멤버 전원의 출장·교육·초과근무 문서 중 보드의 contract_id 와 일치하는 것(§19-12).
 * 가시성: 보드 멤버(owner·admin·member·viewer)만 — 멤버가 아니거나 보드에 계약이 없으면 [].
 */
export async function listBoardApprovalEvents(userId: string, boardId: string, from: string, to: string): Promise<TodoApprovalEvent[]> {
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return [];
  const db = await getDb();
  const bRows = rowsToObjects(
    await db.exec(`SELECT board_id, kind, owner_user_id, contract_id FROM todo_boards WHERE board_id = $1`, [boardId])
  );
  if (!bRows.length || bRows[0].contract_id == null) return [];
  const b = bRows[0];
  const contractId = String(b.contract_id);
  const role = await boardRole(db, { boardId, kind: String(b.kind), ownerUserId: String(b.owner_user_id) }, userId);
  if (!role) return [];
  const memberRows = rowsToObjects(await db.exec(`SELECT user_id FROM todo_board_members WHERE board_id = $1`, [boardId]));
  const memberIds = [...new Set([String(b.owner_user_id), ...memberRows.map((r) => String(r.user_id))])];

  const formIds = Object.keys(BOARD_FORM_PERIOD_KEYS);
  const periodCase = `(CASE d.form_id WHEN '${TRIP_FORM_ID}' THEN 'trip_period' WHEN '${EDUCATION_FORM_ID}' THEN 'edu_period' ELSE 'work_period' END)`;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.form_id, d.title, d.status, d.field_values, d.drafter_user_id,
              COALESCE(NULLIF(d.drafter_name, ''), u.name) AS drafter_name
         FROM approval_docs d LEFT JOIN users u ON u.user_id = d.drafter_user_id
        WHERE d.form_id = ANY($1::text[]) AND d.status IN ('in_progress','approved')
          AND d.drafter_user_id = ANY($2::text[])
          AND (d.field_values->${periodCase}->>'from') <= $4
          AND COALESCE(NULLIF(d.field_values->${periodCase}->>'to',''), d.field_values->${periodCase}->>'from') >= $3
        ORDER BY d.field_values->${periodCase}->>'from'`,
      [formIds, memberIds, from, to]
    )
  );
  if (!rows.length) return [];
  const docs = rows.map((r) => ({ row: r, values: parseFieldValues(r.field_values) }));
  const infos = await resolveContractRefs(
    db,
    docs.map((d) => extractDocContractRef(d.values))
  );
  const out: TodoApprovalEvent[] = [];
  docs.forEach((d, i) => {
    const info = infos[i];
    if (!info || info.contractId !== contractId) return;
    const spec = BOARD_FORM_PERIOD_KEYS[String(d.row.form_id)];
    if (!spec) return;
    const period = parsePeriod(d.values[spec.periodKey]);
    if (!period) return;
    let title = String(d.row.title ?? "");
    let startTime: string | null = null;
    let endTime: string | null = null;
    if (spec.kind === "trip") {
      const destination = extractTripDestination(d.values) ?? "출장";
      const classes = normalizeContractClass(d.values.contract_class);
      title = classes.length ? `${destination} : ${classes.join("·")}` : destination;
    } else if (spec.kind === "education") {
      title = String(d.values.edu_name ?? "").trim() || title || "교육";
    } else {
      const t = parseTimeRange(d.values.work_time);
      startTime = t.start || null;
      endTime = t.end || null;
      title = title || "초과근무";
    }
    out.push({
      id: `doc:${String(d.row.doc_id)}:${spec.kind}`,
      kind: spec.kind,
      title,
      startDate: period.from,
      endDate: period.to,
      startTime,
      endTime,
      docId: String(d.row.doc_id),
      status: d.row.status === "approved" ? "approved" : "in_progress",
      contractId: info.contractId,
      projectName: info.title,
      clientName: info.clientName,
      kindColor: todoApprovalColorHex(spec.kind),
      drafterUserId: d.row.drafter_user_id != null ? String(d.row.drafter_user_id) : null,
      drafterName: d.row.drafter_name != null ? String(d.row.drafter_name) : null,
      drafterPhotoUrl: null,
      formName: null,
      docNo: null,
      submittedAt: null,
    });
  });
  return sortEvents(out);
}

// ── 결재 대기(내가 결재할 차례, 2026-10-13 확정) ──
/** KST 오늘 YYYY-MM-DD. */
const kstToday = (): string => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * 내가 결재할 차례인 문서(결재 대기) — nav/badges 의 집계와 같은 조건(approval_steps pending + approval_docs in_progress).
 * 일정이 아니므로 기간 조회 없이 "오늘" 한 건으로 만든다(startDate=endDate=KST 오늘, 시각 없음). 긴급 → 상신 오래된 순.
 * 계약 식별은 다른 결재 일정과 같은 규칙(extractDocContractRef), 담당 열용으로 기안자 사진까지 채운다.
 * 가시성: 본인 결재 차례만(assignee_user_id = userId). 보드 모드(view=board)에는 섞지 않는다.
 */
export async function listMyPendingApprovals(userId: string): Promise<TodoApprovalEvent[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.title, d.doc_no, d.submitted_at, d.field_values, d.drafter_user_id,
              COALESCE(NULLIF(d.drafter_name, ''), u.name) AS drafter_name, f.name AS form_name
         FROM approval_steps s
         JOIN approval_docs d ON d.doc_id = s.doc_id
         LEFT JOIN approval_forms f ON f.form_id = d.form_id
         LEFT JOIN users u ON u.user_id = d.drafter_user_id
        WHERE s.assignee_user_id = $1 AND s.status = 'pending' AND d.status = 'in_progress'
        ORDER BY d.urgent DESC NULLS LAST, d.submitted_at ASC NULLS LAST, d.doc_id`,
      [userId]
    )
  );
  if (!rows.length) return [];
  // 같은 문서에 내 pending 단계가 둘이면(합의+결재 등) 한 행으로.
  const seen = new Set<string>();
  const docs = rows.filter((r) => {
    const id = String(r.doc_id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const values = docs.map((r) => parseFieldValues(r.field_values));
  const refs = values.map((v) => extractDocContractRef(v));
  const infos = await resolveContractRefs(db, refs);
  const photos = await loadPhotoUrls(
    db,
    docs.map((r) => (r.drafter_user_id != null ? String(r.drafter_user_id) : null))
  );
  const today = kstToday();
  return docs.map((r, i) => {
    const info = infos[i];
    const drafterUserId = r.drafter_user_id != null ? String(r.drafter_user_id) : null;
    const submittedAt = r.submitted_at != null && String(r.submitted_at).trim() ? String(r.submitted_at) : null;
    return {
      id: `pend:${String(r.doc_id)}`,
      kind: "pending" as const,
      title: String(r.title ?? "").trim() || String(r.form_name ?? "결재 문서"),
      startDate: today,
      endDate: today,
      startTime: null,
      endTime: null,
      docId: String(r.doc_id),
      status: "in_progress" as const,
      contractId: info?.contractId ?? null,
      projectName: info?.title ?? refs[i].title ?? null,
      clientName: info?.clientName ?? null,
      kindColor: todoApprovalColorHex("pending"),
      drafterUserId,
      drafterName: r.drafter_name != null ? String(r.drafter_name) : null,
      drafterPhotoUrl: photoOf(photos, drafterUserId),
      formName: r.form_name != null ? String(r.form_name) : null,
      docNo: r.doc_no != null && String(r.doc_no).trim() ? String(r.doc_no) : null,
      submittedAt,
    };
  });
}
