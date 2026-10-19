// 견적서 작성 권한 판정 — sales.edit 보유자(영업관리·대표이사·시스템 관리자 등 권한 템플릿 기준).
// 2026-08-05 의 직책·부서명 문자열 매칭(대표이사·총괄·본부장·영업관리…)은 권한 템플릿과 무관하게 열려
// 2026-10-19 대표이사 템플릿 설계(C-6)에서 제거했다. 부서장에게 견적 작성이 필요하면 템플릿에 sales.edit 를 부여한다.

import { hasPermission } from "@/lib/auth/rbac";

export async function canCreateQuote(userId: string): Promise<boolean> {
  return hasPermission(userId, "sales.edit");
}
