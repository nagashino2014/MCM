/**
 * RBAC 런타임 — 권한 템플릿(permission_template_grants) + 인원 적용(user_permission_assignments)
 * 을 평가해 atomic 권한키 + scope 를 검사한다. (블루프린트 §3.2.6)
 *
 * - role 은 판정에 쓰지 않는다(RBAC_ADMIN_BYPASS 비상 우회만 예외). 관리자 권한의 근거는 tpl-system-admin 템플릿.
 * - deny-overrides: 같은 키에 deny 가 있으면 allow 보다 우선.
 * - scope: self / self_dept / specific_dept / all.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import type { Role } from "./users";
import { PERM_ALL_SUFFIX } from "./perms";

export type ScopeKind = "self" | "participant" | "self_dept" | "specific_dept" | "all";

interface GrantRow {
  permissionKey: string;
  scopeKind: ScopeKind;
  scopeDeptId: string | null;
  effect: "allow" | "deny";
}

export interface UserAccess {
  userId: string;
  role: Role;
  /** 주 소속 부서(employee_profiles.dept_id). 급여·인사·기안 기본 부서. */
  deptId: string | null;
  employeeId: string | null;
  /**
   * 활성 보직 부서 — 주 소속(첫 번째) + 겸직(employee_dept_posts, 300). self_dept grant 의 범위 = 이 목록 전체
   * (2026-10-20 겸직 설계 D-2). 겸직이 없으면 [deptId].
   */
  postDeptIds: string[];
  /** 부서장 보직(post_kind='head') 부서 — 주 소속 부서장 행 포함. */
  headDeptIds: Set<string>;
  /** 본인(employee)이 참여자로 등록된 계약 id 집합 — participant scope 평가용(종료 포함). */
  participantContractIds: Set<string>;
  /** 본인(employee)이 관계자로 등록된 영업 프로젝트 id 집합 — sales.* participant scope 평가용. */
  participantProjectIds: Set<string>;
  /** 부서 범위 grant(self_dept·specific_dept)가 가리키는 부서 id 합집합 — 단건 target 판정용(F-06). */
  deptIds: Set<string>;
  /** deptIds 부서가 소유(owning_dept_id)하거나 부서원이 참여한 계약 id 집합 — self_dept + target.contractId 판정용(F-06). */
  deptContractIds: Set<string>;
  /** deptIds 부서가 담당(owner_dept_id)하거나 부서원이 관계자인 영업 프로젝트 id 집합 — self_dept + target.projectId 판정용(F-06). */
  deptProjectIds: Set<string>;
  /** 부서별 계약·영업건 집합 — 부서 범위 단건 판정은 그 grant 가 가리키는 부서의 집합만 본다(겸직 L-1). */
  deptContractsByDept: Map<string, Set<string>>;
  deptProjectsByDept: Map<string, Set<string>>;
  grants: GrantRow[];
}

/** grant 가 가리키는 부서들 — self_dept = 활성 보직 부서 전체, specific_dept = 지정 부서, 그 외 = 없음. */
export function grantDeptIds(
  access: Pick<UserAccess, "postDeptIds">,
  grant: { scopeKind: ScopeKind; scopeDeptId: string | null }
): string[] {
  if (grant.scopeKind === "self_dept") return access.postDeptIds;
  if (grant.scopeKind === "specific_dept") return grant.scopeDeptId ? [grant.scopeDeptId] : [];
  return [];
}

/**
 * 직원의 활성 보직(employee_dept_posts, 300) — 해제(revoked_at)·기간 밖·비활성 부서 행 제외.
 * 300 적용 전 환경(표 없음, 42P01)에서는 빈 배열 — 권한 판정이 마이그 순서 때문에 멈추지 않게 한다.
 */
