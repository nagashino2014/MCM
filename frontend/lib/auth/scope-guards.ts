/**
 * 부서 범위 가드 헬퍼 — 개체(계약·직원·첨부 키)를 소속 부서로 되짚어 self_dept/self grant 를 단건·쓰기에서 강제한다.
 *
 * 배경(2026-10-19 부서 분리 전수 조사, docs/open-test-permission-plan-2026-10-19.md §7.7):
 *   requirePermission(key) 은 target 이 없으면 어떤 scope 든 통과한다. 목록은 resolveDeptScope/filterRowsByDeptScope 로
 *   거르고, 단건·쓰기는 여기 헬퍼로 "이 개체가 내 범위인가"를 다시 묻는다.
 * 규칙
 *   - 계약 기준 개체(평가·참여자·변동·문서) = contracts.owning_dept_id 를 target.deptId 로 판정. 수행부서가 비어 있으면
 *     전사(all) 범위 보유자만 허용한다(부서장에게 "미지정" 계약은 보이지 않는 것과 동일).
 *   - 직원 기준 개체(인사·계좌·이력·문서) = employee_profiles.dept_id 를 target.deptId, 연결 계정을 target.userId 로 판정.
 *     계정이 없는 직원은 self grant 가 통과하지 못하도록 자리표시 userId 를 넣는다.
 *   - 해석할 수 없는 키·id 는 404 가 아니라 403 으로 닫는다(존재 여부를 흘리지 않는다).
 */

import { getDb, rowsToObjects } from "@/lib/db";
import { AuthError, requirePermission, type AuthContext } from "./guards";
import { resolveVisibleContractIds } from "./contract-scope";
import {
  allowedDeptIds,
  checkPermission,
  filterRowsByDeptScope,
  loadUserAccess,
  resolveDeptScope,
  type PermissionTarget,
  type UserAccess,
} from "./rbac";

const DENIED = "이 작업을 수행할 권한이 없습니다.";

function deny(): AuthError {
  return new AuthError(DENIED, 403);
}

/** 계약 id → 수행부서(owning_dept_id). 없는 계약은 Map 에 들어가지 않는다. */
export async function loadContractOwningDepts(contractIds: readonly string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(contractIds.filter(Boolean))];
  const out = new Map<string, string | null>();
  if (!ids.length) return out;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT contract_id, owning_dept_id FROM contracts WHERE contract_id = ANY($1::text[])", [ids])
  );
  for (const r of rows) {
    out.set(String(r.contract_id), r.owning_dept_id != null ? String(r.owning_dept_id) : null);
  }
  return out;
}

/**
 * 계약들이 모두 사용자의 부서 범위 안인지 확인한다(전사 범위면 즉시 통과). 하나라도 밖이면 403.
 * 빈 목록은 통과 — 라우트가 입력 검증으로 처리한다.
 */
export async function assertContractsInDeptScope(
  access: UserAccess,
  permissionKey: string,
  contractIds: readonly string[]
): Promise<void> {
  const scope = resolveDeptScope(access, permissionKey);
  if (scope.kind === "all") return;
  const ids = [...new Set(contractIds.filter(Boolean))];
  if (!ids.length) return;
  if (scope.kind === "none") throw deny();
  const depts = await loadContractOwningDepts(ids);
  for (const id of ids) {
    const deptId = depts.get(id);
    if (!deptId || !checkPermission(access, permissionKey, { deptId })) throw deny();
  }
}

/** requirePermission + 계약 부서 범위 확인을 한 번에. */
export async function requireContractDeptScope(
  permissionKey: string,
  contractIds: readonly string[]
): Promise<{ ctx: AuthContext; access: UserAccess }> {
  const ctx = await requirePermission(permissionKey);
  const access = await loadUserAccess(ctx.userId);
  await assertContractsInDeptScope(access, permissionKey, contractIds);
  return { ctx, access };
}

/**
 * 전사 범위 전용 가드 — 부서 범위(self_dept)로는 열리면 안 되는 민감 개체(직원 계좌·인사 서류·승진/퇴사 이력 기록)용.
 * 해당 키를 scope=all 로 가진 사용자(관리자·인사담당)만 통과한다(2026-10-19 사용자 결정: 인사/계좌는 관리자 vs 그 외).
 */
export async function requireGlobalScope(permissionKey: string): Promise<AuthContext> {
  const ctx = await requirePermission(permissionKey);
  const access = await loadUserAccess(ctx.userId);
  if (resolveDeptScope(access, permissionKey).kind !== "all") throw deny();
  return ctx;
}

/* ── 계약 가시 범위(contract.view: 전사 / 부서 소유·부서원 참여 / 본인 참여) — 계약 문서·묶음·거래처 집계용 ── */

