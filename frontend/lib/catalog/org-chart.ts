import { listOrganizationSnapshot } from "@/lib/admin/organization";
import type { OrgChartDoc, OrgNode } from "./content-types";
import { listExtraPeople } from "./people";

/*
 * 회사소개서 조직도(C12) 기본안 — MCM 조직 마스터(부서·부서장 보직·재직자)에서 만든다(사용자 요구 10-22).
 * 사용자는 이 기본안을 소개서 전용으로 고쳐 확정한다(contents.ts org_chart). 다시 불러오기를 누르면 이 함수 결과로 바뀐다.
 *   최상위 = 대표이사(직급 '대표이사' 재직자), 그 아래 = 직접 입력 촉탁 임원(고문 등, '촉탁' 표시) + 최상위 부서(총괄 제외).
 *   부서 상자의 아래 줄 = 부서장 · 인원(그 부서 재직자 수), 하위 부서는 자식 상자.
 */

const EXEC_DEPT_ID = "exec";

export async function buildOrgChartFromMaster(): Promise<OrgChartDoc> {
  const [snap, extras] = await Promise.all([listOrganizationSnapshot(), listExtraPeople()]);
  const active = snap.employees.filter((e) => e.status === "active");
  const depts = snap.departments.filter((d) => d.isActive);
  const byParent = new Map<string | null, typeof depts>();
  for (const d of depts) {
    const key = d.parentDeptId && depts.some((p) => p.deptId === d.parentDeptId) ? d.parentDeptId : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(d);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.displayOrder - b.displayOrder || a.deptName.localeCompare(b.deptName, "ko"));

  const headOf = (deptId: string) => {
    const heads = snap.deptHeads.filter((h) => h.deptId === deptId);
    return (heads.find((h) => h.isPrimary) ?? heads[0])?.name ?? "";
  };
  const deptNode = (d: (typeof depts)[number], depth: number): OrgNode => {
    const n = active.filter((e) => e.deptId === d.deptId).length;
    const head = headOf(d.deptId);
    return {
      id: `dept:${d.deptId}`,
      label: d.deptName,
      sub: [head && `${head}`, n > 0 && `${n}명`].filter(Boolean).join(" · "),
      badge: "",
      children: depth >= 4 ? [] : (byParent.get(d.deptId) ?? []).map((c) => deptNode(c, depth + 1)),
    };
  };

  const ceo = active.find((e) => e.positionName === "대표이사") ?? null;
  const publicExtras = extras.filter((x) => x.isPublic);
  const children: OrgNode[] = [];
  if (publicExtras.length) {
    // 고문 등 촉탁 임원 — 직함별로 묶어 한 상자(예: 고문 홍길동·김철수)
    const byRole = new Map<string, string[]>();
    for (const x of publicExtras) {
      const role = x.roleLabel || "고문";
      if (!byRole.has(role)) byRole.set(role, []);
      byRole.get(role)!.push(x.name);
    }
    for (const [role, names] of byRole) {
      children.push({ id: `extra:${role}`, label: role, sub: names.join(" · "), badge: "촉탁", children: [] });
    }
  }
  for (const d of byParent.get(null) ?? []) {
    if (d.deptId === EXEC_DEPT_ID) continue; // 총괄(임원 소속)은 대표이사 상자가 대신한다
    children.push(deptNode(d, 2));
  }
  return {
    nodes: [{ id: "root", label: "대표이사", sub: ceo?.name ?? "", badge: "", children }],
  };
}
