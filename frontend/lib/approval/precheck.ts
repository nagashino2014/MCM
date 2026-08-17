/**
 * 상신 전 사전검토 — 결정적 규칙 엔진(AX-P3, 서버). LLM 없이 확실히 잡을 수 있는 것은 여기서.
 * 규칙: 본인 결재(self_approval)·연차 잔여(leave_balance)·금액 상한(amount_limit)·필수 필드(required_field).
 * 결과 level: block(상신 불가)·warn(경고 후 상신 허용)·info(참고). 기본 warn, 정책에서 block 승격(§8-3).
 * overtime_limit 규칙은 AX-P4(근태 연동)에서 값 계산을 연결한다(여기서는 미평가).
 * 설계: docs/e-approval-differentiation-blueprint.md §9-4.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { parseFields, type ApprovalFieldDef } from "@/lib/approval/fields";
import { getMyLeaveRemaining } from "@/lib/approval/leave";

export type PrecheckLevel = "block" | "warn" | "info";
export interface PrecheckFinding {
  level: PrecheckLevel;
  message: string;
  source: string; // 규칙 종류(설명용)
}

export interface FormPolicy {
  policyId: string;
  fieldKey: string | null;
  kind: string;
  config: Record<string, unknown>;
  severity: PrecheckLevel;
}

export async function listFormPolicies(formId: string): Promise<FormPolicy[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT policy_id, field_key, kind, config, severity FROM approval_form_policies WHERE form_id = $1 AND active = 1`, [formId])
  );
  return rows.map((r) => {
    let config: Record<string, unknown> = {};
    try {
      const v = typeof r.config === "string" ? JSON.parse(r.config) : r.config;
      if (v && typeof v === "object") config = v as Record<string, unknown>;
    } catch {
      // 무시
    }
    return {
      policyId: String(r.policy_id),
      fieldKey: r.field_key != null ? String(r.field_key) : null,
      kind: String(r.kind),
      config,
      severity: String(r.severity) === "block" ? "block" : "warn",
    };
  });
}

/** 양식 정책 전체 교체 저장(admin). */
export async function saveFormPolicies(
  formId: string,
  policies: { fieldKey: string | null; kind: string; config: Record<string, unknown>; severity: string }[]
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM approval_form_policies WHERE form_id = $1`, [formId]);
    for (const p of policies) {
      if (!p.kind) continue;
      await db.run(
        `INSERT INTO approval_form_policies (policy_id, form_id, field_key, kind, config, severity, active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, 1, $7, $7)`,
        [
          "apol-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14),
          formId,
          p.fieldKey || null,
          p.kind,
          JSON.stringify(p.config ?? {}),
          p.severity === "block" ? "block" : "warn",
          now,
        ]
      );
    }
  });
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function labelOf(fields: ApprovalFieldDef[], key: string | null): string {
  if (!key) return "";
  return fields.find((f) => f.key === key)?.label ?? key;
}

/** 저장된 draft 문서에 대해 규칙 검사를 수행한다. */
export async function runRuleChecks(docId: string): Promise<PrecheckFinding[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.form_id, d.form_version, d.field_values, d.drafter_user_id, f.name AS form_name,
              COALESCE(v.fields, f.fields) AS render_fields
         FROM approval_docs d
         JOIN approval_forms f ON f.form_id = d.form_id
         LEFT JOIN approval_form_versions v ON v.form_id = d.form_id AND v.version = d.form_version
        WHERE d.doc_id = $1`,
      [docId]
    )
  );
  if (!rows.length) return [];
  const r = rows[0];
  const formId = String(r.form_id);
  const fields = parseFields(r.render_fields);
  let values: Record<string, unknown> = {};
  try {
    const v = typeof r.field_values === "string" ? JSON.parse(r.field_values) : r.field_values;
    if (v && typeof v === "object") values = v as Record<string, unknown>;
  } catch {
    // 무시
  }
  const drafterUserId = r.drafter_user_id != null ? String(r.drafter_user_id) : null;

  const findings: PrecheckFinding[] = [];

  // 규칙 1: 본인 결재(기안자가 결재선에 포함) — 항상 검사
  if (drafterUserId) {
    const selfStep = rowsToObjects(
      await db.exec(`SELECT count(*) AS c FROM approval_steps WHERE doc_id = $1 AND assignee_user_id = $2`, [docId, drafterUserId])
    );
    if (Number(selfStep[0]?.c ?? 0) > 0) {
      findings.push({ level: "warn", message: "기안자 본인이 결재선에 포함되어 있습니다. 결재선을 확인하세요.", source: "self_approval" });
    }
  }

  // 규칙 2: 연차 잔여(휴가신청 양식) — 항상 검사(정책 있으면 severity 적용)
  if (formId === "frm-leave-request" && drafterUserId) {
    const useDays = toNumber(values.use_days);
    if (useDays != null && useDays > 0) {
      const year = new Date().toISOString().slice(0, 4);
      const rem = await getMyLeaveRemaining(drafterUserId, year);
      if (rem && useDays > rem.remaining) {
        const pol = (await listFormPolicies(formId)).find((p) => p.kind === "leave_balance");
        findings.push({
          level: pol?.severity ?? "warn",
          message: `신청 일수(${useDays}일)가 잔여 연차(${rem.remaining}일)를 초과합니다.`,
          source: "leave_balance",
        });
      }
    }
  }

  // 규칙 3: 연간 예산(지출결의류 — 예산이 등록된 카테고리만, P6-C). 정책 없이도 warn, 정책으로 block 승격.
  if (formId === "frm-expense-report" || formId === "frm-biz-trip-report") {
    try {
      const { checkBudgetForExpenseValues } = await import("@/lib/finance/budget");
      const year = Number(new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 4));
      const budgetFindings = await checkBudgetForExpenseValues(values, year);
      if (budgetFindings.length) {
        const pol = (await listFormPolicies(formId)).find((p) => p.kind === "budget_limit");
        for (const f of budgetFindings) {
          const fmt = (n: number) => n.toLocaleString("ko-KR");
          findings.push({
            level: f.over ? pol?.severity ?? "warn" : "info",
            message: f.over
              ? `${f.categoryLabel} 연간 예산 초과 — 예산 ${fmt(f.budget)} / 집행 ${fmt(f.spent)} / 신청 ${fmt(f.requested)} (잔액 ${fmt(f.remainingAfter)})`
              : `${f.categoryLabel} 예산 잔액 ${fmt(f.remainingAfter)}원 (예산 ${fmt(f.budget)} · 집행 ${fmt(f.spent)} · 이번 신청 ${fmt(f.requested)})`,
            source: "budget_limit",
          });
        }
      }
    } catch {
      // 예산 테이블 미적용(마이그 전) 등 — 사전검토는 조용히 통과
    }
  }

  // 정책 기반 규칙(금액 상한·필수 필드)
  const policies = await listFormPolicies(formId);
  for (const p of policies) {
    if (p.kind === "amount_limit" && p.fieldKey) {
      const max = toNumber(p.config.max);
      const val = toNumber(values[p.fieldKey]);
      if (max != null && val != null && val > max) {
        findings.push({
          level: p.severity,
          message: `${labelOf(fields, p.fieldKey)} 금액(${val.toLocaleString("ko-KR")})이 상한(${max.toLocaleString("ko-KR")})을 초과합니다.`,
          source: "amount_limit",
        });
      }
    } else if (p.kind === "required_field" && p.fieldKey) {
      const val = values[p.fieldKey];
      const empty = val == null || (typeof val === "string" && !val.trim()) || (Array.isArray(val) && val.length === 0);
      if (empty) {
        const msg = p.config.message ? String(p.config.message) : `${labelOf(fields, p.fieldKey)} 항목이 필요합니다.`;
        findings.push({ level: p.severity, message: msg, source: "required_field" });
      }
    }
  }

  return findings;
}
