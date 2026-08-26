import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { ActionConnector } from "@/lib/approval/actions";

/*
 * 결근사유서 제출 요청(FRM-P1, 202) — 관리자가 결근자·기간을 지정해 요청을 만들면
 * 대상자 홈/기안 화면에 노출되고, 대상자가 결근사유서(frm-absence-statement)를 상신하면
 * 레지스트리 커넥터(hr.close_absence_request)가 요청을 doc_id 연결 + submitted 마감한다.
 */

export interface AbsenceRequestRow {
  requestId: string;
  employeeId: string;
  employeeName: string | null;
  deptName: string | null;
  dateFrom: string;
  dateTo: string;
  note: string | null;
  status: string;
  docId: string | null;
  docNo: string | null;
  requestedBy: string | null;
  createdAt: string;
}

function id(): string {
  return `abr-${crypto.randomBytes(6).toString("hex")}`;
}

function mapRow(r: Record<string, unknown>): AbsenceRequestRow {
  return {
    requestId: String(r.request_id),
    employeeId: String(r.employee_id),
    employeeName: r.employee_name != null ? String(r.employee_name) : null,
    deptName: r.dept_name != null ? String(r.dept_name) : null,
    dateFrom: String(r.date_from),
    dateTo: String(r.date_to),
    note: r.note != null ? String(r.note) : null,
    status: String(r.status),
    docId: r.doc_id != null ? String(r.doc_id) : null,
    docNo: r.doc_no != null ? String(r.doc_no) : null,
    requestedBy: r.requested_by != null ? String(r.requested_by) : null,
    createdAt: String(r.created_at),
  };
}

const BASE_SELECT = `
  SELECT r.*, e.name AS employee_name, d.dept_name, doc.doc_no
    FROM absence_statement_requests r
    JOIN employee_profiles e ON e.employee_id = r.employee_id
    LEFT JOIN departments d ON d.dept_id = e.dept_id
    LEFT JOIN approval_docs doc ON doc.doc_id = r.doc_id`;

/** 관리자용 목록 — status 미지정 시 전체(최신순). */
export async function listAbsenceRequests(status?: string): Promise<AbsenceRequestRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    status
      ? await db.exec(`${BASE_SELECT} WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 200`, [status])
      : await db.exec(`${BASE_SELECT} ORDER BY r.created_at DESC LIMIT 200`)
  );
  return rows.map(mapRow);
}

/** 본인의 열린 요청 — 기안 화면 배너·홈 노출용(user_id 로 조회). */
export async function listMyOpenAbsenceRequests(userId: string): Promise<AbsenceRequestRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `${BASE_SELECT} WHERE r.status = 'pending' AND e.user_id = $1 ORDER BY r.date_from`,
      [userId]
    )
  );
  return rows.map(mapRow);
}

export async function createAbsenceRequest(params: {
  employeeId: string;
  dateFrom: string;
  dateTo?: string | null;
  note?: string | null;
  requestedBy: string;
}): Promise<AbsenceRequestRow> {
  const now = new Date().toISOString();
  const requestId = id();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO absence_statement_requests (request_id, employee_id, date_from, date_to, note, status, requested_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $7)`,
      [requestId, params.employeeId, params.dateFrom, params.dateTo || params.dateFrom, params.note ?? null, params.requestedBy, now]
    );
  });
  const rows = await listAbsenceRequests();
  return rows.find((r) => r.requestId === requestId)!;
}

export async function cancelAbsenceRequest(requestId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(
      `UPDATE absence_statement_requests SET status = 'canceled', updated_at = $2 WHERE request_id = $1 AND status = 'pending'`,
      [requestId, new Date().toISOString()]
    );
  });
}

/* ---------- FRM-P0 커넥터 ---------- */

/**
 * 결근사유서 상신 시 열린 요청 자동 마감 — 결근 기간이 겹치는 pending 요청 우선,
 * 없으면 가장 오래된 pending 요청 1건을 doc_id 연결 + submitted 처리.
 * 열린 요청이 없어도 실패로 보지 않는다(요청 없이 자발 제출도 허용).
 */
export const closeAbsenceRequestConnector: ActionConnector = {
  kind: "hr.close_absence_request",
  label: "결근사유서 요청 마감",
  description: "상신된 결근사유서를 대상자의 열린 제출 요청에 연결하고 요청을 마감합니다.",
  slots: [{ key: "period", label: "결근 기간", hint: "period 필드 — 요청과 기간이 겹치는 건을 우선 매칭" }],
  async run(ctx) {
    const employeeId = ctx.drafterEmployeeId;
    if (!employeeId) return { detail: "기안자 직원 정보 없음 — 매칭 생략" };
    const period = (ctx.slot("period") ?? {}) as { from?: string; to?: string };
    const from = String(period.from ?? "");
    const to = String(period.to ?? from);

    let closed: { requestId: string } | null = null;
    await withDbWrite(async (txn) => {
      const open = rowsToObjects(
        await txn.exec(
          `SELECT request_id, date_from, date_to FROM absence_statement_requests
            WHERE employee_id = $1 AND status = 'pending' ORDER BY created_at`,
          [employeeId]
        )
      );
      if (!open.length) return;
      const overlap = from
        ? open.find((r) => String(r.date_from) <= to && String(r.date_to) >= from)
        : undefined;
      const target = overlap ?? open[0];
      await txn.run(
        `UPDATE absence_statement_requests SET status = 'submitted', doc_id = $2, updated_at = $3 WHERE request_id = $1`,
        [String(target.request_id), ctx.docId, new Date().toISOString()]
      );
      closed = { requestId: String(target.request_id) };
    });
    return closed
      ? { detail: `제출 요청 마감(${(closed as { requestId: string }).requestId})`, result: closed }
      : { detail: "열린 제출 요청 없음 — 자발 제출로 기록" };
  },
};
