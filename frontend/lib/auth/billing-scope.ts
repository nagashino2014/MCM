/**
 * 수주/수금/발행 현황 API 의 계약 범위 판정 — 전사 현황(billing.view)과 부서장 현황(billing.dept.view, 299) 공용.
 *
 *   ?scope=dept[&dept=<deptId>] → billing.dept.view 로 판정하고 **수행부서(contracts.owning_dept_id)가 그 부서인 계약만**
 *                                 (2026-10-19 사용자 결정: 부서원이 참여한 타 부서 계약은 제외 — 부서 간 중복 집계 방지).
 *                                 self_dept 는 본인 소속 부서로 고정, all(관리자)은 dept 파라미터로 고른다.
 *   그 외                       → 종전대로 billing.view + resolveVisibleContractIds(298 이후 관리자·인사/회계·대표이사).
 */

import { getDb, rowsToObjects } from "@/lib/db";
import { AuthError, requirePermission, type AuthContext } from "./guards";
import { resolveVisibleContractIds } from "./contract-scope";
import { loadUserAccess, resolveDeptScope } from "./rbac";

export const DEPT_BILLING_KEY = "billing.dept.view";

export interface BillingDept {
  deptId: string;
  deptName: string;
}

export interface BillingScope {
  ctx: AuthContext;
  /** null = 전사(필터 없음), 배열 = 해당 계약만 */
  ids: string[] | null;
  /** scope=dept 일 때 선택된 부서와 고를 수 있는 부서 목록 */
  dept: BillingDept | null;
  depts: BillingDept[];
}

async function loadDepts(deptIds: string[] | null): Promise<BillingDept[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      deptIds
        ? "SELECT dept_id, dept_name FROM departments WHERE dept_id = ANY($1::text[]) ORDER BY display_order NULLS LAST, dept_name"
        : "SELECT dept_id, dept_name FROM departments WHERE is_active = 1 ORDER BY display_order NULLS LAST, dept_name",
      deptIds ? [deptIds] : []
    )
  );
  return rows.map((r) => ({ deptId: String(r.dept_id), deptName: String(r.dept_name ?? r.dept_id) }));
}

/** 수행부서가 deptId 인 계약 id. */
export async function loadDeptContractIds(deptId: string): Promise<string[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT contract_id FROM contracts WHERE owning_dept_id = $1 AND deleted_at IS NULL", [deptId])
  );
  return rows.map((r) => String(r.contract_id));
}

export async function requireBillingScope(sp: URLSearchParams): Promise<BillingScope> {
  if (sp.get("scope") !== "dept") {
    const ctx = await requirePermission("billing.view");
    return { ctx, ids: await resolveVisibleContractIds(ctx.userId, "billing.view"), dept: null, depts: [] };
  }

  const ctx = await requirePermission(DEPT_BILLING_KEY);
  const access = await loadUserAccess(ctx.userId);
  const scope = resolveDeptScope(access, DEPT_BILLING_KEY);
  if (scope.kind === "none") throw new AuthError("이 작업을 수행할 권한이 없습니다.", 403);

  const depts = await loadDepts(scope.kind === "all" ? null : scope.deptIds);
  if (depts.length === 0) return { ctx, ids: [], dept: null, depts };

  const requested = sp.get("dept");
  // 부서장(self_dept)은 요청 값과 관계없이 허용 부서 안에서만 — 허용 밖 요청은 본인 부서로 되돌린다.
  const dept = depts.find((d) => d.deptId === requested) ?? depts[0];
  return { ctx, ids: await loadDeptContractIds(dept.deptId), dept, depts };
}