/** 가시 계약 id 집합. null = 전사(필터 없음). */
export async function loadVisibleContractSet(userId: string, permissionKey = "contract.view"): Promise<Set<string> | null> {
  const ids = await resolveVisibleContractIds(userId, permissionKey);
  return ids == null ? null : new Set(ids);
}

/** 계약들이 모두 가시 범위 안인지 — 하나라도 밖이거나 계약 미연결(null)이면 403(전사 범위는 통과). */
export function assertContractsVisible(visible: Set<string> | null, contractIds: readonly (string | null | undefined)[]): void {
  if (visible == null) return;
  for (const id of contractIds) {
    if (!id || !visible.has(String(id))) throw deny();
  }
}

/** 행을 가시 계약으로 거른다 — 전사는 그대로, 아니면 계약 미연결 행은 제외. */
export function filterByVisibleContracts<T>(rows: T[], visible: Set<string> | null, contractIdOf: (row: T) => string | null | undefined): T[] {
  if (visible == null) return rows;
  return rows.filter((r) => {
    const id = contractIdOf(r);
    return !!id && visible.has(String(id));
  });
}

/** requirePermission + 가시 계약 집합 로드. */
export async function requireVisibleContracts(permissionKey: string): Promise<{ ctx: AuthContext; visible: Set<string> | null }> {
  const ctx = await requirePermission(permissionKey);
  const visible = await loadVisibleContractSet(ctx.userId, "contract.view");
  return { ctx, visible };
}

/** 직원 → 권한 target(소속 부서·연결 계정). 계정이 없으면 self 가 통과하지 못하게 자리표시 값을 넣는다. */
export async function loadEmployeeTarget(employeeId: string): Promise<PermissionTarget | null> {
  if (!employeeId) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT dept_id, user_id FROM employee_profiles WHERE employee_id = $1 LIMIT 1", [employeeId])
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    deptId: r.dept_id != null ? String(r.dept_id) : "__no_dept__",
    userId: r.user_id != null ? String(r.user_id) : "__no_user__",
  };
}

/** 직원 단건·쓰기 가드 — 소속 부서(self_dept)·본인(self)·전사(all) 중 하나를 만족해야 한다. */
export async function requireEmployeeScope(permissionKey: string, employeeId: string): Promise<AuthContext> {
  const target = await loadEmployeeTarget(employeeId);
  if (!target) throw deny();
  return requirePermission(permissionKey, { target });
}

/** 직원 목록을 범위로 거른다 — all 전체 / dept 소속 부서 / none 이면 본인 행만(self grant). */
export function filterEmployeesByScope<T extends { employeeId: string; deptId: string | null }>(
  access: UserAccess,
  permissionKey: string,
  rows: T[]
): T[] {
  const scope = resolveDeptScope(access, permissionKey);
  if (scope.kind === "none") {
    const selfOk = checkPermission(access, permissionKey, { userId: access.userId });
    return selfOk && access.employeeId ? rows.filter((r) => r.employeeId === access.employeeId) : [];
  }
  return filterRowsByDeptScope(rows, scope, (r) => r.deptId);
}

/** 참여 행(service_participants) → 계약 id. */
export async function loadParticipationContractId(participationId: string): Promise<string | null> {
  if (!participationId) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT contract_id FROM service_participants WHERE participation_id = $1 LIMIT 1", [participationId])
  );
  return rows[0]?.contract_id != null ? String(rows[0].contract_id) : null;
}

/** 인력 변동(service_participation_changes) → 계약 id. */
export async function loadChangeContractId(changeId: string): Promise<string | null> {
  if (!changeId) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT contract_id FROM service_participation_changes WHERE change_id = $1 LIMIT 1", [changeId])
  );
  return rows[0]?.contract_id != null ? String(rows[0].contract_id) : null;
}

/** 인사 이력(employee_hr_events) → 직원 id. */
export async function loadHrEventEmployeeId(eventId: string): Promise<string | null> {
  if (!eventId) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT employee_id FROM employee_hr_events WHERE event_id = $1 LIMIT 1", [eventId])
  );
  return rows[0]?.employee_id != null ? String(rows[0].employee_id) : null;
}

/** 계약 문서 저장소 키(contract_documents.storage_key) → 계약 id. 등록되지 않은 키는 null. */
export async function resolveContractIdByDocumentKey(storageKey: string): Promise<string | null> {
  return (await resolveContractDocumentByKey(storageKey))?.contractId ?? null;
}

/**
 * 전 직원 열람 계약 문서 종류 — 계약서·변경계약서는 과거 계약 확인용으로 계약 열람 범위와 무관하게 전 직원이 본다
 * (문서함 '계약 문서' 탭, 2026-10-21 사용자 결정). 세금계산서·외주계약서·실적증명서 등은 계약 열람 범위를 따른다.
 */
export const OPEN_CONTRACT_DOCUMENT_TYPES = ["contract", "amendment"] as const;

