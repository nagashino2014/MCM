/*
 * 부서를 가리키는 데이터 목록 — 부서 삭제 가능 여부의 단일 원천(2026-11-06 사용자 제보).
 *   departments 를 가리키는 FK 는 대부분 ON DELETE SET NULL·CASCADE 라 DB 는 막아 주지 않는다. 그대로 지우면 직원 소속·계약 수행부서가
 *   조용히 비거나(권한 범위는 다른 값으로 바뀌고) 업무보고가 함께 사라지므로, 앱이 먼저 확인해 막는다.
 *   새 FK 를 추가하면 test:dept-delete 가 실패하므로 BLOCKERS 또는 RELEASED 에 분류한다.
 */

export interface DepartmentRefSpec {
  key: string;
  table: string;
  column: string;
  /** 추가 조건 — 대상 표의 별칭은 t */
  extraWhere?: string;
  label: string;
  unit: "명" | "개" | "건";
  /** 화면에 이름을 보여 줄 때 쓰는 식 — 대상 표의 별칭은 t */
  nameSql?: string;
  /** 해소 방법 또는 막는 이유 */
  hint: string;
}

/** 1건이라도 있으면 삭제를 막는 참조 */
export const DEPARTMENT_DELETE_BLOCKERS: DepartmentRefSpec[] = [
  { key: "child_departments", table: "departments", column: "parent_dept_id", label: "하위 부서", unit: "개", nameSql: "t.dept_name", hint: "다른 상위 부서로 옮기거나 먼저 삭제하세요." },
  { key: "active_employees", table: "employee_profiles", column: "dept_id", extraWhere: "t.status = 'active'", label: "재직 직원", unit: "명", nameSql: "t.name", hint: "직원의 소속 부서를 바꾸세요." },
  { key: "resigned_employees", table: "employee_profiles", column: "dept_id", extraWhere: "t.status <> 'active'", label: "퇴사 직원", unit: "명", nameSql: "t.name", hint: "퇴사자의 소속 기록이 사라지므로 막습니다. 꼭 삭제하려면 소속 부서를 바꾸세요." },
  // 직원 프로필에 부서가 있으면 그쪽이 소속의 기준이다(COALESCE(ep.dept_id, u.dept_id)). 그런 계정의 users.dept_id 는 지워져도 소속이 바뀌지 않는다.
  { key: "user_accounts", table: "users", column: "dept_id", extraWhere: "NOT EXISTS (SELECT 1 FROM employee_profiles p WHERE (p.user_id = t.user_id OR p.employee_id = t.employee_id) AND p.dept_id IS NOT NULL)", label: "직원 정보 없이 소속된 계정", unit: "개", nameSql: "COALESCE(t.name, t.email)", hint: "계정·권한 관리에서 계정을 정리하세요." },
  { key: "active_posts", table: "employee_dept_posts", column: "dept_id", extraWhere: "t.revoked_at IS NULL", label: "부서장·겸직 보직", unit: "건", nameSql: "(SELECT e.name FROM employee_profiles e WHERE e.employee_id = t.employee_id)", hint: "직원의 인사관리 탭에서 보직을 해제하세요." },
  { key: "template_grants", table: "permission_template_grants", column: "scope_dept_id", label: "권한 템플릿의 부서 범위", unit: "건", hint: "권한 템플릿에서 범위를 바꾸세요." },
  { key: "user_assignments", table: "user_permission_assignments", column: "scope_override_dept_id", extraWhere: "t.revoked_at IS NULL", label: "사용자 권한 배정의 부서 범위", unit: "건", hint: "계정·권한 관리에서 범위를 바꾸세요." },
  { key: "position_templates", table: "position_default_templates", column: "scope_dept_default", label: "직급 기본 권한의 부서 범위", unit: "건", hint: "직급 기본 권한에서 범위를 바꾸세요." },
  { key: "contracts", table: "contracts", column: "owning_dept_id", label: "계약(수행부서)", unit: "건", hint: "계약의 수행부서를 바꾸세요." },
  { key: "work_tasks", table: "work_tasks", column: "owning_dept_id", label: "업무추진계획", unit: "건", hint: "담당 부서를 바꾸세요." },
  { key: "work_plan_reports", table: "work_plan_reports", column: "dept_id", label: "업무보고", unit: "건", hint: "부서를 지우면 보고가 함께 사라지므로 막습니다." },
  { key: "work_plan_templates", table: "work_plan_templates", column: "default_for_dept_id", label: "업무보고 기본 양식 지정", unit: "건", hint: "양식의 기본 부서를 바꾸세요." },
  { key: "sales_projects", table: "sales_projects", column: "owner_dept_id", label: "영업 건", unit: "건", hint: "담당 부서를 바꾸세요." },
  { key: "board_posts", table: "board_posts", column: "dept_id", label: "부서 게시판 글", unit: "건", hint: "글을 삭제하세요." },
  { key: "intel_candidates", table: "intel_facility_candidates", column: "owning_dept_id", label: "영업 발굴 후보 사업장", unit: "건", hint: "담당 부서를 바꾸세요." },
  { key: "intel_projects", table: "intel_projects", column: "owning_dept_id", label: "영업 발굴 사업", unit: "건", hint: "담당 부서를 바꾸세요." },
  // 아래는 FK 없는 참조 — 지워도 오류가 나지 않고 존재하지 않는 부서 id 만 남는다.
  { key: "approval_docs", table: "approval_docs", column: "dept_id", label: "결재 문서(기안 부서)", unit: "건", hint: "부서 문서함의 열람 기준이므로 막습니다." },
  { key: "approval_line_roles", table: "approval_line_role_users", column: "dept_id", label: "고정 결재선 부서별 담당자", unit: "건", hint: "결재선 설정에서 담당자 지정을 지우세요." },
  { key: "dept_todo_boards", table: "todo_boards", column: "scope_ref", extraWhere: "t.kind = 'dept' AND t.archived_at IS NULL", label: "부서 할 일 보드", unit: "개", nameSql: "t.name", hint: "할 일에서 보드를 보관하세요." },
];

/** 삭제와 함께 지워지는 부속 설정·이력(화면에 건수를 알린다) */
export const DEPARTMENT_DELETE_CASCADES: DepartmentRefSpec[] = [
  { key: "department_positions", table: "department_positions", column: "dept_id", label: "사용 가능 직급 설정", unit: "건", hint: "" },
  { key: "revoked_posts", table: "employee_dept_posts", column: "dept_id", extraWhere: "t.revoked_at IS NOT NULL", label: "해제된 보직 기록", unit: "건", hint: "" },
];

/**
 * 막지 않는 FK(test:dept-delete 대조용).
 * - department_positions·employee_dept_posts: 위 CASCADES(활성 보직은 BLOCKERS 가 막는다).
 * - employee_hr_events: 부서 이름이 글자로 함께 저장돼 있어 id 만 비어도 이력이 남는다(deleteDepartment 가 이름이 빈 옛 행을 채운다).
 * - users: 해석은 BLOCKERS 의 user_accounts 주석 참고.
 */
export const DEPARTMENT_DELETE_RELEASED_FKS = [
  "department_positions.dept_id",
  "employee_dept_posts.dept_id",
  "employee_hr_events.from_dept_id",
  "employee_hr_events.to_dept_id",
  "users.dept_id",
];

export function departmentRefWhere(spec: DepartmentRefSpec): string {
  return `t.${spec.column} = $1` + (spec.extraWhere ? ` AND ${spec.extraWhere}` : "");
}
