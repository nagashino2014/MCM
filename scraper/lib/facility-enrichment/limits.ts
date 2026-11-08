/** 연락처 가져오기의 조회 순서. 공개 API 를 먼저 쓰고, 한도가 작은 비즈노는 마지막이다. */
export const SEARCH_SOURCES = ["dart", "fsc", "naver", "bizno"] as const;

/** 외부 정보원 하루 조회 한도. 워커가 지키고, 앱은 같은 값으로 사용량을 보여 준다. */
export function dailyLimit(source: string): number {
  return Math.max(1, Math.min(10000, Number(process.env[`FACILITY_QUALITY_${source.toUpperCase()}_DAILY_LIMIT`] || (source === "bizno" ? 100 : 600))));
}