/** 계약 문서 저장소 키 → {계약 id, 문서 종류}. 등록되지 않은 키는 null. */
export async function resolveContractDocumentByKey(
  storageKey: string
): Promise<{ contractId: string; documentType: string } | null> {
  if (!storageKey) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT contract_id, document_type FROM contract_documents WHERE storage_key = $1 LIMIT 1", [storageKey])
  );
  if (rows[0]?.contract_id == null) return null;
  return { contractId: String(rows[0].contract_id), documentType: String(rows[0].document_type ?? "") };
}

/**
 * 이슈 첨부 저장소 키 → 소속 부서(계약 이슈는 계약 수행부서, Task 이슈는 Task 담당부서).
 * found=false 면 등록되지 않은 키(전사 범위만 허용).
 */
export async function resolveIssueAttachmentDept(storageKey: string): Promise<{ found: boolean; deptId: string | null }> {
  if (!storageKey) return { found: false, deptId: null };
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(c.owning_dept_id, t.owning_dept_id) AS dept_id
         FROM work_plan_issue_attachments a
         JOIN work_plan_issues i ON i.issue_id = a.issue_id
         LEFT JOIN contracts c ON c.contract_id = i.contract_id
         LEFT JOIN work_tasks t ON t.task_id = i.task_id
        WHERE a.storage_key = $1 LIMIT 1`,
      [storageKey]
    )
  );
  if (!rows.length) return { found: false, deptId: null };
  return { found: true, deptId: rows[0].dept_id != null ? String(rows[0].dept_id) : null };
}

/**
 * 저장소 키 읽기 가드 — 키를 소속 부서로 해석할 수 있으면 그 부서를 target 으로, 해석할 수 없거나 부서가 비어 있으면
 * 전사(all) 범위 보유자만 통과시킨다.
 */
export async function assertKeyInDeptScope(
  access: UserAccess,
  permissionKey: string,
  resolved: { found: boolean; deptId: string | null }
): Promise<void> {
  const scope = resolveDeptScope(access, permissionKey);
  if (scope.kind === "all") return;
  if (!resolved.found || !resolved.deptId) throw deny();
  if (!checkPermission(access, permissionKey, { deptId: resolved.deptId })) throw deny();
}

/* ── 업무추진계획: 보고서·Task·이슈 → 부서(self_dept)·작성자(self) target ── */

const NO_DEPT = "__no_dept__";
const NO_USER = "__no_user__";

/** 보고서 → {소속 부서, 작성자}. 부서가 비어 있으면 자리표시(부서 범위 불통과). */
export async function loadReportTarget(reportId: string): Promise<PermissionTarget | null> {
  if (!reportId) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT dept_id, author_user_id FROM work_plan_reports WHERE report_id = $1 LIMIT 1", [reportId])
  );
  if (!rows.length) return null;
  return { deptId: rows[0].dept_id != null ? String(rows[0].dept_id) : NO_DEPT, userId: rows[0].author_user_id != null ? String(rows[0].author_user_id) : NO_USER };
}

export async function requireReportScope(permissionKey: string, reportId: string): Promise<AuthContext> {
  const target = await loadReportTarget(reportId);
  if (!target) throw deny();
  return requirePermission(permissionKey, { target });
}

/** Task → {담당 부서, 생성자}. */
export async function loadTaskTarget(taskId: string): Promise<PermissionTarget | null> {
  if (!taskId) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT owning_dept_id, created_by FROM work_tasks WHERE task_id = $1 LIMIT 1", [taskId])
  );
  if (!rows.length) return null;
  return { deptId: rows[0].owning_dept_id != null ? String(rows[0].owning_dept_id) : NO_DEPT, userId: rows[0].created_by != null ? String(rows[0].created_by) : NO_USER };
}

export async function requireTaskScope(permissionKey: string, taskId: string): Promise<AuthContext> {
  const target = await loadTaskTarget(taskId);
  if (!target) throw deny();
  return requirePermission(permissionKey, { target });
}

/**
 * 보고 주제(용역 계약 | Task) → target. 계약 주제는 계약 수행부서 + (선택) 본인 userId —
 * self grant(사원 work_plan.edit)는 본인이 작성 주체일 때만 통과하도록 selfUserId 를 넘긴다.
 */
export async function loadSubjectTarget(kind: "contract" | "task", id: string, selfUserId?: string): Promise<PermissionTarget | null> {
  if (!id) return null;
  if (kind === "task") return loadTaskTarget(id);
  const depts = await loadContractOwningDepts([id]);
  if (!depts.has(id)) return null;
  return { deptId: depts.get(id) ?? NO_DEPT, userId: selfUserId ?? NO_USER };
}

export async function requireSubjectScope(permissionKey: string, kind: "contract" | "task", id: string, selfUserId?: string): Promise<AuthContext> {
  const target = await loadSubjectTarget(kind, id, selfUserId);
  if (!target) throw deny();
  return requirePermission(permissionKey, { target });
}

/** 이슈 → 주제(계약 수행부서 | Task 담당부서) + 이슈 작성자. */
export async function loadIssueTarget(issueId: string): Promise<PermissionTarget | null> {
  if (!issueId) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(c.owning_dept_id, t.owning_dept_id) AS dept_id, i.created_by
         FROM work_plan_issues i
         LEFT JOIN contracts c ON c.contract_id = i.contract_id
         LEFT JOIN work_tasks t ON t.task_id = i.task_id
        WHERE i.issue_id = $1 LIMIT 1`,
      [issueId]
    )
  );
  if (!rows.length) return null;
  return { deptId: rows[0].dept_id != null ? String(rows[0].dept_id) : NO_DEPT, userId: rows[0].created_by != null ? String(rows[0].created_by) : NO_USER };
}

