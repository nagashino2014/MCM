/**
 * 수주/수금/발행 현황 — 수주 현황 공용 필터 (클라이언트 UI / export 라우트 공유).
 * 서버 의존성이 없는 순수 함수만 둔다.
 */
import { shortenSido } from "@scraper/lib/ieps/region";
import {
  findIntegratedPermitIndustry,
  industryCodeMatchesCategory,
} from "@/lib/ieps/integrated-permit-industries";
import type { ContractOrdersStatusRow } from "@/lib/ieps/contracts";

export interface OrdersStatusFilter {
  /** 대쉬보드 5대 분류명. null/undefined = 전체 용역 */
  category?: string | null;
  /** 통합허가 대상 업종 id (통합환경허가 선택 시에만 유효) */
  industryId?: string | null;
  /** 시도 축약명 (지도에서 선택). null = 전체 지역 */
  sido?: string | null;
}

export function rowMatchesIndustry(row: ContractOrdersStatusRow, industryId: string): boolean {
  const industry = findIntegratedPermitIndustry(industryId);
  if (!industry) return true;
  const codes = String(row.facilityIndustryCode ?? "")
    .split(/[\s,/]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (codes.some((code) => industryCodeMatchesCategory(code, industry))) return true;
  // 코드가 없으면 계약에 기록된 업종 분류 텍스트로 폴백
  const text = String(row.industryCategory ?? "");
  return text.length > 0 && text.includes(industry.label);
}

export function filterOrdersStatusRows(
  rows: ContractOrdersStatusRow[],
  filter: OrdersStatusFilter
): ContractOrdersStatusRow[] {
  return rows.filter((row) => {
    if (filter.category && row.category !== filter.category) return false;
    if (filter.industryId && !rowMatchesIndustry(row, filter.industryId)) return false;
    if (filter.sido) {
      const short = shortenSido(row.sido) ?? row.sido ?? "미상";
      if (short !== filter.sido) return false;
    }
    return true;
  });
}
