/*
 * 반려 요청(취소 요청)·결재 취소 코어 — 일정(캘린더)의 본인 스케줄 취소·변경 흐름(124).
 *   createCancelRequest: 기안자 본인이 진행중(in_progress)·승인완료(approved) 문서에 요청.
 *     in_progress 는 결재자가 기존 반려 기능으로 처리(actOnDoc 이 요청을 자동 resolve),
 *     approved 는 관리자가 결재 취소(lib/approval/admin-controls.ts adminCancelDoc, 346)로 처리한다.
 *   관리자 취소는 반려 요청이 없어도 모든 승인 문서에 쓸 수 있고, 사유·원래 번호를 남기며 번호를 반납한다.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { LEAVE_FORM_ID } from "@/lib/approval/leave";
import { EDUCATION_FORM_ID, TRIP_FORM_ID } from "@/lib/approval/trip";

/** 반려 요청을 허용하는 양식 — 일정에 표시되는 부재성 문서만(휴가/출장/교육). */
export const CANCELABLE_FORM_IDS = [LEAVE_FORM_ID, TRIP_FORM_ID, EDUCATION_FORM_ID] as const;

const newId = () => "acr-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);

export interface CancelRequestRow {
  requestId: string;
  docId: string;
  requestedBy: string;
  requestedByName: string | null;
  reason: string;
  status: "requested" | "resolved";
  resolution: "rejected" | "canceled" | "withdrawn" | null;
  requestedAt: string;
  resolvedAt: string | null;
}

function toRow(r: Record<string, unknown>): CancelRequestRow {
  return {
    requestId: String(r.request_id),
    docId: String(r.doc_id),
    requestedBy: String(r.requested_by),
    requestedByName: r.requested_by_name != null ? String(r.requested_by_name) : null,
    reason: String(r.reason ?? ""),
    status: String(r.status) === "resolved" ? "resolved" : "requested",
    resolution:
      r.resolution === "rejected" || r.resolution === "canceled" || r.resolution === "withdrawn" ? r.resolution : null,
    requestedAt: String(r.requested_at ?? ""),
    resolvedAt: r.resolved_at != null ? String(r.resolved_at) : null,
  };
}

/** 문서의 미처리(open) 반려 요청 — 상세 화면 배지·중복 방지에 쓴다. */
export async function getOpenCancelRequest(docId: string): Promise<CancelRequestRow | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT r.*, COALESCE(ep.name, u.email) AS requested_by_name
         FROM approval_cancel_requests r
         LEFT JOIN users u ON u.user_id = r.requested_by
         LEFT JOIN employee_profiles ep ON ep.user_id = r.requested_by
        WHERE r.doc_id = $1 AND r.status = 'requested'
        ORDER BY r.requested_at DESC LIMIT 1`,
      [docId]
    )
  );
  return rows.length ? toRow(rows[0]) : null;
}

/**
 * 반려 요청 생성 — 기안자 본인 + 대상 양식 + status ∈ {in_progress, approved} 검증.
 * 반환: 요청 행 + 문서 상태(알림 라우팅용 — in_progress 면 결재자, approved 면 관리자).
 */
export async function createCancelRequest(params: {
  docId: string;
  userId: string;
  reason: string;
}): Promise<{ request: CancelRequestRow; docStatus: "in_progress" | "approved" }> {
  const reason = params.reason.trim();
  if (!reason) throw new Error("반려 요청 사유를 입력하세요.");
  let docStatus: "in_progress" | "approved" = "in_progress";
  let requestId = "";
  const now = new Date().toISOString();

  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(`SELECT form_id, status, drafter_user_id FROM approval_docs WHERE doc_id = $1`, [params.docId])
    );
    if (!rows.length) throw new Error("문서를 찾을 수 없습니다.");
    const doc = rows[0];
    if (String(doc.drafter_user_id ?? "") !== params.userId) {
      throw new Error("본인이 기안한 문서에만 반려를 요청할 수 있습니다.");
    }
    if (!(CANCELABLE_FORM_IDS as readonly string[]).includes(String(doc.form_id))) {
      throw new Error("휴가·출장·교육 문서에만 반려를 요청할 수 있습니다.");
    }
    const status = String(doc.status);
    if (status !== "in_progress" && status !== "approved") {
      throw new Error("결재 진행 중이거나 승인 완료된 문서에만 반려를 요청할 수 있습니다.");
    }
    docStatus = status as "in_progress" | "approved";

    const open = rowsToObjects(
      await txn.exec(`SELECT 1 FROM approval_cancel_requests WHERE doc_id = $1 AND status = 'requested'`, [params.docId])
    );
    if (open.length) throw new Error("이미 처리 대기 중인 반려 요청이 있습니다.");

    requestId = newId();
    await txn.run(
      `INSERT INTO approval_cancel_requests (request_id, doc_id, requested_by, reason, status, requested_at)
       VALUES ($1, $2, $3, $4, 'requested', $5)`,
      [requestId, params.docId, params.userId, reason, now]
    );
  });

  return {
    request: {
      requestId,
      docId: params.docId,
      requestedBy: params.userId,
      requestedByName: null,
      reason,
      status: "requested",
      resolution: null,
      requestedAt: now,
      resolvedAt: null,
    },
    docStatus,
  };
}

/** 문서의 open 요청을 resolved 로 마감(트랜잭션 내부용 — actOnDoc reject·결재 취소에서 호출). */
export async function resolveOpenCancelRequests(
  txn: { run: (sql: string, params?: unknown[]) => Promise<void> },
  docId: string,
  resolution: "rejected" | "canceled" | "withdrawn",
  resolvedBy: string | null
): Promise<void> {
  await txn.run(
    `UPDATE approval_cancel_requests
        SET status = 'resolved', resolution = $2, resolved_at = $3, resolved_by = $4
      WHERE doc_id = $1 AND status = 'requested'`,
    [docId, resolution, new Date().toISOString(), resolvedBy]
  );
}
