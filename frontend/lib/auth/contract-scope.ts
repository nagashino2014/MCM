/**
 * 계약 가시성(목록·집계) 해석. (B2)
 * 단건 가드는 rbac.ts checkPermission(+target.contractId)이 처리하고,
 * 목록/대시보드/billing 집계는 이 헬퍼가 반환하는 범위를 WHERE 절로 변환해 거른다.
 *
 * 설계: docs/permission-rbac-redesign.md §3.5.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import { loadUserAccess } from "./rbac";

export type ContractScope =
  | { kind: "all" } // 전사 — 필터 없음
  | { kind: "dept"; deptIds: string[] } // 부서장: owning_dept ∈ depts OR 부서원 참여
  | { kind: "participant"; employeeId: string } // 실무자: 본인 참여(종료 포함)
  | { kind: "none" }; // 가시 계약 없음 — 빈 결과

/**
 * permissionKey(contract.view | billing.view)에 대해 사용자가 볼 수 있는 계약 범위를 해석.
 * 가장 넓은 grant 우선. (deny 는 현재 카탈로그에 없어 미반영 — 추가 시 deny-overrides 적용 필요)
 */
export async function resolveContractScope(
  userId: string,
  permissionKey: string
): Promise<ContractScope> {
  const access = await loadUserAccess(userId);
  // role 우회 제거 — 전사 범위는 grant 의 scope=all 로만 판정한다(아래 로직이 처리).

  const grants = access.grants.filter(
    (g) => g.permissionKey === permissionKey && g.effect === "allow"
  );
  if (grants.length === 0) return { kind: "none" };

  if (grants.some((g) => g.scopeKind === "all")) return { kind: "all" };

  const deptIds = new Set<string>();
  for (const g of grants) {
    if (g.scopeKind === "self_dept" && access.deptId) deptIds.add(access.deptId);
    if (g.scopeKind === "specific_dept" && g.scopeDeptId) deptIds.add(g.scopeDeptId);
  }
  if (deptIds.size > 0) return { kind: "dept", deptIds: [...deptIds] };

  if (grants.some((g) => g.scopeKind === "participant" || g.scopeKind === "self")) {
    // 계정-직원 미연결이면 가시 계약 0건(none).
    return access.employeeId ? { kind: "participant", employeeId: access.employeeId } : { kind: "none" };
  }

  return { kind: "none" };
}

/**
 * 사용자가 볼 수 있는 계약 id 목록으로 해석한다. 분산된 billing 집계 함수들이 공통으로 쓰기 좋게,
 * scope 를 미리 contract_id 배열로 펼친다.
 * - 반환 null = 전사(필터 없음), [] = 가시 계약 없음, [ids] = 해당 계약만.
 * 호출부는 null 이면 필터를 걸지 않고, 배열이면 `c.contract_id = ANY($n)` 한 조건만 추가하면 된다.
 */
/** RBAC 강제 전까지(롤아웃 §10) 목록 scope 필터를 적용하지 않는다(기존 전체 노출 유지). */
const RBAC_ENFORCE = process.env.RBAC_ENFORCE === "true";

export async function resolveVisibleContractIds(
  userId: string,
  permissionKey: string
): Promise<string[] | null> {
  if (!RBAC_ENFORCE) return null; // 호환 모드: 필터 없음
  const scope = await resolveContractScope(userId, permissionKey);
  if (scope.kind === "all") return null;
  if (scope.kind === "none") return [];

  const db = await getDb();
  if (scope.kind === "dept") {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT DISTINCT c.contract_id
           FROM contracts c
          WHERE c.owning_dept_id = ANY($1)
             OR EXISTS (
               SELECT 1 FROM service_participants sp
               JOIN employee_profiles ep ON ep.employee_id = sp.employee_id
               WHERE sp.contract_id = c.contract_id AND ep.dept_id = ANY($1)
             )`,
        [scope.deptIds]
      )
    );
    return rows.map((r) => String(r.contract_id));
  }
  // participant
  const rows = rowsToObjects(
    await db.exec(
      "SELECT DISTINCT contract_id FROM service_participants WHERE employee_id = $1",
      [scope.employeeId]
    )
  );
  return rows.map((r) => String(r.contract_id));
}

/**
 * ContractScope 를 SQL WHERE 조각으로 변환한다. 호출자는 파라미터 바인더(addParam)를 넘긴다.
 * `alias` 는 contracts 테이블 별칭(예: "c"). 반환된 조각을 where 배열에 push 하면 된다.
 * 종료된 참여도 포함하기 위해 participated_to 조건은 두지 않는다(§3.5-1 확정).
 */
export function contractScopeWhere(
  scope: ContractScope,
  alias: string,
  addParam: (value: unknown) => string
): string | null {
  switch (scope.kind) {
    case "all":
      return null; // 필터 없음
    case "dept": {
      const d = addParam(scope.deptIds);
      return `(${alias}.owning_dept_id = ANY(${d}) OR EXISTS (
        SELECT 1 FROM service_participants sp
        JOIN employee_profiles ep ON ep.employee_id = sp.employee_id
        WHERE sp.contract_id = ${alias}.contract_id AND ep.dept_id = ANY(${d})
      ))`;
    }
    case "participant": {
      const e = addParam(scope.employeeId);
      return `EXISTS (
        SELECT 1 FROM service_participants sp
        WHERE sp.contract_id = ${alias}.contract_id AND sp.employee_id = ${e}
      )`;
    }
    case "none":
      return "FALSE";
    default:
      return "FALSE";
  }
}
