/*
 * 일정 메뉴(G6-C) 통합 조회 — 휴가/출장/교육(전자결재 상신 문서) + 영업 활동 + 법인차량.
 * 스케줄명은 여기서(서버) 규칙대로 조립한다 — leave_types 카탈로그·용역분류 매핑이 서버 자산이고,
 * 모바일이 후속 재사용할 때 클라 조립 로직이 갈라지지 않게 하기 위함.
 *
 * 등록 판정(사용자 확정): 결재 문서는 상신부터 — status IN ('in_progress','approved').
 * draft/rejected/canceled 는 자연 제외된다(반려·취소 시 캘린더에서 사라짐).
 * 휴가는 문서가 단일 소스이고, 관리자 수기 입력분(annual_leave_ledger.doc_id IS NULL)만 보충한다
 * (문서 유래 ledger 행은 문서 쪽이 담당 — 이중 표시 방지).
 */

import { getDb, rowsToObjects } from "@/lib/db";
import { findInCatalog } from "@/lib/approval/leave-types";
import { listLeaveTypes } from "@/lib/approval/leave-types-store";
import {
  EDUCATION_FORM_ID,
  TRIP_FORM_ID,
  extractTripDestination,
  extractVehicleUse,
  normalizeContractClass,
  parsePeriod,
} from "@/lib/approval/trip";
import { LEAVE_FORM_ID } from "@/lib/approval/leave";
import { listActivitiesByMonth } from "@/lib/sales/queries";
import { ACTIVITY_TYPE_META } from "@/lib/sales/types";
import { expandRefs, loadCalendarPrefs } from "@/lib/calendar/prefs";
import type { CalendarEvent, CalendarPerson, CalendarTagKey } from "@/lib/calendar/types";

