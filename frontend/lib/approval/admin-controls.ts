/**
 * 결재 완료 문서 관리자 조치(346, 2026-11-09 사용자 요청) — 취소·간단한 값 수정·이력.
 *
 * 취소(adminCancelDoc): 삭제가 아니라 status='canceled' 전이 + 사유·처리자·원래 번호 기록.
 *   - 번호는 반납 풀(130)로 돌려 다음 상신이 이어받는다(문서 채번에서 빠짐). 원래 번호는 canceled_doc_no 에 남는다.
 *   - 휴가면 연차 대장 사용분 회수, 영수증·카드·쇼핑몰 전표 귀속 해제(다른 문서로 다시 기안 가능), 미처리 반려 요청 마감.
 *   - 경비 정산에 이미 들어간 지출 문서는 막는다(정산에서 먼저 뺀다).
 *   - 인사 발령 등 승인 때 자동 반영된 결과(등록 액션)는 되돌리지 않는다 — 화면에서 안내한다.
 * 값 수정(adminEditDocField): 일자·시각·글 같은 간단한 항목 하나를 사유와 함께 고친다(admin-edit-rules.ts).
 *   - 전후 값을 approval_doc_edits 에 남기고 감사 로그에도 남긴다. 휴가 문서면 연차 대장 사용분을 다시 계산한다.
 * 346 적용 전에는 취소·수정 모두 409 로 막는다(기록할 곳이 없으므로).
 */

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { parseFields } from "@/lib/approval/fields";
import { adminEditableFields, normalizeAdminEditValue, sameAdminValue } from "@/lib/approval/admin-edit-rules";
import { resolveOpenCancelRequests } from "@/lib/approval/cancel";
import { releaseDocNo } from "@/lib/approval/docs";
import { deleteLeaveUsageForDoc, LEAVE_FORM_ID, recordLeaveUsageOnApproval } from "@/lib/approval/leave";

