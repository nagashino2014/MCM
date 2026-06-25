export interface DepartmentRow {
  deptId: string;
  deptName: string;
  deptKind: string;
  parentDeptId: string | null;
  displayOrder: number;
  accentColor: string | null;
  isActive: boolean;
}

export interface PositionRow {
  positionId: string;
  positionName: string;
  rankOrder: number;
  isActive: boolean;
}

export interface DepartmentPositionRow {
  deptId: string;
  positionId: string;
  displayOrder: number;
}

export interface OrganizationEmployeeRow {
  employeeId: string;
  userId: string | null;
  employeeNo: string | null;
  name: string;
  deptId: string | null;
  positionId: string | null;
  positionName: string | null;
  positionRankOrder: number | null;
  email: string | null;
  status: "active" | "inactive";
  hiredAt: string | null;
  gender: "male" | "female" | null;
  hasBirthDate: boolean;
}

export interface OrganizationSnapshot {
  departments: DepartmentRow[];
  positions: PositionRow[];
  departmentPositions: DepartmentPositionRow[];
  employees: OrganizationEmployeeRow[];
}

export interface UserRow {
  userId: string;
  email: string;
  loginId: string | null;
  name: string;
  role: "admin" | "editor" | "viewer";
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface PermissionRow {
  permissionKey: string;
  module: string;
  action: string;
  description: string;
  scopesSupported: Array<"self" | "self_dept" | "specific_dept" | "all">;
  isDangerous: boolean;
}

export interface PermissionGrantRow {
  grantId: string;
  templateId: string;
  permissionKey: string;
  scopeKind: "self" | "self_dept" | "specific_dept" | "all";
  scopeDeptId: string | null;
  effect: "allow" | "deny";
}

export interface PermissionTemplateRow {
  templateId: string;
  templateName: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  grants: PermissionGrantRow[];
}

export interface UserPermissionAssignmentRow {
  assignmentId: string;
  userId: string;
  userName: string;
  userEmail: string;
  templateId: string;
  templateName: string;
  scopeOverrideKind: "self" | "self_dept" | "specific_dept" | "all" | null;
  scopeOverrideDeptId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  revokedAt: string | null;
}

export interface PermissionsSnapshot {
  permissions: PermissionRow[];
  templates: PermissionTemplateRow[];
  assignments: UserPermissionAssignmentRow[];
}

/** 조직도에서 선택한 계정(발급 인원 또는 마스터 관리자). userId=null 이면 계정 미발급 인원. */
export interface SelectedAccount {
  kind: "employee" | "master";
  userId: string | null;
  name: string;
  employeeId?: string | null;
  deptId?: string | null;
  loginId?: string | null;
  email?: string | null;
}
