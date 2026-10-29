import { grantDeptIds, type UserAccess } from "@/lib/auth/rbac";
import { listSalesProjects } from "./queries";
import type { SalesProject, SalesProjectFilter } from "./types";

/**
 * 사용자에게 보이는 영업건 목록. 목록도 단건 가드(target.projectId)와 같은 범위로 거른다(X-03, 2026-10-19):
 *   all = 전사 / self_dept·specific_dept = 담당 부서가 그 부서인 건 + 본인이 관계자인 건 / participant·self = 본인이 관계자인 건.
 * /api/sales/projects 목록과 /api/sales/board-stats 집계가 같은 범위를 쓰도록 한곳에 둔다(2026-10-29).
 */
export async function listVisibleSalesProjects(access: UserAccess, filter: SalesProjectFilter = {}): Promise<SalesProject[]> {
  const projects = await listSalesProjects(filter);
  const grants = access.grants.filter((g) => g.permissionKey === "sales.view" && g.effect === "allow");
  if (grants.some((g) => g.scopeKind === "all")) return projects;
  const deptIds = new Set<string>();
  for (const g of grants) {
    for (const d of grantDeptIds(access, g)) deptIds.add(d); // self_dept = 보직 부서 전체(겸직 300)
  }
  return projects.filter(
    (p) => (p.ownerDeptId != null && deptIds.has(String(p.ownerDeptId))) || access.participantProjectIds.has(p.projectId)
  );
}
