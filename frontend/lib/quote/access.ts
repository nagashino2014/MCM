// 발송견적 개별 열람·조작 범위.
// 열람: 전 직원(approval.view — 라우트가 먼저 확인)이 모든 견적(2026-10-21 사용자 결정 — 과거 발행 견적 확인용,
//   F-26 의 본인 기안·결재 문서 열람 제한을 대체). 단건·PDF·xlsx 가 이 함수를 쓴다.
// 조작: 재발송·수신처 편집·수주 결과 기입 = 기안자 본인(본인이 보낸 견적) 또는 결재 관리(approval.manage)
//   (2026-10-21 사용자 결정 — 일반 직원도 견적을 직접 보낸다).

import { hasPermission } from "@/lib/auth/rbac";
import { isDocDrafter } from "@/lib/approval/docs";

export async function canViewQuote(): Promise<boolean> {
  return true;
}

/** 본인이 보낸 견적이거나 결재 관리 권한 — PATCH·발송 서버 판정과 화면 버튼이 같은 기준을 쓴다. */
export async function canActOnQuote(userId: string, docId: string | null | undefined): Promise<boolean> {
  return (await hasPermission(userId, "approval.manage")) || (await isDocDrafter(userId, docId));
}

/** 화면 버튼 게이트용 — canEdit(재발송·수신처 편집·결과 기입). */
export async function quoteActionFlags(userId: string, docId: string | null | undefined): Promise<{ canEdit: boolean }> {
  return { canEdit: await canActOnQuote(userId, docId) };
}
