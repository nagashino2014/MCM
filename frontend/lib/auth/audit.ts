/**
 * audit_log 기록 헬퍼.
 * - 마스터 변경(검수→마스터 sync, facility 병합/수정/수동등록, 사용자 관리)에서 호출.
 * - withDbWrite 내부에서 호출하면 트랜잭션 충돌이 발생하므로, 동일 트랜잭션 안에서 직접 INSERT 하는 방식도 별도로 노출.
 *
 * PostgreSQL 마이그레이션 후로는 wrapper PgDatabase.run() 이 async 이므로 호출자 측에서 await 가 필수.
 */

import { PgDatabase, withDbWrite } from "../db";

export type AuditAction =
  | "finance_journal_use"
  | "finance_supply_same_review"
  | "finance_supply_group_review"
  | "finance_document_register"
  | "finance_supply_review"
  | "finance_recognition_review"
  | "finance_vat_filing_basis"
  | "finance_card_merchant_correction"
  | "ai_settings_change" // AI API 관리 — 기능별 모델·단가·설정 변경(docs/ai-api-usage-management-blueprint.md §3.6)
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
  | "agency_report_create"
  | "agency_report_update"
  | "agency_report_delete"
  | "permit_create"
  | "permit_update"
  | "permit_delete"
  | "annual_report_update"
  | "annual_report_delete"
  | "user_create"
  | "user_update"
  | "user_delete"
  | "user_purge"
  | "user_password_reset"
  | "account_provision"
  | "permission_template_update"
  | "permission_assignment_update"
  | "employee_update"
  | "company_profile_update"
  | "employee_document_upload"
  | "employee_hr_event_create"
  | "employee_hr_event_delete"
  | "work_plan_save"
  | "work_plan_delete"
  | "trash_purge"
  | "trash_restore"
  | "approval_form_update"
  | "approval_action_rerun"
  | "approval_form_actions_update"
  | "certificate_issue"
  | "certificate_deliver"
  | "expense_settlement_run"
  | "expense_settlement_cms"
  | "expense_settlement_vat_send"
  | "severance_settlement_update"
  | "absence_request_create"
  | "absence_request_cancel"
  | "approval_doc_submit"
  | "approval_doc_act"
  | "approval_doc_cancel"
  | "approval_absence_create"
  | "approval_absence_cancel"
  | "approval_default_delegate_update"
  | "approval_final_rule_create"
  | "approval_final_rule_delete"
  | "approval_doc_delete"
  | "approval_doc_recall"
  | "letter_import"
  | "letter_import_delete"
  | "approval_cancel_request"
  | "approval_leave_update"
  | "approval_leave_notice_template"
  | "approval_leave_notice_send"
  | "approval_leave_notice_submit"
  | "asset_document_upload"
  | "file_library_open"
  | "file_library_delete"
  | "file_retention_purge"
  | "adt_attendance_map"
  | "adt_attendance_settings"
  | "adt_attendance_upload"
  | "adt_attendance_exclude"
  | "adt_attendance_ignore"
  | "adt_attendance_schedule"
  | "overtime_match_override"
  | "overtime_meal_action"
  | "payroll_ledger_import" // 급여대장 엑셀 가져오기 — 확정 대장 신규·덮어쓰기 적재
  | "company_holiday_set"
  | "approval_notify_settings_update"
  | "approval_ai_summary"
  | "approval_policy_update"
  | "approval_semantic_update"
  | "approval_metric_update"
  | "approval_doc_relink" // 관계 맵 직접 입력 보정 — 이관 문서 등의 계약·사업장 직접 입력을 마스터에 연결(2026-10-21)
  | "approval_precheck_llm"
  | "mail_send"
  | "attachment_policy_change" // 첨부 확장자 정책(262) — 전사 기본·인원별 예외 변경
  | "auth_find_id"
  | "auth_password_reset"
  | "admin_password_sync"
  | "alert.ack"
  | "finance_connection_stop"
  | "finance_connection_resume"
  | "finance_sync_run"
  | "finance_statement_import"
  | "finance_card_meta_update"
  | "finance_recon_run"
  | "finance_recon_confirm"
  | "tax_invoice_issue"
  | "tax_invoice_cancel"
  | "journal_regenerate"
  | "journal_confirm_bulk"
  | "journal_card_expense_kind"
  | "journal_ledger_import"
  | "journal_ledger_import_delete"
  | "hometax_scrap_regist"
  | "hometax_sync"
  | "vat_return_save"
  | "vat_return_confirm"
  | "yearend_save"
  | "yearend_status"
  | "fixed_asset_save"
  | "trip_log_sync"
  | "fiscal_close"
  | "rule_version_import"
  | "rule_version_update"
  | "rule_version_publish"
  | "rule_version_delete"
  | "internal_rule_create"
  | "internal_rule_update"
  | "internal_rule_delete"
  | "internal_rule_revise"
  | "dept_post_create"
  | "dept_post_revoke"
  // 회사소개서(309·310) — 실적 대외 표기·표시 범위·인물·자문위원·고객사
  | "catalog_update"
  // 회사소개서 PDF 생성본(P4 렌더러, catalog_editions)
  | "catalog_render"
  // 회사소개서 발행(P7) — 발행본 확정·배포 기록
  | "catalog_publish"
  | "catalog_distribution";

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
