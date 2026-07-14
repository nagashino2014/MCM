// 발주 신호 수집 설정 — 소스별 파라미터를 DB(intel_settings)로 이관.
// DEFAULTS 가 현재 운영값(기존 하드코딩과 동일)이며, DB 에는 사용자가 바꾼 오버라이드만 저장된다.
// 야간 배치(intel-batch)와 수동 수집 라우트가 이 설정을 읽어 각 수집기에 옵션으로 전달한다.
import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { INTEGRATED_PERMIT_INDUSTRIES } from "@/lib/ieps/integrated-permit-industries";

/** 통합허가 대상 업종 항목 — LLM 업종 태깅 후보군(수집 설정에서 추가/삭제로 신규 편입 대응). */
export interface IntelIndustryItem {
  id: string;
  label: string;
  /** 프롬프트 힌트(선택) — 예: "데이터센터 냉각·전력설비 포함" */
  note?: string;
}

export interface IntelCollectSettings {
  common: {
    /** 공시·접수일 수집 하한(개월). 현재일 - N개월보다 오래된 건은 저장하지 않는다. 0 = 제한 없음 */
    maxAgeMonths: number;
  };
  industries: {
    /** 통합허가 대상 업종 목록. 기본 = INTEGRATED_PERMIT_INDUSTRIES 파생, 목록 전체 교체 방식 오버라이드 */
    list: IntelIndustryItem[];
  };
  dart: {
    enabled: boolean;
    /** 야간 배치 소급 일수(전일 증분=1) */
    days: number;
    /** 2차 원문(발주처 대조) 분석 사용 여부 */
    counterpartyScan: boolean;
  };
  eiass: {
    enabled: boolean;
    /** 평가종류별 리스트 페이지 수(10행/페이지) */
    maxPages: number;
    /** 사업명 포함 키워드(정규식 alternation 소스) */
    positiveKeywords: string[];
    /** 사업명 제외 키워드 */
    negativeKeywords: string[];
  };
  news: {
    enabled: boolean;
    /** 네이버 뉴스 검색 키워드 */
    keywords: string[];
    /** 키워드당 검색 건수(1~200 — 100 초과는 API 페이지 분할) */
    displayPerKeyword: number;
    /** 일일 AI 분류 상한(비용 통제). 0 = 무제한 */
    maxClassify: number;
  };
  press: {
    enabled: boolean;
    /** 지자체 어댑터별 사용 여부 */
    adapters: Record<string, boolean>;
    titleKeywords: string[];
    deptKeywords: string[];
  };
  gosi: {
    enabled: boolean;
    /** 토지이음 검색 키워드 */
    eumKeywords: string[];
    /** 토지이음 키워드당 페이지 수 */
    maxPagesPerKeyword: number;
    /** 환경청 RSS 사용 여부(orgCd 별) */
    rssEnabled: boolean;
  };
}

export const INTEL_SETTINGS_KEY = "collect";

export const INTEL_COLLECT_DEFAULTS: IntelCollectSettings = {
  common: { maxAgeMonths: 18 },
  industries: {
    list: INTEGRATED_PERMIT_INDUSTRIES.map((i) => ({ id: i.id, label: i.label })),
  },
  dart: { enabled: true, days: 1, counterpartyScan: true },
  eiass: {
    enabled: true,
    maxPages: 5,
    positiveKeywords: [
      "산업단지", "농공단지", "산단", "공장", "제조", "생산시설", "생산라인",
      "발전소", "발전사업", "복합발전", "열병합", "소각", "폐기물", "매립장", "자원순환", "재활용시설",
    ],
    negativeKeywords: ["태양광", "풍력", "연료전지"],
  },
  news: {
    enabled: true,
    keywords: [
      "공장 증설", "공장 신설", "생산시설 투자", "신규 공장 건설",
      "공장 착공", "증설 투자", "공장 신축", "생산라인 증설",
    ],
    displayPerKeyword: 30,
    maxClassify: 300,
  },
  press: {
    enabled: true,
    adapters: {
      ulsan: true, jeonnam: true, gyeongbuk: true, chungnam: true,
      gyeonggi: true, gyeongnam: true, jeonbuk: true, mcee: true,
    },
    titleKeywords: [
      "투자협약", "투자유치", "투자 유치", "MOU", "양해각서", "공장", "증설", "신설",
      "착공", "산업단지", "산단", "생산시설", "생산라인", "유치 협약", "투자",
    ],
    deptKeywords: ["투자", "기업유치"],
  },
  gosi: {
    enabled: true,
    eumKeywords: ["산업단지", "농공단지"],
    maxPagesPerKeyword: 1,
    rssEnabled: true,
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** DEFAULTS 위에 저장된 오버라이드를 깊은 병합(배열은 통째 교체). */
function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : (patch as T)) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in (base as Record<string, unknown>))) continue; // 알 수 없는 키는 무시(스키마 보호)
    out[k] = deepMerge((base as Record<string, unknown>)[k], v);
  }
  return out as T;
}

export async function loadIntelSettings(db: PgDatabase): Promise<IntelCollectSettings> {
  try {
    const rows = rowsToObjects(
      await db.exec(`SELECT setting_json FROM intel_settings WHERE setting_key = $1`, [INTEL_SETTINGS_KEY])
    );
    if (!rows.length) return INTEL_COLLECT_DEFAULTS;
    const raw = rows[0].setting_json;
    const patch = typeof raw === "string" ? JSON.parse(raw) : raw;
    return deepMerge(INTEL_COLLECT_DEFAULTS, patch);
  } catch {
    // 테이블 부재(마이그레이션 전)·파싱 오류 시에도 수집은 기본값으로 계속
    return INTEL_COLLECT_DEFAULTS;
  }
}

export async function saveIntelSettings(
  db: PgDatabase,
  patch: unknown,
  updatedBy: string | null
): Promise<IntelCollectSettings> {
  const merged = deepMerge(INTEL_COLLECT_DEFAULTS, patch);
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO intel_settings (setting_key, setting_json, updated_at, updated_by)
     VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (setting_key) DO UPDATE
       SET setting_json = EXCLUDED.setting_json,
           updated_at = EXCLUDED.updated_at,
           updated_by = EXCLUDED.updated_by`,
    [INTEL_SETTINGS_KEY, JSON.stringify(merged), now, updatedBy]
  );
  return merged;
}

/** 공시·접수일 하한(ISO 날짜 문자열). maxAgeMonths=0 이면 null(제한 없음). */
export function disclosureCutoffIso(settings: IntelCollectSettings, now = new Date()): string | null {
  const months = settings.common.maxAgeMonths;
  if (!months || months <= 0) return null;
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** disclosed_at(ISO 유사 문자열)이 하한보다 오래됐으면 true. 날짜 미상은 저장 유지(false). */
export function isOlderThanCutoff(disclosedAt: string | null | undefined, cutoffIso: string | null): boolean {
  if (!cutoffIso || !disclosedAt) return false;
  const d = String(disclosedAt).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(d) && d < cutoffIso;
}
