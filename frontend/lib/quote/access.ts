// 발송견적 개별 열람·조작 범위.
// 열람: 전 직원(approval.view — 라우트가 먼저 확인)이 모든 견적(2026-10-21 사용자 결정 — 과거 발행 견적 확인용,
//   F-26 의 본인 기안·결재 문서 열람 제한을 대체). 단건·PDF·xlsx 가 이 함수를 쓴다.
// 조작: 수신처 편집·수주 결과 기입 = 결재 관리(approval.manage), 재발송 = 기안자 본인 또는 결재 관리.

import { hasPermission } from "@/lib/auth/rbac";
import { getDoc } from "@/lib/approval/docs";

export async function canViewQuote(): Promise<boolean> {
  return true;
}

/** 화면 버튼 게이트용 — 서버 PATCH(approval.manage)·발송(기안자·approval.manage) 규칙과 같다. */
export async function quoteActionFlags(userId: string, docId: string | null | undefined): Promise<{ canManage: boolean; canSend: boolean }> {
  const canManage = await hasPermission(userId, "approval.manage");
  if (canManage) return { canManage, canSend: true };
  const doc = docId ? await getDoc(docId) : null;
  return { canManage, canSend: !!doc && doc.drafterUserId === userId };
}
