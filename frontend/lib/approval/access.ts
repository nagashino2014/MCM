// 문서 열람 범위 판정 — 문서 상세(GET)와 첨부 미리보기가 같은 규칙을 써야 하므로 분리했다.
// 규칙: 기안자·결재선 관계자·참조/열람자·결재 운영 권한자·전 문서 열람 권한자(approval.read_all, 298) + 문서함 공개 범위
//       (전사 문서함 지정 양식의 승인 문서는 전 직원 — 인사·회계·성과급·근태 폴더(304)는 제외,
//        완료·반려 문서는 그 부서의 부서장까지 — 부서원끼리는 서로 보지 않는다(2026-10-21).

import { hasPermission } from "@/lib/auth/rbac";
import { listRestrictedOrgFolders, type ApprovalDocDetail } from "@/lib/approval/docs";
import { isDeptHeadOf } from "@/lib/org/posts";

export interface DocAccess {
  allowed: boolean;
  /** 참조/열람자 — 상세 조회 시 읽음 처리 대상 */
  isWatcher: boolean;
  /** 결재 운영 권한(approval.manage) */
  isManager: boolean;
}

export async function resolveDocAccess(doc: ApprovalDocDetail, userId: string): Promise<DocAccess> {
  const involved =
    doc.drafterUserId === userId || doc.steps.some((s) => s.assigneeUserId === userId || s.delegatedFrom === userId);
  const isWatcher = doc.watchers.some((w) => w.userId === userId);
  const isManager = await hasPermission(userId, "approval.manage");
  // 전 문서 열람(approval.read_all) — 대표이사 등 운영 권한 없이 열람만 허용(2026-10-19 C-1)
  const isReader = isManager || (await hasPermission(userId, "approval.read_all"));
  let allowed = involved || isWatcher || isReader;
  // 전사 문서함 공개 — 열람 제한 폴더(인사·회계·성과급·근태, 304)는 제외(isReader 가 관리자·인사/회계·대표이사를 이미 허용)
  if (!allowed && doc.status === "approved" && doc.orgFolder && !(await listRestrictedOrgFolders()).has(doc.orgFolder)) allowed = true;
  if (!allowed && ["approved", "rejected"].includes(doc.status) && doc.deptId) {
    // 문서 부서의 부서장(부서장 보직, 겸직 부서장 포함 — 300)만. 부서원은 다른 직원 문서를 보지 않는다(2026-10-21)
    if (await isDeptHeadOf(userId, doc.deptId)) allowed = true;
  }
  return { allowed, isWatcher, isManager };
}