export async function loadActiveDeptPosts(
  employeeId: string,
  today: string
): Promise<Array<{ deptId: string; postKind: "head" | "member" }>> {
  const db = await getDb();
  try {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT p.dept_id, p.post_kind
           FROM employee_dept_posts p
           JOIN departments d ON d.dept_id = p.dept_id AND d.is_active = 1
          WHERE p.employee_id = $1
            AND p.revoked_at IS NULL
            AND (p.effective_from IS NULL OR p.effective_from = '' OR left(p.effective_from, 10) <= $2)
            AND (p.effective_to IS NULL OR p.effective_to = '' OR left(p.effective_to, 10) >= $2)
          ORDER BY p.is_primary DESC, p.created_at`,
        [employeeId, today]
      )
    );
    return rows.map((r) => ({ deptId: String(r.dept_id), postKind: r.post_kind === "head" ? "head" : "member" }));
  } catch (err) {
    if ((err as { code?: string })?.code === "42P01") return [];
    throw err;
  }
}

export interface PermissionTarget {
  userId?: string;
  deptId?: string;
  contractId?: string;
  projectId?: string;
}

/** 사용자 role·소속부서 + 활성 권한 grants 를 로드한다. */
export async function loadUserAccess(userId: string): Promise<UserAccess> {
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);

  // 소속 부서 = 조직 인원(employee_profiles.dept_id)이 진실원. users.dept_id 는 발급 경로가 채우지 않아 전원 NULL 이라
  // self_dept 판정이 target 이 오면 항상 불일치·없으면 통과였다(F-02, 2026-10-19 실측) → 조직 인원 우선, 없으면 users 값.
  const userRows = rowsToObjects(
    await db.exec(
      `SELECT u.role, COALESCE(ep.dept_id, u.dept_id) AS dept_id, u.employee_id
         FROM users u
         LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
        WHERE u.user_id = $1 LIMIT 1`,
      [userId]
    )
  );
  const role = (String(userRows[0]?.role ?? "member") as Role);
  const deptId = userRows[0]?.dept_id != null ? String(userRows[0].dept_id) : null;
  const employeeId = userRows[0]?.employee_id != null ? String(userRows[0].employee_id) : null;

  // participant scope 평가용: 본인이 참여한 계약 id(종료 포함).
  const participantContractIds = new Set<string>();
  // sales.* participant scope 평가용: 본인이 관계자로 등록된 영업 프로젝트 id.
  const participantProjectIds = new Set<string>();
  if (employeeId) {
    const partRows = rowsToObjects(
      await db.exec("SELECT contract_id FROM service_participants WHERE employee_id = $1", [employeeId])
    );
    for (const r of partRows) {
      if (r.contract_id != null) participantContractIds.add(String(r.contract_id));
    }
    const projRows = rowsToObjects(
      await db.exec("SELECT project_id FROM sales_project_members WHERE employee_id = $1", [employeeId])
    );
    for (const r of projRows) {
      if (r.project_id != null) participantProjectIds.add(String(r.project_id));
    }
  }

  const grantRows = rowsToObjects(
    await db.exec(
      `SELECT g.permission_key, g.scope_kind,
              COALESCE(a.scope_override_kind, g.scope_kind) AS eff_scope_kind,
              COALESCE(a.scope_override_dept_id, g.scope_dept_id) AS eff_scope_dept_id,
              g.effect
         FROM user_permission_assignments a
         JOIN permission_template_grants g ON g.template_id = a.template_id
        WHERE a.user_id = $1
          AND a.revoked_at IS NULL
          AND (a.effective_from IS NULL OR left(a.effective_from, 10) <= $2)
          AND (a.effective_to IS NULL OR left(a.effective_to, 10) >= $2)`,
      [userId, today]
    )
  );

  const grants: GrantRow[] = grantRows.map((row) => ({
    permissionKey: String(row.permission_key ?? ""),
    scopeKind: (String(row.eff_scope_kind ?? row.scope_kind ?? "self") as ScopeKind),
    scopeDeptId: row.eff_scope_dept_id != null ? String(row.eff_scope_dept_id) : null,
    effect: (String(row.effect ?? "allow") as "allow" | "deny"),
  }));

  // 활성 보직(300) — 주 소속을 첫 번째로 두고 겸직 부서를 잇는다. self_dept 범위 = 이 목록 전체(겸직 D-2).
  const postDeptIds: string[] = deptId ? [deptId] : [];
  const headDeptIds = new Set<string>();
  if (employeeId) {
    for (const p of await loadActiveDeptPosts(employeeId, today)) {
      if (!postDeptIds.includes(p.deptId)) postDeptIds.push(p.deptId);
      if (p.postKind === "head") headDeptIds.add(p.deptId);
    }
  }

  // 부서 범위 단건 판정용 집합(F-06, 2026-10-19 실측: 부서장이 타 부서 계약·영업건 단건을 전부 200).
  // self_dept/specific_dept grant 가 하나라도 있을 때만 로드한다. 목록 필터(contract-scope.ts)와 같은 규칙:
  //   계약 = owning_dept_id ∈ 부서 OR 부서원 참여 / 영업건 = owner_dept_id ∈ 부서 OR 부서원 관계자.
  // 부서원 = 주 소속 기준(겸직 D-4). 부서별로 나눠 둔다 — 겸직자의 A부서 grant 가 B부서 계약에 통과하지 않게(L-1).
  const deptIds = new Set<string>();
  for (const g of grants) {
    if (g.effect !== "allow") continue;
    for (const d of grantDeptIds({ postDeptIds }, g)) deptIds.add(d);
  }
  const deptContractIds = new Set<string>();
  const deptProjectIds = new Set<string>();
  const deptContractsByDept = new Map<string, Set<string>>();
  const deptProjectsByDept = new Map<string, Set<string>>();
  const put = (m: Map<string, Set<string>>, all: Set<string>, d: unknown, id: unknown) => {
    if (d == null || id == null) return;
    const key = String(d);
    if (!m.has(key)) m.set(key, new Set());
    m.get(key)!.add(String(id));
    all.add(String(id));
  };
  if (deptIds.size > 0) {
    const depts = [...deptIds];
    const cRows = rowsToObjects(
      await db.exec(
        `SELECT c.owning_dept_id AS dept_id, c.contract_id
           FROM contracts c
          WHERE c.owning_dept_id = ANY($1)
         UNION
         SELECT ep.dept_id, sp.contract_id
           FROM service_participants sp
           JOIN employee_profiles ep ON ep.employee_id = sp.employee_id
          WHERE ep.dept_id = ANY($1)`,
        [depts]
      )
    );
    for (const r of cRows) put(deptContractsByDept, deptContractIds, r.dept_id, r.contract_id);
    const pRows = rowsToObjects(
      await db.exec(
        `SELECT p.owner_dept_id AS dept_id, p.project_id
           FROM sales_projects p
          WHERE p.owner_dept_id = ANY($1)
         UNION
         SELECT ep.dept_id, m.project_id
           FROM sales_project_members m
           JOIN employee_profiles ep ON ep.employee_id = m.employee_id
          WHERE ep.dept_id = ANY($1)`,
        [depts]
      )
    );
    for (const r of pRows) put(deptProjectsByDept, deptProjectIds, r.dept_id, r.project_id);
  }

  return {
    userId, role, deptId, employeeId,
    postDeptIds, headDeptIds,
    participantContractIds, participantProjectIds,
    deptIds, deptContractIds, deptProjectIds,
    deptContractsByDept, deptProjectsByDept,
    grants,
  };
}

/**
 * 부서 범위 grant 의 단건 판정 — grant 가 가리키는 부서 중 하나가 target 의 계약·영업건·부서(주어진 것)를
 * 모두 만족해야 한다(F-06). 부서별 집합으로 본다 — 겸직자의 A부서 grant 가 B부서 계약에 통과하지 않는다(L-1).
 */
function deptScopeMatches(access: UserAccess, grantDepts: readonly string[], target: PermissionTarget): boolean {
  return grantDepts.some((d) => {
    if (target.contractId != null && !access.deptContractsByDept.get(d)?.has(target.contractId)) return false;
    if (target.projectId != null && !access.deptProjectsByDept.get(d)?.has(target.projectId)) return false;
    if (target.deptId != null && target.deptId !== d) return false;
    return true;
  });
}

function scopeMatches(grant: GrantRow, access: UserAccess, target: PermissionTarget): boolean {
  switch (grant.scopeKind) {
    case "all":
      return true;
    case "self":
      return !target.userId || target.userId === access.userId;
    case "participant":
      // 본인이 참여한 계약(service_participants) 또는 영업건(sales_project_members)만.
      // 단건 가드는 target.contractId / target.projectId 를 넘긴다(목록은 각 도메인 필터에서 처리).
      return (target.contractId == null || access.participantContractIds.has(target.contractId))
          && (target.projectId == null || access.participantProjectIds.has(target.projectId));
    case "self_dept":
      // target 이 비어 있으면 통과(목록은 도메인 필터가 처리), 계약·영업건·부서가 오면 그 부서 범위 안이어야 한다(F-06).
      // 범위 = 활성 보직 부서 전체(주 소속 + 겸직, 300). 보직이 하나도 없으면 불통과.
      return deptScopeMatches(access, access.postDeptIds, target);
    case "specific_dept":
      return deptScopeMatches(access, grantDeptIds(access, grant), target);
    default:
      return false;
  }
}

/** access 객체 기준 동기 권한 검사. */
/**
 * role=admin 을 무조건 통과시키던 부트스트랩 우회.
 * 이제 관리자 권한의 근거는 **tpl-system-admin 템플릿**(마이그 111)이다.
 * ⚠ 비상용: 권한 배분 실수로 관리자가 잠기면 이 env 를 켜서 우회를 되살린 뒤 정리한다.
 */
const ADMIN_BYPASS = process.env.RBAC_ADMIN_BYPASS === "true";

export function checkPermission(access: UserAccess, permissionKey: string, target: PermissionTarget = {}): boolean {
  if (ADMIN_BYPASS && access.role === "admin") return true;
  const matching = access.grants.filter((g) => g.permissionKey === permissionKey && scopeMatches(g, access, target));
  if (matching.some((g) => g.effect === "deny")) return false;
  return matching.some((g) => g.effect === "allow");
}

/** userId 로 로드 후 검사하는 편의 함수. */
export async function hasPermission(userId: string, permissionKey: string, target: PermissionTarget = {}): Promise<boolean> {
  const access = await loadUserAccess(userId);
  return checkPermission(access, permissionKey, target);
}

/**
 * 해당 권한을 **전사 범위(scope=all)** 로 보유하는가.
 *
 * "관리자면 전 부서, 아니면 본인 부서" 식으로 role 을 보던 분기를 대체한다.
 * 이제 전사 조회 여부는 role 이 아니라 부여된 grant 의 scope 로 결정되므로,
 * 필요하면 임원·부서장에게도 전사 범위를 줄 수 있다.
 */
export async function hasGlobalScope(userId: string, permissionKey: string): Promise<boolean> {
  const access = await loadUserAccess(userId);
  if (ADMIN_BYPASS && access.role === "admin") return true;
  return access.grants.some(
    (g) => g.permissionKey === permissionKey && g.effect === "allow" && g.scopeKind === "all"
  );
}

/** 목록 라우트가 쓰는 부서 범위 해석 결과. */
export type DeptScope =
  | { kind: "all" }
  | { kind: "dept"; deptIds: string[] }
  | { kind: "none" };

/**
 * 권한키의 **부서 범위**를 해석한다 — 부서 차원이 있는 목록(지급 대상·배분 보드·보고서 등)을 거를 때 쓴다.
 * - all: scope=all grant 보유 → 필터 없음
 * - dept: self_dept(본인 보직 부서 — 주 소속 + 겸직)·specific_dept(지정 부서) grant 의 부서 합집합 → 그 부서 행만
 * - none: 위 둘이 없음(participant/self 만 있거나 미보유) → 부서 단위 목록은 빈 결과
 * requirePermission(key) 은 target 이 없으면 어떤 scope 든 통과하므로, 목록 라우트는 반드시 이 결과로 행을 걸러야 한다
 * (2026-10-19 사전 점검 F-06·지급 대상 LIST 전사 노출의 후속).
 */
export function resolveDeptScope(access: UserAccess, permissionKey: string): DeptScope {
  if (ADMIN_BYPASS && access.role === "admin") return { kind: "all" };
  const grants = access.grants.filter((g) => g.permissionKey === permissionKey && g.effect === "allow");
  if (grants.some((g) => g.scopeKind === "all")) return { kind: "all" };
  const deptIds = new Set<string>();
  for (const g of grants) for (const d of grantDeptIds(access, g)) deptIds.add(d);
  return deptIds.size > 0 ? { kind: "dept", deptIds: [...deptIds] } : { kind: "none" };
}

/**
 * 권한키로 고를 수 있는 부서 — all = null(전 부서), 아니면 부서 범위 부서 목록(주 소속을 앞에, 겸직 부서 포함 — 300).
 * 부서 선택 UI(업무추진계획 review-context)와 forcedDeptId 가 같은 목록을 쓴다.
 */
export function allowedDeptIds(access: UserAccess, permissionKey: string): string[] | null {
  const scope = resolveDeptScope(access, permissionKey);
  if (scope.kind === "all") return null;
  if (scope.kind === "none") return [];
  const ids = [...scope.deptIds];
  return access.deptId && ids.includes(access.deptId) ? [access.deptId, ...ids.filter((d) => d !== access.deptId)] : ids;
}

/** 부서 범위로 행을 거른다 — all 은 그대로, dept 는 소속 부서가 범위 안인 행만(부서 미지정 행 제외), none 은 빈 배열. */
export function filterRowsByDeptScope<T>(rows: T[], scope: DeptScope, deptIdOf: (row: T) => string | null | undefined): T[] {
  if (scope.kind === "all") return rows;
  if (scope.kind === "none") return [];
  const allowed = new Set(scope.deptIds);
  return rows.filter((row) => {
    const d = deptIdOf(row);
    return d != null && allowed.has(String(d));
  });
}

/**
 * 권한 요약 — 세션(JWT)에 싣는 문자열 목록(lib/auth/perms.ts 형식: "key" 또는 "key@all").
 * 메뉴 노출·미들웨어 1차 차단·화면 버튼 게이트가 읽는다. deny-overrides 는 checkPermission 과 동일.
 * (role 일원화 WP5, 2026-10-19)
 */
export function summarizePermissions(access: UserAccess): string[] {
  const keys = [...new Set(access.grants.map((g) => g.permissionKey))].sort();
  const out: string[] = [];
  for (const key of keys) {
    if (!checkPermission(access, key)) continue;
    const global =
      (ADMIN_BYPASS && access.role === "admin") ||
      access.grants.some((g) => g.permissionKey === key && g.effect === "allow" && g.scopeKind === "all");
    out.push(global ? key + PERM_ALL_SUFFIX : key);
  }
  return out;
}

/** userId 로 로드 후 요약하는 편의 함수(로그인·세션 갱신 시 config.ts 가 호출). */
export async function loadPermissionSummary(userId: string): Promise<string[]> {
  return summarizePermissions(await loadUserAccess(userId));
}
