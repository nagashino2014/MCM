/*
 * 회사소개서 템플릿 5종 — "템플릿 = 테마 + 쪽 변형 묶음"(사용자 결정 2026-10-29, 계획서 docs/catalog-templates-plan.md §2·§3-1).
 * 클라이언트 안전(상수·순수 함수만). 새 문서를 만들 때 고르며 문서마다 고정된다(DocumentTheme.template) — 편집층 노드 id 가
 * 마크업 구조 해시라 템플릿을 바꾸면 편집이 고아가 되기 때문. 마스터 문서는 standard 고정.
 *
 * TP0(기반)에서는 정의·배관만 둔다: 쪽 변형(variants)은 아직 비어 있고(TP2), 쪽 계획 종류(plan) formal/brief 분기는 plan.tsx 의 TODO,
 * 색 컨셉 B·C 값은 임시값(tokens.json, TP1 디자인에서 교체). 선택지 이름은 화면 표기용이라 뒤에 바꿀 수 있다(결정 T-1).
 */
import { DEFAULT_DOCUMENT_THEME, type DocumentTheme, type TemplateId } from "./document-theme";
import type { PageVariant } from "./render/components/plan";

export type { TemplateId } from "./document-theme";

/** 쪽 계획 종류 — full 은 지금 목차, formal 은 신뢰 근거 앞으로·부록 A 본편, brief 는 요약 8~12쪽(C20 분야 1장 요약), research 는 제안서형(회사개요 → 분야·역량 → 주제 개관·동향·절차 → 인력(임원 이력서형) → 수행실적) */
export type TemplatePlanKind = "full" | "formal" | "brief" | "research";

export interface CatalogTemplate {
  id: TemplateId;
  label: string;
  desc: string;
  /** 새 문서의 기본 테마(template 포함) — 문서를 만든 뒤에는 색·서체·표지·모티프만 바꿀 수 있다 */
  theme: DocumentTheme;
  /** 쪽 계획 종류(plan.tsx 분기 키) */
  plan: TemplatePlanKind;
  /** 쪽 키(예: "c05"·"area-1") 또는 쪽 유형(예: "C09") → 기본 변형. PageEdits.variant 가 덮어쓴다. 쪽 키가 쪽 유형보다 우선 */
  variants: Record<string, PageVariant>;
  /** 사진이 필요한 변형에 자산이 없을 때 대신 쓰는 템플릿(TP2) */
  fallback?: "graphic";
  /** 미리보기·쪽 검사에서 "부족한 자산" 안내용(TP2) */
  requires?: { photos?: string[] };
}

const theme = (patch: Partial<DocumentTheme> & { template: TemplateId }): DocumentTheme => ({ ...DEFAULT_DOCUMENT_THEME, ...patch });

export const CATALOG_TEMPLATES: Record<TemplateId, CatalogTemplate> = {
  standard: {
    id: "standard",
    label: "스탠다드",
    desc: "네이비 · A 잎 창 표지 · 물방울 모티프 · 프리텐다드 · 풀버전(지금 모습, 마스터 문서)",
    theme: theme({ template: "standard" }),
    plan: "full",
    variants: {},
  },
  photo: {
    id: "photo",
    label: "포토 에디토리얼",
    desc: "사진 중심 — 전면 사진 간지·사진 배경 숫자 띠·큰 히어로 사진. 민간 사업장·홈페이지 다운로드용",
    // 표지 E 전면 사진은 TP2 신규 — 그전까지 D 사진 띠
    theme: theme({ template: "photo", cover: "band", coverPhoto: "photo", concept: "navy", motif: "drop" }),
    plan: "full",
    variants: {},
    fallback: "graphic",
    requires: { photos: ["c07", "c04", "C09", "c13"] },
  },
  graphic: {
    id: "graphic",
    label: "인포그래픽형",
    desc: "사진 없음 — 그린 바탕 · 링 모티프 · 아이콘+큰 숫자 · 인포그래픽 확대. 사진 부족 시 기본·화면 발표용",
    // 표지 F 그래픽은 C 중앙 정렬 파생(TP2) — 그전까지 C 중앙 정렬(사진 없음)
    theme: theme({ template: "graphic", cover: "center", coverPhoto: "none", concept: "green", motif: "ring" }),
    plan: "full",
    variants: {},
  },
  formal: {
    id: "formal",
    label: "격조·공공형",
    desc: "차콜 + 그린 강조 · 등고선 모티프 · 신뢰 근거(인증·실적 총괄)를 사업 분야 앞으로. 공공 PQ 심사·입찰 증빙용",
    // 서체는 기본 프리텐다드(사용자 지시 2026-10-29: 세리프 제목은 회사소개서에 어울리지 않음 — 세리프 세트는 선택지로만 남김)
    theme: theme({ template: "formal", cover: "strips", coverPhoto: "photo", concept: "charcoal", motif: "contour" }),
    plan: "formal",
    variants: {},
  },
  brief: {
    id: "brief",
    label: "요약·분야 브리프",
    desc: "표지 → 숫자 → 분야 개관 → 선택 분야 1장 요약 → 핵심 역량 → 인증 → 연락처(8~12쪽, 부록 없음). 제안서·견적 첨부용",
    theme: theme({ template: "brief", cover: "band", coverPhoto: "photo", concept: "navy", motif: "drop" }),
    plan: "brief",
    variants: {},
  },
  research: {
    id: "research",
    label: "연구소·ESG 제안형",
    desc: "부설연구소(탄소중립 미래연구소) ESG 연구 용역 소개서 양식 — 스틸 블루 · 네이비 머리 띠 · G 연구소형 표지 · 제안사 일반현황 → 사업 분야·핵심 역량 → 주제 개관·동향·수행 절차 → 임원 이력서형 인력 → 수행실적",
    // 양식 원본: "[한국환경안전연구원] 회사소개서_260902(최종).pptx"(2026-09, 26쪽). 쪽 계획 research·주제 쪽(C21~C23)은 TP2
    theme: theme({ template: "research", cover: "research", coverPhoto: "photo", concept: "steel", motif: "drop" }),
    plan: "research",
    variants: { C10: { cards: "icon-large" }, C13: { card: "list" }, C16: { view: "table" } },
    requires: { photos: ["c01"] },
  },
};

export const TEMPLATE_LIST: CatalogTemplate[] = Object.values(CATALOG_TEMPLATES);

/** id → 템플릿(모르는 값·없음 = standard) */
export function templateOf(id: string | null | undefined): CatalogTemplate {
  return (id && (CATALOG_TEMPLATES as Record<string, CatalogTemplate>)[id]) || CATALOG_TEMPLATES.standard;
}

/** 쪽의 기본 변형 — 쪽 유형 값 위에 쪽 키 값을 얹는다 */
export function templateVariant(template: CatalogTemplate, key: string, type: string): PageVariant {
  return { ...(template.variants[type] ?? {}), ...(template.variants[key] ?? {}) };
}
