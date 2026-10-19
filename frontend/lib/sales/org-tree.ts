import type { OrganizationSnapshot } from "@/components/admin/users/types";

// 담당인력/담당자 선택 조직도: 차장(rank>=60) 이상, 특정 인원 제외.
// 이 규칙에 걸리지 않는 인원은 '영업 담당 추가'(sales_assignees, 150)로 개별 등록한다.
// 서버(lib/sales/queries.ts)도 같은 상수를 참조하므로 값은 여기 한 곳에서만 바꾼다.
export const MIN_ASSIGNEE_RANK = 60;
export const ASSIGNEE_EXCLUDE_NAMES = ["한상순"];

/** 직급 규칙 통과 인원 ∪ extraEmployeeIds(수동 등록 영업 담당자)로 조직도를 좁힌다. */
export function filterAssigneeTree(
  snapshot: OrganizationSnapshot | null,
  extraEmployeeIds?: Iterable<string>
): OrganizationSnapshot | null {
  if (!snapshot) return null;
  const extra = new Set(extraEmployeeIds ?? []);
  const emps = snapshot.employees.filter(
    (e) =>
      extra.has(e.employeeId) ||
      ((e.positionRankOrder ?? 0) >= MIN_ASSIGNEE_RANK && !ASSIGNEE_EXCLUDE_NAMES.includes(e.name))
  );
  return withKeptDepartments(snapshot, emps);
}

/**
 * 영업 담당자(sales_assignees)로 지정된 인원만 남긴 조직도 — 프로젝트 담당자 선택용(2026-10-19, 298).
 * 직급 규칙은 쓰지 않는다: 영업 메뉴 권한이 지정 인원에게만 있으므로 담당자도 지정 인원 중에서 고른다.
 */
export function filterSalesStaffTree(
  snapshot: OrganizationSnapshot | null,
  staffEmployeeIds: Iterable<string>
): OrganizationSnapshot | null {
  if (!snapshot) return null;
  const staff = new Set(staffEmployeeIds);
  return withKeptDepartments(snapshot, snapshot.employees.filter((e) => staff.has(e.employeeId)));
}

/** filterAssigneeTree 의 여집합 — 아직 영업 담당이 아닌 인원만 남긴 조직도('영업 담당 추가'용). */
export function filterNonAssigneeTree(
  snapshot: OrganizationSnapshot | null,
  assigneeEmployeeIds: Iterable<string>
): OrganizationSnapshot | null {
  if (!snapshot) return null;
  const assigned = new Set(assigneeEmployeeIds);
  const emps = snapshot.employees.filter((e) => !assigned.has(e.employeeId));
  return withKeptDepartments(snapshot, emps);
}

/** 남은 인원이 속한 부서와 그 상위 부서만 유지한다(빈 부서 가지치기). */
function withKeptDepartments(
  snapshot: OrganizationSnapshot,
  emps: OrganizationSnapshot["employees"]
): OrganizationSnapshot {
  const byId = new Map(snapshot.departments.map((d) => [d.deptId, d]));
  const keep = new Set<string>();
  for (const e of emps) {
    let cur: string | null = e.deptId ?? null;
    while (cur && !keep.has(cur)) {
      keep.add(cur);
      cur = byId.get(cur)?.parentDeptId ?? null;
    }
  }
  return { ...snapshot, employees: emps, departments: snapshot.departments.filter((d) => keep.has(d.deptId)) };
}
