/**
 * 채용공고 구분 메타(부문·구분·플랫폼·기간) — 프리셋과 표시 헬퍼. 서버·클라 공용(순수 함수만).
 * 값은 자유 입력을 허용하되, 프리셋을 datalist/select 로 제안해 표기를 통일한다.
 */

export const DIVISION_PRESETS = ["통합허가(본사)", "통합허가(울산)", "화관법", "HAPs", "ESG", "기술진단"] as const;
export const HIRE_TYPE_PRESETS = ["신입", "경력직", "신입·경력"] as const;
export const PLATFORM_PRESETS = ["사람인", "잡코리아", "원티드", "자사 홈페이지", "기타"] as const;

export interface PostingMeta {
  division: string | null;
  hireType: string | null;
  platform: string | null;
  /** YYYY-MM-DD */
  periodStart: string | null;
  /** YYYY-MM-DD — null 이면 상시/미정 */
  periodEnd: string | null;
}

export const EMPTY_META: PostingMeta = { division: null, hireType: null, platform: null, periodStart: null, periodEnd: null };

/** 입력값 정규화 — 공백 제거, 빈 문자열은 null. 날짜는 YYYY-MM-DD 완성형만 인정(입력 도중 부분값은 버림). */
export function normalizeMeta(input: Partial<Record<keyof PostingMeta, unknown>> | null | undefined): PostingMeta {
  const str = (v: unknown, max = 60): string | null => {
    if (v == null) return null;
    const s = String(v).trim().slice(0, max);
    return s ? s : null;
  };
  const date = (v: unknown): string | null => {
    const s = str(v, 10);
    return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  };
  return {
    division: str(input?.division),
    hireType: str(input?.hireType),
    platform: str(input?.platform),
    periodStart: date(input?.periodStart),
    periodEnd: date(input?.periodEnd),
  };
}

/** 오늘(로컬) YYYY-MM-DD. */
export function todayYmd(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export type PeriodState = "none" | "upcoming" | "open" | "expired";

/** 공고기간 상태 — 종료일이 오늘보다 앞이면 만료, 시작일이 오늘보다 뒤면 예정. */
export function periodState(meta: Pick<PostingMeta, "periodStart" | "periodEnd">, today = todayYmd()): PeriodState {
  if (!meta.periodStart && !meta.periodEnd) return "none";
  if (meta.periodEnd && meta.periodEnd < today) return "expired";
  if (meta.periodStart && meta.periodStart > today) return "upcoming";
  return "open";
}

/** "2026-09-01 ~ 2026-10-15" / "~ 2026-10-15" / "2026-09-01 ~ (상시)" */
export function formatPeriod(meta: Pick<PostingMeta, "periodStart" | "periodEnd">): string {
  if (!meta.periodStart && !meta.periodEnd) return "";
  return `${meta.periodStart ?? ""} ~ ${meta.periodEnd ?? "(상시)"}`.trim();
}
