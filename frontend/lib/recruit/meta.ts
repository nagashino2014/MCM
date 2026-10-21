/**
 * 채용공고 구분 메타(부문·구분·플랫폼·기간·근무지역·공고 주소) — 프리셋과 표시 헬퍼. 서버·클라 공용(순수 함수만).
 * 값은 자유 입력을 허용하되, 프리셋을 datalist/select 로 제안해 표기를 통일한다.
 */

export const DIVISION_PRESETS = ["통합허가(본사)", "통합허가(울산)", "화관법", "HAPs", "ESG", "기술진단"] as const;
export const HIRE_TYPE_PRESETS = ["신입", "경력직", "신입·경력"] as const;
export const PLATFORM_PRESETS = ["사람인", "잡코리아", "원티드", "자사 홈페이지", "기타"] as const;
export const WORK_LOCATION_PRESETS = ["본사", "울산"] as const;

/** 플랫폼 첫 화면 — 공고 주소가 없을 때 [채용사이트 열기]가 여는 곳. 프리셋에 없는 플랫폼은 null. */
const PLATFORM_HOME: Record<string, string> = {
  사람인: "https://www.saramin.co.kr/",
  잡코리아: "https://www.jobkorea.co.kr/",
  원티드: "https://www.wanted.co.kr/",
};

export interface PostingMeta {
  division: string | null;
  hireType: string | null;
  platform: string | null;
  /** YYYY-MM-DD */
  periodStart: string | null;
  /** YYYY-MM-DD — null 이면 상시/미정 */
  periodEnd: string | null;
  /** 근무지역(272) — 본사/울산 … 비어 있으면 공고부문의 괄호("통합허가(울산)")에서 파생한다 */
  workLocation: string | null;
  /** 채용사이트에 올린 공고 주소(272) — http/https 만 */
  postingUrl: string | null;
}

/**
 * 템플릿 [내용 편집]이 만드는 편집용 공고의 제목 꼬리표(TemplateBoard). 이 꼬리표가 붙은 공고는 공고 목록에서 빼고(F-40),
 * 같은 템플릿을 다시 [내용 편집]하면 이전 편집용 공고를 정리한 뒤 새로 만든다. 별도 컬럼 없이 제목으로 구분한다.
 */
export const TEMPLATE_EDIT_TITLE_SUFFIX = " — 템플릿 편집용";

export function isTemplateEditTitle(title: string | null | undefined): boolean {
  return !!title && title.trimEnd().endsWith(TEMPLATE_EDIT_TITLE_SUFFIX.trim());
}

export const EMPTY_META: PostingMeta = {
  division: null, hireType: null, platform: null, periodStart: null, periodEnd: null, workLocation: null, postingUrl: null,
};

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
  const url = (v: unknown): string | null => {
    const s = str(v, 500);
    return s && /^https?:\/\/\S+$/i.test(s) ? s : null;
  };
  return {
    division: str(input?.division),
    hireType: str(input?.hireType),
    platform: str(input?.platform),
    periodStart: date(input?.periodStart),
    periodEnd: date(input?.periodEnd),
    workLocation: str(input?.workLocation),
    postingUrl: url(input?.postingUrl),
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

/** 마감까지 남은 날 — 종료일이 없으면 null, 지났으면 음수. "D-3"·"D-day" 표기에 쓴다. */
export function daysUntilEnd(meta: Pick<PostingMeta, "periodEnd">, today = todayYmd()): number | null {
  if (!meta.periodEnd) return null;
  const ms = Date.parse(`${meta.periodEnd}T00:00:00`) - Date.parse(`${today}T00:00:00`);
  return Number.isNaN(ms) ? null : Math.round(ms / 86400000);
}

/**
 * 공고부문을 대상 분야와 괄호 안 지역으로 나눈다 — "통합허가(울산)" → { field: "통합허가", location: "울산" }.
 * 괄호가 없으면(화관법·ESG) location 은 null.
 */
export function splitDivision(division: string | null | undefined): { field: string | null; location: string | null } {
  const s = (division ?? "").trim();
  if (!s) return { field: null, location: null };
  const m = s.match(/^(.*?)\s*[(（]\s*([^()（）]+?)\s*[)）]\s*$/);
  if (!m) return { field: s, location: null };
  return { field: m[1].trim() || null, location: m[2].trim() || null };
}

/** 요약에 보일 근무지역 — 독립 칸(272)이 우선, 없으면 공고부문 괄호에서 파생. */
export function workLocationOf(meta: Pick<PostingMeta, "division" | "workLocation">): string | null {
  return meta.workLocation ?? splitDivision(meta.division).location;
}

/** 게재연도 — 게재 시작일의 연도. 시작일이 없으면 작성일(createdAt)의 연도로 대신한다(태그 묶음용). */
export function postingYear(meta: Pick<PostingMeta, "periodStart"> & { createdAt?: string }): string | null {
  const src = meta.periodStart ?? meta.createdAt ?? "";
  const y = src.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : null;
}

/** [채용사이트 열기]가 열 주소 — 공고 주소가 있으면 그 주소, 없으면 플랫폼 첫 화면(모르는 플랫폼이면 null). */
export function siteUrlOf(meta: Pick<PostingMeta, "platform" | "postingUrl">): string | null {
  if (meta.postingUrl) return meta.postingUrl;
  const p = (meta.platform ?? "").trim();
  return PLATFORM_HOME[p] ?? null;
}
