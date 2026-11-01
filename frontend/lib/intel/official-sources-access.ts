import { checkPermission, type UserAccess } from "../auth/rbac";

/** 기관별 키·이용조건·자동수집은 전사 설정이다. 부서/참여/본인 편집권한으로 변경할 수 없다. */
export function canManageOfficialSources(access: UserAccess): boolean {
  const grants = access.grants.filter(g => g.permissionKey === "sales.edit");
  return checkPermission(access, "sales.edit") && !grants.some(g => g.effect === "deny") && grants.some(g => g.effect === "allow" && g.scopeKind === "all");
}
