/*
 * 회사소개서 새 사업 분야(P6, 블루프린트 §7-2 6) — 계약 관리 5분류 + 응용소프트웨어 밖에서 소개서에만 더하는 분야. 클라이언트 안전.
 * 저장: catalog_business_areas 행(area_id = "x" + 6자, name = 표기명, color_slot = 분야 색, content = 이 형식) — 311 마이그레이션.
 * 쪽은 분야 상세(C09)와 같은 모양(CustomAreaPage)으로 그리고, 쪽 키는 "area-{area_id}" 라 스튜디오 편집층이 그대로 붙는다.
 * 숫자는 지표 id 로만 — 문안 안 숫자는 {{metric:지표 id}} 표식, KPI 는 지표 id 목록, 대표 실적은 계약 id 목록(실제 계약에서 그린다).
 */
import { CATALOG_CATEGORIES } from "./areas";
import { INFO_TYPE_META, isInfoType, type InfoType } from "./render/infographic/types";

export interface CustomAreaStep {
  label: string;
  desc: string;
}

export interface CustomAreaContent {
  /** 분야 아이콘(lucide 이름) */
  icon: string;
  /** 리드 문장 — {{metric:id}} 표식 가능 */
  lead: string;
  services: string[];
  processTitle: string;
  process: CustomAreaStep[];
  /** 절차 인포그래픽 유형(목록형만, 기본 단계 흐름) */
  infoType: InfoType;
  /** KPI 지표 id(최대 4) */
  kpis: string[];
  /** 대표 실적 계약 id(최대 4) */
  featured: string[];
  /** 히어로 큰 숫자 설명(첫 KPI 지표) */
  heroCaption: string;
  casesAside: string;
  /** 관련 계약 분류(지표·대표 실적 후보의 범위) */
  relatedCategories: string[];
  /** 만든 방법 — ai(LLM 제안 채택) | rule(규칙 초안) | mixed */
  source: "ai" | "rule" | "mixed";
  /** 사람 검토 전 초안 표시(작업본에 초안 표식) */
  draft: boolean;
}

export interface CustomAreaDef {
  areaId: string;
  name: string;
  /** 분야 색 슬롯 1~6(area-n) */
  slot: number;
  orderNo: number;
  content: CustomAreaContent;
}

export const CUSTOM_AREA_ID_RE = /^x[a-z0-9]{6}$/;
export const CUSTOM_AREA_LIMITS = { name: 24, lead: 220, service: 40, services: [3, 7], step: 12, stepDesc: 40, steps: [3, 6], kpis: 4, featured: 4 } as const;

const ICON_RE = /^[a-z0-9-]{1,30}$/;
const METRIC_RE = /^[a-z0-9.]{1,40}$/;

const str = (v: unknown, max: number): string =>
  (typeof v === "string" ? v : "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export function newCustomAreaId(): string {
  return "x" + Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

/** 저장값·요청값 정리 */
export function sanitizeCustomAreaContent(input: unknown): CustomAreaContent {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const list = (v: unknown, max: number, len: number) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : []);
  const process = (Array.isArray(o.process) ? o.process : [])
    .map((raw) => {
      const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return { label: str(r.label, 30), desc: str(r.desc, 80) };
    })
    .filter((st) => st.label)
    .slice(0, 7);
  const related = list(o.relatedCategories, 6, 30).filter((c) => (CATALOG_CATEGORIES as readonly string[]).includes(c));
  return {
    icon: typeof o.icon === "string" && ICON_RE.test(o.icon) ? o.icon : "leaf",
    lead: str(o.lead, 400),
    services: list(o.services, 8, 80),
    processTitle: str(o.processTitle, 30) || "수행 절차",
    process,
    infoType: isInfoType(o.infoType) && INFO_TYPE_META[o.infoType].family === "list" && !INFO_TYPE_META[o.infoType].needs ? o.infoType : "process",
    kpis: list(o.kpis, CUSTOM_AREA_LIMITS.kpis, 40).filter((k) => METRIC_RE.test(k)),
    featured: list(o.featured, CUSTOM_AREA_LIMITS.featured, 80),
    heroCaption: str(o.heroCaption, 60),
    casesAside: str(o.casesAside, 30) || "발주처 · 수행 기간",
    relatedCategories: related,
    source: o.source === "ai" || o.source === "mixed" ? o.source : "rule",
    draft: o.draft !== false,
  };
}

export function sanitizeAreaName(v: unknown): string {
  return str(v, CUSTOM_AREA_LIMITS.name);
}
