/**
 * RBAC 런타임 — 권한 템플릿(permission_template_grants) + 인원 적용(user_permission_assignments)
 * 을 평가해 atomic 권한키 + scope 를 검사한다. (블루프린트 §3.2.6)
 *
 * - admin 역할은 항상 ALLOW.
 * - deny-overrides: 같은 키에 deny 가 있으면 allow 보다 우선.
 * - scope: self / self_dept / specific_dept / all.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import type { Role } from "./users";

export type ScopeKind = "self" | "self_dept" | "specific_dept" | "all";

interface GrantRow {
  permissionKey: string;
  scopeKind: ScopeKind;
  scopeDeptId: string | null;
  effect: "allow" | "deny";
}

export interface UserAccess {
  userId: string;
  role: Role;
  deptId: string | null;
  grants: GrantRow[];
}

export interface PermissionTarget {
  userId?: string;
  deptId?: string;
}

/** 사용자 role·소속부서 + 활성 권한 grants 를 로드한다. */
export async function loadUserAccess(userId: string): Promise<UserAccess> {
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);

  const userRows = rowsToObjects(
    await db.exec("SELECT role, dept_id FROM users WHERE user_id = $1 LIMIT 1", [userId])
  );
  const role = (String(userRows[0]?.role ?? "viewer") as Role);
  const deptId = userRows[0]?.dept_id != null ? String(userRows[0].dept_id) : null;

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
          AND (a.effective_from IS NULL OR a.effective_from <= $2)
          AND (a.effective_to IS NULL OR a.effective_to >= $2)`,
      [userId, today]
    )
  );

  const grants: GrantRow[] = grantRows.map((row) => ({
    permissionKey: String(row.permission_key ?? ""),
    scopeKind: (String(row.eff_scope_kind ?? row.scope_kind ?? "self") as ScopeKind),
    scopeDeptId: row.eff_scope_dept_id != null ? String(row.eff_scope_dept_id) : null,
    effect: (String(row.effect ?? "allow") as "allow" | "deny"),
  }));

  return { userId, role, deptId, grants };
}

function scopeMatches(grant: GrantRow, access: UserAccess, target: PermissionTarget): boolean {
  switch (grant.scopeKind) {
    case "all":
      return true;
    case "self":
      return !target.userId || target.userId === access.userId;
    case "self_dept":
      return !target.deptId || target.deptId === access.deptId;
    case "specific_dept":
      return !target.deptId || target.deptId === grant.scopeDeptId;
    default:
      return false;
  }
}

/** access 객체 기준 동기 권한 검사. */
export function checkPermission(access: UserAccess, permissionKey: string, target: PermissionTarget = {}): boolean {
  if (access.role === "admin") return true;
  const matching = access.grants.filter((g) => g.permissionKey === permissionKey && scopeMatches(g, access, target));
  if (matching.some((g) => g.effect === "deny")) return false;
  return matching.some((g) => g.effect === "allow");
}

/** userId 로 로드 후 검사하는 편의 함수. */
export async function hasPermission(userId: string, permissionKey: string, target: PermissionTarget = {}): Promise<boolean> {
  const access = await loadUserAccess(userId);
  return checkPermission(access, permissionKey, target);
}
