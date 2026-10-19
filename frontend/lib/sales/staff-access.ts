// 영업 담당자(sales_assignees, 150) ↔ 영업 메뉴 권한(tpl-sales-staff, 298) 동기화.
//
// 2026-10-19 사용자 결정: 영업/마케팅 메뉴는 Salesboard "영업 제설정 > 영업 담당자 설정"에서 조직도로 지정한
// 영업 담당자와 대표이사·관리자에게만 열린다. 지정 목록이 바뀔 때마다 이 함수가 계정 단위 템플릿 부여를 맞춘다.
//   - 지정됐고 계정이 있는 활성 직원 → tpl-sales-staff 부여(assignment_id = sales-staff-<user_id>, 회수됐던 행은 되살림)
//   - 지정에서 빠진 계정 → 회수(revoked_at)
// 메뉴 노출은 세션 권한 요약(JWT)을 쓰므로 대상자가 다시 로그인해야 반영되고, API 판정은 즉시 반영된다.

import { rowsToObjects, type PgDatabase } from "@/lib/db";

export const SALES_STAFF_TEMPLATE_ID = "tpl-sales-staff";

/** 트랜잭션 안에서 호출한다(withDbWrite). 템플릿이 없으면(298 미적용) 아무것도 하지 않는다. */
export async function syncSalesStaffGrants(db: PgDatabase, actorUserId: string | null): Promise<{ granted: number; revoked: number }> {
  const tpl = rowsToObjects(
    await db.exec("SELECT 1 AS ok FROM permission_templates WHERE template_id = $1 AND is_active = 1 LIMIT 1", [SALES_STAFF_TEMPLATE_ID])
  );
  if (!tpl.length) return { granted: 0, revoked: 0 };

  const desired = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT u.user_id
         FROM sales_assignees sa
         JOIN employee_profiles ep ON ep.employee_id = sa.employee_id AND ep.status = 'active'
         JOIN users u ON (u.employee_id = ep.employee_id OR u.user_id = ep.user_id) AND u.status = 'active'`
    )
  ).map((r) => String(r.user_id));

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  let granted = 0;
  for (const userId of desired) {
    const res = rowsToObjects(
      await db.exec(
        `INSERT INTO user_permission_assignments
           (assignment_id, user_id, template_id, scope_override_kind, scope_override_dept_id,
            effective_from, reason, assigned_by, assigned_at)
         VALUES ($1, $2, $3, NULL, NULL, $4, '영업 담당자 지정(영업 제설정)', $5, $6)
         ON CONFLICT (assignment_id) DO UPDATE
           SET revoked_at = NULL, revoked_by = NULL, effective_from = EXCLUDED.effective_from,
               assigned_by = EXCLUDED.assigned_by, assigned_at = EXCLUDED.assigned_at
         WHERE user_permission_assignments.revoked_at IS NOT NULL
         RETURNING assignment_id`,
        [`sales-staff-${userId}`, userId, SALES_STAFF_TEMPLATE_ID, today, actorUserId, now]
      )
    );
    granted += res.length;
  }

  const revoked = rowsToObjects(
    await db.exec(
      `UPDATE user_permission_assignments
          SET revoked_at = $1, revoked_by = $2
        WHERE template_id = $3 AND revoked_at IS NULL
          AND NOT (user_id = ANY($4::text[]))
        RETURNING assignment_id`,
      [now, actorUserId, SALES_STAFF_TEMPLATE_ID, desired]
    )
  ).length;

  return { granted, revoked };
}
