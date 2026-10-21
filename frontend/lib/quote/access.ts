// 발송견적 개별 열람 범위(F-26 후속, 2026-10-21) — 목록(/api/quotes)과 같은 기준에 결재 문서 열람 규칙을 더한다.
// 전사: 결재 관리(approval.manage) 또는 영업 조회 전사 범위(sales.view@all).
// 그 밖: 견적 결재 문서를 볼 수 있는 사람(기안자·결재선·참조/열람·문서함 공개 범위 — lib/approval/access.ts).

import { hasGlobalScope, hasPermission } from "@/lib/auth/rbac";
import { getDoc } from "@/lib/approval/docs";
import { resolveDocAccess } from "@/lib/approval/access";

export async function canViewQuote(userId: string, docId: string | null | undefined): Promise<boolean> {
  if ((await hasPermission(userId, "approval.manage")) || (await hasGlobalScope(userId, "sales.view"))) return true;
  if (!docId) return false;
  const doc = await getDoc(docId);
  if (!doc) return false;
  return (await resolveDocAccess(doc, userId)).allowed;
}