function userError(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

const truthy = (v: unknown) => v === true || v === "t" || v === 1;

let readySeen = false;

/** 346 적용 여부(취소 기록 열·수정 이력 표). */
export async function adminControlsReady(db?: PgDatabase): Promise<boolean> {
  if (readySeen) return true;
  const conn = db ?? (await getDb());
  const r = rowsToObjects(
    await conn.exec(
      `SELECT to_regclass('approval_doc_edits') IS NOT NULL AS edits,
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'approval_docs' AND column_name = 'cancel_reason') AS cols`
    )
  )[0];
  readySeen = truthy(r?.edits) && truthy(r?.cols);
  return readySeen;
}

async function actorName(conn: PgDatabase, userId: string): Promise<string | null> {
  const r = rowsToObjects(
    await conn.exec(
      `SELECT COALESCE(ep.name, u.email) AS name FROM users u LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id WHERE u.user_id = $1`,
      [userId]
    )
  )[0];
  return r?.name != null ? String(r.name) : null;
}

export interface DocCancelInfo {
  canceledAt: string | null;
  canceledByName: string | null;
  reason: string | null;
  canceledDocNo: string | null;
}

export interface DocEditRow {
  editId: string;
  fieldKey: string;
  fieldLabel: string | null;
  fieldType: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  reason: string;
  editedByName: string | null;
  editedAt: string;
}

/** 상세 화면용 — 취소 기록(취소 문서만)·관리자 수정 이력. 346 전이면 비어 있다. */
export async function getDocAdminInfo(docId: string): Promise<{ cancelInfo: DocCancelInfo | null; edits: DocEditRow[] }> {
  const db = await getDb();
  if (!(await adminControlsReady(db))) return { cancelInfo: null, edits: [] };
  const d = rowsToObjects(
    await db.exec(
      `SELECT d.status, d.canceled_at, d.cancel_reason, d.canceled_doc_no, COALESCE(ep.name, u.email) AS canceled_by_name
         FROM approval_docs d
         LEFT JOIN users u ON u.user_id = d.canceled_by
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
        WHERE d.doc_id = $1`,
      [docId]
    )
  )[0];
  const cancelInfo: DocCancelInfo | null =
    d && String(d.status) === "canceled"
      ? {
          canceledAt: d.canceled_at != null ? String(d.canceled_at) : null,
          canceledByName: d.canceled_by_name != null ? String(d.canceled_by_name) : null,
          reason: d.cancel_reason != null ? String(d.cancel_reason) : null,
          canceledDocNo: d.canceled_doc_no != null ? String(d.canceled_doc_no) : null,
        }
      : null;
  const fieldTypes = new Map<string, string>();
  const f = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(v.fields, fm.fields) AS fields FROM approval_docs d
         JOIN approval_forms fm ON fm.form_id = d.form_id
         LEFT JOIN approval_form_versions v ON v.form_id = d.form_id AND v.version = d.form_version
        WHERE d.doc_id = $1`,
      [docId]
    )
  )[0];
  for (const fd of parseFields(f?.fields)) fieldTypes.set(fd.key, fd.type);
  const edits = rowsToObjects(
    await db.exec(`SELECT * FROM approval_doc_edits WHERE doc_id = $1 ORDER BY edited_at DESC`, [docId])
  ).map((r) => ({
    editId: String(r.edit_id),
    fieldKey: String(r.field_key),
    fieldLabel: r.field_label != null ? String(r.field_label) : null,
    fieldType: fieldTypes.get(String(r.field_key)) ?? null,
    beforeValue: r.before_value ?? null,
    afterValue: r.after_value ?? null,
    reason: String(r.reason ?? ""),
    editedByName: r.edited_by_name != null ? String(r.edited_by_name) : null,
    editedAt: String(r.edited_at ?? ""),
  }));
  return { cancelInfo, edits };
}

/** 승인 완료 문서 관리자 취소 — 사유 필수. 이중 호출은 조건부 UPDATE 0행으로 오류(멱등). */
export async function adminCancelDoc(params: {
  docId: string;
  actorUserId: string;
  reason: string;
  /** 기안자 반려 요청(124)으로 처리할 때 그 요청 id — 감사 로그용 */
  requestId?: string | null;
}): Promise<{ ledgerReversed: boolean; releasedDocNo: string | null; originalDocNo: string | null; formId: string }> {
  const reason = params.reason.trim();
  if (!reason) throw userError("취소 사유를 입력하세요.");
  if (reason.length > 500) throw userError("취소 사유는 500자 이내로 입력하세요.");
  const db = await getDb();
  if (!(await adminControlsReady(db))) throw userError("결재 취소 기록 열(346)이 아직 적용되지 않았습니다.", 409);
  let ledgerReversed = false;
  let releasedDocNo: string | null = null;
  let originalDocNo: string | null = null;
  let formId = "";
  await withDbWrite(async (txn) => {
    const now = new Date().toISOString();
    const hasSettlement = truthy(rowsToObjects(await txn.exec(`SELECT to_regclass('expense_settlement_items') IS NOT NULL AS ok`))[0]?.ok);
    if (hasSettlement) {
      const settled = rowsToObjects(await txn.exec(`SELECT 1 FROM expense_settlement_items WHERE doc_id = $1 LIMIT 1`, [params.docId]));
      if (settled.length) throw userError("경비 정산에 들어간 지출 문서입니다. 경비 정산에서 먼저 뺀 뒤 취소하세요.", 409);
    }
    const updated = rowsToObjects(
      await txn.exec(
        `UPDATE approval_docs
            SET status = 'canceled', canceled_doc_no = doc_no, doc_no = NULL,
                canceled_at = $2, canceled_by = $3, cancel_reason = $4, updated_at = $2
          WHERE doc_id = $1 AND status = 'approved'
          RETURNING form_id, canceled_doc_no`,
        [params.docId, now, params.actorUserId, reason]
      )
    );
    if (!updated.length) throw userError("승인 완료 상태의 문서만 취소할 수 있습니다.");
    formId = String(updated[0].form_id);
    const oldNo = updated[0].canceled_doc_no != null ? String(updated[0].canceled_doc_no) : null;
    originalDocNo = oldNo;
    // 문서 채번에서 빼기 — 번호를 반납해 다음 상신이 이어받는다
    if (oldNo && (await releaseDocNo(txn, oldNo))) releasedDocNo = oldNo;

    // 휴가 문서면 이 문서로 적재된 연차 대장·특별휴가 원장(363) use 행을 회수한다(doc_id 기준 — 자연 멱등)
    if (formId === LEAVE_FORM_ID) {
      ledgerReversed = (await deleteLeaveUsageForDoc(txn, params.docId)) > 0;
    }
    // 증빙 귀속 해제 — 문서 삭제(deleteDoc)와 같은 이유: 남겨 두면 다른 기안에서 다시 불러올 수 없다
    await txn.run(`UPDATE personal_receipts SET doc_id = NULL, doc_form_id = NULL, updated_at = $2 WHERE doc_id = $1`, [params.docId, now]);
    await txn.run(`UPDATE card_transactions SET doc_id = NULL, doc_form_id = NULL, updated_at = $2 WHERE doc_id = $1`, [params.docId, now]);
    await txn.run(`UPDATE shop_receipts SET doc_id = NULL WHERE doc_id = $1`, [params.docId]);

    await resolveOpenCancelRequests(txn, params.docId, "canceled", params.actorUserId);
    await recordAuditLogInline(txn, {
      actorUserId: params.actorUserId,
      action: "approval_doc_cancel",
      targetTable: "approval_docs",
      targetId: params.docId,
      before: { status: "approved", docNo: oldNo },
      after: { status: "canceled", reason, releasedDocNo, ledgerReversed, requestId: params.requestId ?? null },
    });
  });
  return { ledgerReversed, releasedDocNo, originalDocNo, formId };
}

/** 승인 완료 문서 관리자 값 수정 — 항목 하나, 사유 필수. */
export async function adminEditDocField(params: {
  docId: string;
  actorUserId: string;
  fieldKey: string;
  value: unknown;
  reason: string;
}): Promise<{ edit: DocEditRow; ledgerResynced: boolean }> {
  const reason = params.reason.trim();
  if (!reason) throw userError("수정 사유를 입력하세요.");
  if (reason.length > 500) throw userError("수정 사유는 500자 이내로 입력하세요.");
  const db = await getDb();
  if (!(await adminControlsReady(db))) throw userError("관리자 수정 이력 표(346)가 아직 적용되지 않았습니다.", 409);
  let out: DocEditRow | null = null;
  let ledgerResynced = false;
  await withDbWrite(async (txn) => {
    const rows = rowsToObjects(
      await txn.exec(
        `SELECT d.status, d.form_id, d.field_values, COALESCE(v.fields, f.fields) AS fields
           FROM approval_docs d
           JOIN approval_forms f ON f.form_id = d.form_id
           LEFT JOIN approval_form_versions v ON v.form_id = d.form_id AND v.version = d.form_version
          WHERE d.doc_id = $1
          FOR UPDATE OF d`,
        [params.docId]
      )
    );
    if (!rows.length) throw userError("문서를 찾을 수 없습니다.", 404);
    const doc = rows[0];
    if (String(doc.status) !== "approved") throw userError("승인 완료된 문서만 관리자가 고칠 수 있습니다.");
    const field = adminEditableFields(parseFields(doc.fields)).find((f) => f.key === params.fieldKey);
    if (!field) throw userError("관리자가 고칠 수 없는 항목입니다. 결재 취소 후 다시 기안하세요.");
    const checked = normalizeAdminEditValue(field, params.value);
    if (!checked.ok) throw userError(checked.error);
    let values: Record<string, unknown> = {};
    const raw = typeof doc.field_values === "string" ? JSON.parse(doc.field_values) : doc.field_values;
    if (raw && typeof raw === "object") values = raw as Record<string, unknown>;
    const before = values[field.key] ?? null;
    if (sameAdminValue(before, checked.value)) throw userError("바뀐 값이 없습니다.");
    const now = new Date().toISOString();
    await txn.run(`UPDATE approval_docs SET field_values = jsonb_set(COALESCE(field_values, '{}'::jsonb), $2::text[], $3::jsonb, true), updated_at = $4 WHERE doc_id = $1`, [
      params.docId,
      [field.key],
      JSON.stringify(checked.value),
      now,
    ]);
    // 휴가 문서 — 기간·사용일수가 바뀌었을 수 있으므로 연차 대장 사용분을 지우고 승인 때와 같은 규칙으로 다시 적재한다
    if (String(doc.form_id) === LEAVE_FORM_ID) {
      const removed = await deleteLeaveUsageForDoc(txn, params.docId); // 특별휴가 원장 use(363) 포함
      await recordLeaveUsageOnApproval(txn, params.docId);
      ledgerResynced = removed > 0;
    }
    const name = await actorName(txn, params.actorUserId);
    const editId = "aded-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
    await txn.run(
      `INSERT INTO approval_doc_edits (edit_id, doc_id, field_key, field_label, before_value, after_value, reason, edited_by, edited_by_name, edited_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)`,
      [editId, params.docId, field.key, field.label, JSON.stringify(before), JSON.stringify(checked.value), reason, params.actorUserId, name, now]
    );
    await recordAuditLogInline(txn, {
      actorUserId: params.actorUserId,
      action: "approval_doc_admin_edit",
      targetTable: "approval_docs",
      targetId: params.docId,
      before: { [field.key]: before },
      after: { [field.key]: checked.value, reason, editId },
    });
    out = {
      editId,
      fieldKey: field.key,
      fieldLabel: field.label,
      fieldType: field.type,
      beforeValue: before,
      afterValue: checked.value,
      reason,
      editedByName: name,
      editedAt: now,
    };
  });
  return { edit: out!, ledgerResynced };
}
