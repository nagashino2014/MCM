/**
 * 화면 경로 ↔ 요구 권한키 표 — 메뉴 노출(config/menu.ts)·미들웨어 1차 차단(lib/auth/edge-config.ts)·
 * 권한 없음 안내(/forbidden)가 같은 표를 쓴다. 역할별 기대값의 출처는
 * docs/open-test-permission-plan-2026-10-19.md §4.1·§4.2 (2026-10-19 사용자 확정).
 *
 * 규칙
 *  - keys 가 여러 개면 **하나라도** 보유하면 통과(hasAnyPerm).
 *  - keys 가 빈 배열이면 세션만 요구(본인 데이터 화면). 상위 경로의 요구를 덮어쓰기 위해 둔다(예: /payroll/my).
 *  - 매칭은 가장 긴 경로 접두(path 와 같거나 path + "/" 로 시작) 우선.
 *  - 표에 없는 경로는 세션만 요구한다(채팅·메일·일정·주소록·홈 등).
 *
 * ⚠ 미들웨어(edge runtime)가 import 한다 — lucide 아이콘·Node 모듈을 넣지 말 것(아이콘은 config/menu.ts 에).
 */

/** 관리(/admin·/api/admin) 영역 1차 차단에 쓰는 키 — 하나라도 있으면 영역 진입 허용, 세부는 하위 표·API 가 판정. */
export const ADMIN_AREA_KEYS: readonly string[] = [
  "account.manage",
  "rbac.template.manage",
  "rbac.assignment.manage",
  "org.edit",
  "security.access_log",
  "security.attachment_policy",
  "ai.usage.view",
  "recruit.view",
];

export const ACCOUNT_ADMIN_KEYS: readonly string[] = ["account.manage", "rbac.template.manage", "rbac.assignment.manage"];

export interface RoutePermission {
  path: string;
  keys: readonly string[];
}

