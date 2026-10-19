// 문서 열람 범위 판정 — 문서 상세(GET)와 첨부 미리보기가 같은 규칙을 써야 하므로 분리했다.
// 규칙: 기안자·결재선 관계자·참조/열람자·결재 운영 권한자·전 문서 열람 권한자(approval.read_all, 298) + 문서함 공개 범위
//       (전사 문서함 지정 양식의 승인 문서는 전 직원, 완료·반려 문서는 같은 부서까지).

import { hasPermission } from "@/lib/auth/rbac";
import { getUserDeptId, type ApprovalDocDetail } from "@/lib/approval/docs";

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
  if (!allowed && doc.status === "approved" && doc.orgFolder) allowed = true;
  if (!allowed && ["approved", "rejected"].includes(doc.status) && doc.deptId) {
    const myDept = await getUserDeptId(userId);
    if (myDept && myDept === doc.deptId) allowed = true;
  }
  return { allowed, isWatcher, isManager };
}
