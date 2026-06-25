/**
 * 조직 인원(employee_profiles) → 계정(users) 발급 서비스. (PR-A2)
 * - 사번(employee_no)을 로그인 ID(login_id)로, 초기 비밀번호는 사번과 동일 + 강제 변경(must_change_password=1).
 * - 로그인 식별자: 사번 또는 이메일 로컬파트(@앞). 로컬파트 충돌 시 해당 인원은 사번 전용(email_local=NULL).
 *
 * 설계: docs/permission-rbac-redesign.md §7.5 / docs/account-org-unify-plan.md Step 3.
 */

import crypto from "node:crypto";
import { rowsToObjects, withDbWrite } from "../db";
import { recordAuditLogInline } from "./audit";
import { computeEmployeeNo } from "../admin/employee-no";
import { hashPassword } from "./password";

export interface ProvisionResult {
  userId: string;
  loginId: string; // 사번
  tempPassword: string; // 사번과 동일
  emailLocal: string | null; // 이메일 로컬파트(충돌 시 null = 사번 전용)
}

/** 이메일에서 로컬파트(@앞)를 추출. 형식이 아니면 null. */
function localPartOf(email: string | null | undefined): string | null {
  const raw = String(email ?? "").trim().toLowerCase();
  const at = raw.indexOf("@");
  if (at <= 0) return null;
  const local = raw.slice(0, at);
  return local || null;
}

/**
 * 인원에게 사번 계정을 발급한다. 단일 트랜잭션.
 * - 이미 계정이 연결된 인원은 재발급하지 않는다(ALREADY_PROVISIONED).
 * - 필수 필드(입사일/성별/생년월일) 누락 시 MISSING_REQUIRED_FOR_NO.
 */
export async function provisionAccountForEmployee(
  employeeId: string,
  actorUserId: string
): Promise<ProvisionResult> {
  return withDbWrite(async (db) => {
    const empRows = rowsToObjects(
      await db.exec(
        "SELECT employee_id, name, email, user_id, employee_no FROM employee_profiles WHERE employee_id = $1 LIMIT 1",
        [employeeId]
      )
    );
    if (!empRows.length) throw new Error("EMPLOYEE_NOT_FOUND");
    const emp = empRows[0];
    if (emp.user_id != null && String(emp.user_id)) {
      throw new Error("ALREADY_PROVISIONED");
    }
    const name = String(emp.name ?? "").trim();
    if (!name) throw new Error("EMPLOYEE_NAME_REQUIRED");

    // 사번: 기존 값이 있으면 재사용, 없으면 (입사일/성별/생년월일 기준) 계산해 저장.
    let loginId = emp.employee_no != null ? String(emp.employee_no) : "";
    if (!loginId) {
      loginId = await computeEmployeeNo(db, employeeId); // 필수 필드 누락 시 throw
      await db.run(
        "UPDATE employee_profiles SET employee_no = $1, updated_at = $2 WHERE employee_id = $3",
        [loginId, new Date().toISOString(), employeeId]
      );
    }

    // 이메일 로컬파트 — 충돌(이미 동일 email_local 보유) 시 사번 전용으로 NULL.
    let emailLocal = localPartOf(emp.email as string | null);
    if (emailLocal) {
      const conflict = rowsToObjects(
        await db.exec("SELECT user_id FROM users WHERE email_local = $1 LIMIT 1", [emailLocal])
      );
      if (conflict.length) emailLocal = null;
    }

    const userId = "u_" + crypto.randomBytes(8).toString("hex");
    const passwordHash = await hashPassword(loginId); // 초기 비번 = 사번
    // users.email 은 NOT NULL UNIQUE 레거시 컬럼 — 로그인엔 쓰지 않으므로 사번 기반 placeholder.
    const placeholderEmail = `${loginId}@noemail.local`;
    const now = new Date().toISOString();

    await db.run(
      `INSERT INTO users
         (user_id, email, password_hash, name, role, status,
          login_id, email_local, must_change_password, employee_id, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'viewer', 'active', $5, $6, 1, $7, $8, $9, $9)`,
      [userId, placeholderEmail, passwordHash, name, loginId, emailLocal, employeeId, actorUserId, now]
    );

    await db.run(
      "UPDATE employee_profiles SET user_id = $1, updated_at = $2 WHERE employee_id = $3",
      [userId, now, employeeId]
    );

    // 직급 기본 권한 템플릿 자동 부여(044 와 동일 규칙·assignment_id 로 멱등).
    const tplRows = rowsToObjects(
      await db.exec(
        `SELECT pdt.template_id, pdt.scope_kind_default, pdt.scope_dept_default
           FROM employee_profiles ep
           JOIN position_default_templates pdt ON pdt.position_id = ep.position_id
          WHERE ep.employee_id = $1`,
        [employeeId]
      )
    );
    for (const t of tplRows) {
      const templateId = String(t.template_id ?? "");
      if (!templateId) continue;
      await db.run(
        `INSERT INTO user_permission_assignments
           (assignment_id, user_id, template_id, scope_override_kind, scope_override_dept_id,
            effective_from, reason, assigned_by, assigned_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $6)
         ON CONFLICT (assignment_id) DO NOTHING`,
        [
          `auto-${userId}-${templateId}`,
          userId,
          templateId,
          t.scope_kind_default != null ? String(t.scope_kind_default) : null,
          t.scope_dept_default != null ? String(t.scope_dept_default) : null,
          now,
          "직급 기본 권한 템플릿 자동 부여(발급)",
          actorUserId,
        ]
      );
    }

    await recordAuditLogInline(db, {
      actorUserId,
      action: "account_provision",
      targetTable: "users",
      targetId: userId,
      after: { loginId, employeeId, emailLocal },
    });

    return { userId, loginId, tempPassword: loginId, emailLocal };
  });
}