export const ROUTE_PERMISSIONS: readonly RoutePermission[] = [
  // ── 관리 ──
  { path: "/admin", keys: ADMIN_AREA_KEYS },
  { path: "/admin/users", keys: ACCOUNT_ADMIN_KEYS },
  { path: "/admin/access-log", keys: ["security.access_log"] },
  { path: "/admin/ai-usage", keys: ["ai.usage.view"] },
  { path: "/admin/attachment-policy", keys: ["security.attachment_policy"] },
  { path: "/admin/company-profile", keys: ["org.edit"] },
  { path: "/admin/recruit", keys: ["recruit.view"] },
  // 결재 운영 설정(양식·의미 사전·관계 맵·지표·정책·전결 규정·알림)
  { path: "/approval/forms", keys: ["approval.manage"] },
  { path: "/approval/semantic-concepts", keys: ["approval.manage"] },
  { path: "/approval/semantics", keys: ["approval.manage"] },
  { path: "/approval/metrics", keys: ["approval.manage"] },
  { path: "/approval/policies", keys: ["approval.manage"] },
  { path: "/approval/final-rules", keys: ["approval.manage"] },
  { path: "/approval/settings", keys: ["approval.manage"] },
  // 양식별 문서 조회·결재 인사이트 — 전자결재 메뉴 하위지만 API(query·insights)가 approval.manage(2026-10-20 F-1)
  { path: "/approval/records", keys: ["approval.manage"] },
  { path: "/approval/insights", keys: ["approval.manage"] },
  // 근태·휴가 관리 6화면(§6-4: 기존 staffing.edit) — 화면 API(/api/approval/leave·attendance·certificates·
  //   leave-promotion·holidays·leave-types 쓰기)도 같은 키(2026-10-21 F-22, 이전 approval.manage)
  { path: "/approval/leave", keys: ["staffing.edit"] },
  { path: "/approval/attendance", keys: ["staffing.edit"] },
  { path: "/approval/certificates", keys: ["staffing.edit"] },
  { path: "/approval/leave-promotion", keys: ["staffing.edit"] },
  { path: "/approval/holidays", keys: ["staffing.edit"] },
  { path: "/approval/leave-types", keys: ["staffing.edit"] },
  // ── 업무 ──
  { path: "/work-plan", keys: ["work_plan.view"] },
  { path: "/work-plan/oversight", keys: ["work_plan.merge", "work_plan.lock_release"] },
  { path: "/work-plan/exec", keys: ["work_plan.directive"] },
  { path: "/work-plan/present", keys: ["work_plan.directive"] },
  { path: "/staffing", keys: ["bonus.view"] },
  { path: "/staffing/records", keys: ["staffing.record.view"] },
  { path: "/payroll", keys: ["payroll.view"] },
  { path: "/payroll/my", keys: [] },
  { path: "/payroll/my-yearend", keys: [] },
  // ── 협업 ──
  { path: "/rules/admin", keys: ["rules.manage"] },
  { path: "/rules/internal/edit", keys: ["rules.manage"] },
  { path: "/survey/external", keys: ["survey.manage"] },
  // 파일함(전사 첨부 통합 조회·삭제·저장 정책)은 files.manage(F-2). 개인문서함은 본인 화면이라 세션만.
  //   자산 관리(/assets)는 조회가 전원 필요해 표에 두지 않고 편집 버튼만 asset.manage 로 가린다(F-3).
  { path: "/files", keys: ["files.manage"] },
  { path: "/files/personal", keys: [] },
  // ── 사업 운영 ──
  { path: "/facilities", keys: ["facility.view"] },
  { path: "/contracts", keys: ["contract.view"] },
  // 계약 Dashboard·수주/수금/발행 현황 — 민감 현황이라 billing.view(관리자·인사/회계·대표이사·영업관리)로 한정(298, 2026-10-19)
  { path: "/contracts/dashboard", keys: ["billing.view"] },
  { path: "/contracts/billing", keys: ["billing.view"] },
  // 부서장 전용 부서 현황(299)
  { path: "/contracts/dept-billing", keys: ["billing.dept.view"] },
  { path: "/contracts/filings", keys: ["filing.view"] },
  { path: "/finance", keys: ["finance.view"] },
  { path: "/sales", keys: ["sales.view"] },
  // 담당자 정보 관리 화면은 영업 메뉴와 같이 영업 담당자만(298). 데이터 API(contact.view)는 주소록 때문에 전 직원 유지.
  { path: "/sales/contacts", keys: ["sales.view"] },
  // 견적서 작성 화면(라우트는 /approval/quote) — 영업 메뉴 하위이므로 sales.view(298). 견적 결재 문서 열람은 전자결재 문서함 경로라 무관.
  { path: "/approval/quote", keys: ["sales.view"] },
  // 회사소개서(309) — 목록·지표는 catalog.view, 실적·인물·자산 관리 화면은 catalog.manage. 영업 메뉴 하위지만 sales.view 와 별개.
  { path: "/sales/catalog", keys: ["catalog.view"] },
  { path: "/sales/catalog/projects", keys: ["catalog.manage"] },
  { path: "/sales/catalog/people", keys: ["catalog.manage"] },
  { path: "/sales/catalog/assets", keys: ["catalog.manage"] },
  { path: "/sales/catalog/message", keys: ["catalog.manage"] },
  { path: "/sales/catalog/org", keys: ["catalog.manage"] },
  { path: "/sales/catalog/studio", keys: ["catalog.manage"] },
  { path: "/data", keys: ["data.view"] },
  // ── 시스템 ──
  { path: "/trash", keys: ["trash.view"] },
];

function matches(entryPath: string, pathname: string): boolean {
  return pathname === entryPath || pathname.startsWith(entryPath + "/");
}

/** 경로가 요구하는 권한키. null = 세션만 요구(표에 없거나 빈 keys). */
export function requiredPermissionsForPath(pathname: string): readonly string[] | null {
  let best: RoutePermission | null = null;
  for (const entry of ROUTE_PERMISSIONS) {
    if (!matches(entry.path, pathname)) continue;
    if (!best || entry.path.length > best.path.length) best = entry;
  }
  if (!best || best.keys.length === 0) return null;
  return best.keys;
}

/** 메뉴 href(query 포함 가능)가 요구하는 권한키 — config/menu.ts 가 permissionKey 로 쓴다. */
export function menuPermissionKeys(href: string): string[] {
  const path = href.split("?")[0];
  return [...(requiredPermissionsForPath(path) ?? [])];
}