export async function requireIssueScope(permissionKey: string, issueId: string): Promise<AuthContext> {
  const target = await loadIssueTarget(issueId);
  if (!target) throw deny();
  return requirePermission(permissionKey, { target });
}

/** 이슈 첨부 id → 이슈 id. */
export async function loadAttachmentIssueId(attachmentId: string): Promise<string | null> {
  if (!attachmentId) return null;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT issue_id FROM work_plan_issue_attachments WHERE attachment_id = $1 LIMIT 1", [attachmentId])
  );
  return rows[0]?.issue_id != null ? String(rows[0].issue_id) : null;
}

/** 보고서들이 모두 범위 안인지(병합 입력 검증). */
export async function assertReportsInScope(access: UserAccess, permissionKey: string, reportIds: readonly string[]): Promise<void> {
  if (resolveDeptScope(access, permissionKey).kind === "all") return;
  for (const id of [...new Set(reportIds.filter(Boolean))]) {
    const target = await loadReportTarget(id);
    if (!target || !checkPermission(access, permissionKey, target)) throw deny();
  }
}

/** 보고 항목(work_plan_items)들이 모두 범위 안인지 — 항목 → 보고서 → 부서. */
export async function assertItemsInScope(access: UserAccess, permissionKey: string, itemIds: readonly string[]): Promise<void> {
  if (resolveDeptScope(access, permissionKey).kind === "all") return;
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (!ids.length) return;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT i.item_id, r.dept_id, r.author_user_id
         FROM work_plan_items i JOIN work_plan_reports r ON r.report_id = i.report_id
        WHERE i.item_id = ANY($1::text[])`,
      [ids]
    )
  );
  const found = new Map(rows.map((r) => [String(r.item_id), r]));
  for (const id of ids) {
    const r = found.get(id);
    if (!r) throw deny();
    const target: PermissionTarget = { deptId: r.dept_id != null ? String(r.dept_id) : NO_DEPT, userId: r.author_user_id != null ? String(r.author_user_id) : NO_USER };
    if (!checkPermission(access, permissionKey, target)) throw deny();
  }
}

export { allowedDeptIds };

/**
 * 요청한 부서를 범위로 보정 — 전사면 그대로, 요청 부서가 허용 부서(겸직 포함) 안이면 그대로,
 * 아니면 첫 허용 부서(주 소속 우선, 없으면 어떤 행도 맞지 않는 자리표시).
 */
export async function forcedDeptId(userId: string, permissionKey: string, requested: string | null | undefined): Promise<string> {
  const access = await loadUserAccess(userId);
  const allowed = allowedDeptIds(access, permissionKey);
  if (allowed == null) return requested ?? "";
  if (requested && allowed.includes(requested)) return requested;
  return allowed[0] ?? access.deptId ?? NO_DEPT;
}

/* ── 영업: 가시 프로젝트 집합(sales.view: 전사 / 담당 부서·부서원 관계자 / 본인 관계자) ── */

export function resolveVisibleProjectSet(access: UserAccess, permissionKey = "sales.view"): Set<string> | null {
  const scope = resolveDeptScope(access, permissionKey);
  if (scope.kind === "all") return null;
  const out = new Set<string>(access.participantProjectIds);
  // 이 키의 부서 범위 부서만(겸직자의 다른 키 부서 범위가 섞이지 않게 — L-1)
  if (scope.kind === "dept") for (const d of scope.deptIds) for (const id of access.deptProjectsByDept.get(d) ?? []) out.add(id);
  return out;
}

export function filterByVisibleProjects<T>(rows: T[], visible: Set<string> | null, projectIdOf: (row: T) => string | null | undefined): T[] {
  if (visible == null) return rows;
  return rows.filter((r) => {
    const id = projectIdOf(r);
    return !!id && visible.has(String(id));
  });
}
