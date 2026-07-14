/**
 * audit_log 기록 헬퍼.
 * - 마스터 변경(검수→마스터 sync, facility 병합/수정/수동등록, 사용자 관리)에서 호출.
 * - withDbWrite 내부에서 호출하면 트랜잭션 충돌이 발생하므로, 동일 트랜잭션 안에서 직접 INSERT 하는 방식도 별도로 노출.
 *
 * PostgreSQL 마이그레이션 후로는 wrapper PgDatabase.run() 이 async 이므로 호출자 측에서 await 가 필수.
 */

import { PgDatabase, withDbWrite } from "../db";

export type AuditAction =
  | "review_apply"
  | "facility_merge"
  | "facility_manual_create"
  | "facility_update"
  | "facility_enrich_apply"
  | "facility_delete"
  | "facility_history_create"
  | "facility_history_update"
  | "facility_history_delete"
  | "facility_merge_exclude"
  | "facility_group_create"
  | "facility_group_update"
  | "facility_group_delete"
  | "facility_group_membership_update"
  | "legal_entity_create"
  | "legal_entity_update"
  | "legal_entity_delete"
  | "facility_operating_entity_update"
  | "facility_alias_update"
  | "facility_service_update"
  | "facility_manual_product_update"
  | "facility_logo_update"
  | "facility_contact_update"
  | "contract_create"
  | "contract_update"
  | "contract_delete"
  | "contract_import"
  | "contract_payment_update"
  | "invoice_request"
  | "invoice_request_cancel"
  | "facility_promote"
  | "contract_invoice_upload"
  | "contract_document_upload"
  | "contract_outsourcing_update"
  | "contract_dedupe_resolve"
  | "permit_create"
  | "permit_update"
  | "permit_delete"
  | "annual_report_update"
  | "annual_report_delete"
  | "user_create"
  | "user_update"
  | "user_delete"
  | "user_password_reset"
  | "account_provision"
  | "permission_template_update"
  | "permission_assignment_update"
  | "employee_update"
  | "employee_document_upload"
  | "employee_hr_event_create"
  | "employee_hr_event_delete"
  | "work_plan_save"
  | "work_plan_delete"
  | "trash_purge"
  | "alert.ack";

export interface AuditEntry {
  actorUserId: string | null;
  action: AuditAction;
  targetTable: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
}

/** withDbWrite 트랜잭션 내부에서 직접 호출. 잠금 중첩 방지. */
export async function recordAuditLogInline(db: PgDatabase, entry: AuditEntry): Promise<void> {
  await db.run(
    "INSERT INTO audit_log (actor_user_id, action, target_table, target_id, before_json, after_json, created_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)",
    [
      entry.actorUserId,
      entry.action,
      entry.targetTable,
      entry.targetId,
      entry.before !== undefined ? JSON.stringify(entry.before) : null,
      entry.after !== undefined ? JSON.stringify(entry.after) : null,
      new Date().toISOString(),
    ]
  );
}

/** 단독 호출용: 자체적으로 withDbWrite 락을 잡는다. */
export async function recordAuditLog(entry: AuditEntry): Promise<void> {
  await withDbWrite(async (db) => {
    await recordAuditLogInline(db, entry);
  });
}
