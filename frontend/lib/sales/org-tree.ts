import type { OrganizationSnapshot } from "@/components/admin/users/types";

// 담당인력/담당자 선택 조직도: 차장(rank>=60) 이상, 특정 인원 제외.
const MIN_ASSIGNEE_RANK = 60;
const EXCLUDE_NAMES = ["한상순"];

export function filterAssigneeTree(snapshot: OrganizationSnapshot | null): OrganizationSnapshot | null {
  if (!snapshot) return null;
  const emps = snapshot.employees.filter(
    (e) => (e.positionRankOrder ?? 0) >= MIN_ASSIGNEE_RANK && !EXCLUDE_NAMES.includes(e.name)
  );
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