/** multitext(HTML) 값을 1줄 요약 텍스트로. */
function stripHtml(v: unknown): string | null {
  const s = String(v ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s || null;
}

function monthRange(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { first: `${month}-01`, last: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function parseFieldValues(raw: unknown): Record<string, unknown> {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type DocStatus = "in_progress" | "approved";

interface DocRow {
  docId: string;
  formId: string;
  status: DocStatus;
  employeeId: string | null;
  person: CalendarPerson | null;
  values: Record<string, unknown>;
}

/** 특정 양식의 상신(in_progress|approved) 문서 중 기간 필드가 해당 월과 겹치는 것을 조회한다. */
async function listMonthDocs(params: {
  formId: string;
  periodKey: string; // field_values 의 period 필드 키(leave_period/trip_period/edu_period)
  month: string;
  /** 지정 시 기안자(employee_id)를 이 집합으로 제한. 미지정 = 전사(차량용). */
  employeeIds?: string[];
}): Promise<DocRow[]> {
  const db = await getDb();
  const { first, last } = monthRange(params.month);
  const args: unknown[] = [params.formId, first, last];
  let scope = "";
  if (params.employeeIds) {
    if (params.employeeIds.length === 0) return [];
    args.push(params.employeeIds);
    scope = `AND d.drafter_employee_id = ANY($${args.length}::text[])`;
  }
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.form_id, d.status, d.field_values, d.drafter_employee_id,
              e.name, dep.dept_name, pos.position_name
         FROM approval_docs d
         LEFT JOIN employee_profiles e ON e.employee_id = d.drafter_employee_id
         LEFT JOIN departments dep ON dep.dept_id = e.dept_id
         LEFT JOIN positions pos ON pos.position_id = e.position_id
        WHERE d.form_id = $1
          AND d.status IN ('in_progress', 'approved')
          AND (d.field_values->'${params.periodKey}'->>'from') <= $3
          AND COALESCE(NULLIF(d.field_values->'${params.periodKey}'->>'to', ''),
                       d.field_values->'${params.periodKey}'->>'from') >= $2
          ${scope}
        ORDER BY d.field_values->'${params.periodKey}'->>'from' ASC`,
      args
    )
  );
  return rows.map((r) => {
    const employeeId = r.drafter_employee_id != null ? String(r.drafter_employee_id) : null;
    return {
      docId: String(r.doc_id),
      formId: String(r.form_id),
      status: (String(r.status) === "approved" ? "approved" : "in_progress") as DocStatus,
      employeeId,
      person: employeeId
        ? {
            employeeId,
            name: String(r.name ?? ""),
            positionName: r.position_name != null ? String(r.position_name) : null,
            deptName: r.dept_name != null ? String(r.dept_name) : null,
          }
        : null,
      values: parseFieldValues(r.field_values),
    };
  });
}

/**
 * 통합 일정 조회. tags 에 요청된 카테고리만 채워 반환한다.
 * sales 권한(sales.view) 판정은 라우트에서 하고, 여기는 includeSales 플래그로 받는다.
 */
export async function listCalendarEvents(params: {
  userId: string;
  month: string; // YYYY-MM
  tags: CalendarTagKey[];
  includeSales: boolean;
}): Promise<CalendarEvent[]> {
  const { userId, month, tags } = params;
  const wants = new Set(tags);
  const events: CalendarEvent[] = [];
  const db = await getDb();

  // ── 인적 대상 집합(self → dept → refs 순 — 중복 시 앞선 태그가 우선) ──
  const targets = new Map<string, CalendarTagKey>();
  const needPeople = wants.has("self") || wants.has("dept") || wants.has("refs");
  if (needPeople) {
    const meRows = rowsToObjects(
      await db.exec(`SELECT employee_id, dept_id FROM employee_profiles WHERE user_id = $1`, [userId])
    );
    const myEmployeeId = meRows.length ? String(meRows[0].employee_id) : null;
    const myDeptId = meRows.length && meRows[0].dept_id != null ? String(meRows[0].dept_id) : null;

    if (wants.has("self") && myEmployeeId) targets.set(myEmployeeId, "self");
    if (wants.has("dept") && myDeptId) {
      const deptRows = rowsToObjects(
        await db.exec(`SELECT employee_id FROM employee_profiles WHERE dept_id = $1 AND status = 'active'`, [myDeptId])
      );
      for (const r of deptRows) {
        const id = String(r.employee_id);
        if (!targets.has(id)) targets.set(id, "dept");
      }
    }
    if (wants.has("refs")) {
      const { refs } = await loadCalendarPrefs(userId);
      for (const id of await expandRefs(refs)) if (!targets.has(id)) targets.set(id, "refs");
    }
  }
  const targetIds = [...targets.keys()];
  const tagOf = (employeeId: string | null): CalendarTagKey | null =>
    employeeId ? (targets.get(employeeId) ?? null) : null;

  // ── 휴가 — 문서(상신부터) + 수기 대장 보충 ──
  if (targetIds.length) {
    const catalog = await listLeaveTypes();
    const leaveDocs = await listMonthDocs({
      formId: LEAVE_FORM_ID,
      periodKey: "leave_period",
      month,
      employeeIds: targetIds,
    });
    for (const doc of leaveDocs) {
      const tag = tagOf(doc.employeeId);
      if (!tag) continue;
      const period = parsePeriod(doc.values.leave_period);
      if (!period) continue;
      const item = findInCatalog(catalog, doc.values.leave_type);
      const typeLabel = item?.label ?? String(doc.values.leave_type ?? "휴가");
      events.push({
        id: `doc:${doc.docId}:leave`,
        tag,
        kind: "leave",
        // ':' 양쪽 공백 — 붙여 쓰면 좁아 보인다는 피드백(과도하지 않게 1칸씩).
        title: `${typeLabel} : ${doc.person?.name ?? ""}`,
        startDate: period.from,
        endDate: period.to,
        startTime: null,
        people: [], // 제목에 휴가자 이름이 이미 있다(사용자 확정 규칙).
        summary: stripHtml(doc.values.reason),
        docId: doc.docId,
        status: doc.status,
      });
    }

    // 관리자 수기 입력분(엑셀 임포트·수동) — 문서가 없어 doc_id IS NULL 인 use 행만.
    const ledgerRows = rowsToObjects(
      await db.exec(
        `SELECT l.entry_id, l.employee_id, l.used_on, l.note,
                e.name, lt.label AS type_label
           FROM annual_leave_ledger l
           JOIN employee_profiles e ON e.employee_id = l.employee_id
           LEFT JOIN leave_types lt ON lt.key = l.leave_type_key
          WHERE l.entry_type = 'use'
            AND l.doc_id IS NULL
            AND l.used_on IS NOT NULL
            AND substr(l.used_on, 1, 7) = $1
            AND l.employee_id = ANY($2::text[])
          ORDER BY l.used_on ASC`,
        [month, targetIds]
      )
    );
    for (const r of ledgerRows) {
      const tag = tagOf(String(r.employee_id));
      if (!tag) continue;
      const date = String(r.used_on).slice(0, 10);
      events.push({
        id: `ledg:${r.entry_id}`,
        tag,
        kind: "leave",
        title: `${String(r.type_label ?? "연차")} : ${String(r.name ?? "")}`,
        startDate: date,
        endDate: date,
        startTime: null,
        people: [],
        summary: r.note != null ? String(r.note) : null,
        docId: null,
        status: null,
      });
    }

    // ── 출장 — 문서 기안자가 대상 집합에 있는 것 ──
    const tripDocs = await listMonthDocs({
      formId: TRIP_FORM_ID,
      periodKey: "trip_period",
      month,
      employeeIds: targetIds,
    });
    for (const doc of tripDocs) {
      const tag = tagOf(doc.employeeId);
      if (!tag) continue;
      const period = parsePeriod(doc.values.trip_period);
      if (!period) continue;
      const destination = extractTripDestination(doc.values) ?? "출장";
      const classes = normalizeContractClass(doc.values.contract_class);
      events.push({
        id: `doc:${doc.docId}:trip`,
        tag,
        kind: "trip",
        title: classes.length ? `${destination} : ${classes.join("·")}` : destination,
        startDate: period.from,
        endDate: period.to,
        startTime: null,
        people: doc.person ? [doc.person] : [],
        summary: stripHtml(doc.values.purpose),
        docId: doc.docId,
        status: doc.status,
      });
    }

    // ── 교육 — 교육훈련 신청(123) 문서 ──
    const eduDocs = await listMonthDocs({
      formId: EDUCATION_FORM_ID,
      periodKey: "edu_period",
      month,
      employeeIds: targetIds,
    });
    for (const doc of eduDocs) {
      const tag = tagOf(doc.employeeId);
      if (!tag) continue;
      const period = parsePeriod(doc.values.edu_period);
      if (!period) continue;
      events.push({
        id: `doc:${doc.docId}:education`,
        tag,
        kind: "education",
        title: String(doc.values.edu_name ?? "").trim() || "교육",
        startDate: period.from,
        endDate: period.to,
        startTime: null,
        people: doc.person ? [doc.person] : [],
        summary: stripHtml(doc.values.edu_content),
        docId: doc.docId,
        status: doc.status,
      });
    }
  }

  // ── 영업 — 기존 월별 조회 재사용 + 수행인력 별도 조인(모바일 API 무변경) ──
  if (wants.has("sales") && params.includeSales) {
    const activities = await listActivitiesByMonth(month);
    const actIds = activities.map((a) => a.activityId).filter(Boolean);
    const peopleByActivity = new Map<string, CalendarPerson[]>();
    if (actIds.length) {
      const rows = rowsToObjects(
        await db.exec(
          `SELECT saa.activity_id, saa.employee_id, e.name, dep.dept_name, pos.position_name
             FROM sales_activity_assignees saa
             LEFT JOIN employee_profiles e ON e.employee_id = saa.employee_id
             LEFT JOIN departments dep ON dep.dept_id = e.dept_id
             LEFT JOIN positions pos ON pos.position_id = e.position_id
            WHERE saa.activity_id = ANY($1::text[])
            ORDER BY saa.role_kind, e.name`,
          [actIds]
        )
      );
      // sales_activity_assignees 는 (활동, 인원, 역할)별 1행 — 같은 사람이 정·참석자 등
      // 복수 역할이면 행이 여러 개라 그대로 이으면 이름이 중복 표시된다. 인원 기준으로 dedup.
      for (const r of rows) {
        const aid = String(r.activity_id);
        const employeeId = String(r.employee_id ?? "");
        const list = peopleByActivity.get(aid) ?? [];
        if (!list.some((p) => p.employeeId === employeeId)) {
          list.push({
            employeeId,
            name: String(r.name ?? ""),
            positionName: r.position_name != null ? String(r.position_name) : null,
            deptName: r.dept_name != null ? String(r.dept_name) : null,
          });
        }
        peopleByActivity.set(aid, list);
      }
    }
    for (const a of activities) {
      const meta = ACTIVITY_TYPE_META[a.activityType];
      const start = String(a.scheduledAt ?? "").slice(0, 10);
      if (!start) continue;
      const end = a.endedAt ? String(a.endedAt).slice(0, 10) : start;
      const time = String(a.scheduledAt ?? "").slice(11, 16);
      events.push({
        id: `act:${a.activityId}`,
        tag: "sales",
        kind: "sales",
        title: `${meta?.short ?? "영업"} : ${a.facilityName ?? a.projectTitle}`,
        startDate: start,
        endDate: end >= start ? end : start,
        startTime: /^\d{2}:\d{2}$/.test(time) ? time : null,
        people: peopleByActivity.get(a.activityId) ?? [],
        summary: a.summary,
        docId: null,
        salesProjectId: a.projectId || null,
        status: null,
      });
    }
  }

  // ── 차량 — 출장신청서 상신 건 중 법인차량 이용(전사, 인적 스코프 무관) ──
  if (wants.has("vehicle")) {
    const tripDocs = await listMonthDocs({ formId: TRIP_FORM_ID, periodKey: "trip_period", month });
    for (const doc of tripDocs) {
      const use = extractVehicleUse(doc.values);
      if (!use) continue;
      const destination = extractTripDestination(doc.values) ?? "출장";
      events.push({
        id: `doc:${doc.docId}:vehicle`,
        tag: "vehicle",
        kind: "vehicle",
        title: `${destination} : ${use.assetName}`,
        startDate: use.period.from,
        endDate: use.period.to,
        startTime: null,
        people: doc.person ? [doc.person] : [],
        summary: use.carTime ? `이용시간 ${use.carTime}` : null,
        docId: doc.docId,
        status: doc.status,
      });
    }
  }

  events.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  return events;
}
