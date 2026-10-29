/*
 * 회사소개서 템플릿 6종 — "템플릿 = 테마 + 쪽 변형 묶음"(사용자 결정 2026-10-29, 계획서 docs/catalog-templates-plan.md §2·§3-1).
 * 클라이언트 안전(상수·순수 함수만). 새 문서를 만들 때 고르며 문서마다 고정된다(DocumentTheme.template) — 편집층 노드 id 가
 * 마크업 구조 해시라 템플릿을 바꾸면 편집이 고아가 되기 때문. 마스터 문서는 standard 고정.
 *
 * TP0(기반)에서 정의·배관, TP1(디자인)에서 색·모티프·변형 CSS, TP2(쪽 변형)에서 쪽 컴포넌트 분기·쪽 계획 formal/brief·사진 폴백을 붙였다.
 * 선택지 이름은 화면 표기용이라 뒤에 바꿀 수 있다(결정 T-1).
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
  /** 사진이 필요한 변형에 자산이 없을 때 대신 쓰는 템플릿 — 그 템플릿의 같은 쪽 유형 변형으로 그린다(없으면 기본 변형) */
  fallback?: "graphic";
  /** 미리보기·쪽 검사에서 "부족한 자산" 안내용 — 사진이 필요한 쪽 키·쪽 유형 */
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
    desc: "사진 중심 — 전면 사진 표지·간지, 사진 배경 숫자 띠, 전폭 히어로 사진, 3:4 큰 인물 사진. 민간 사업장·홈페이지 다운로드용. 사진이 없는 쪽은 인포그래픽형 변형으로 그립니다",
    theme: theme({ template: "photo", cover: "photo", coverPhoto: "photo", concept: "navy", motif: "drop" }),
    plan: "full",
    // 사진이 필요한 변형(band·photo-full·photo-wide·portrait-large)은 자산이 없으면 fallback(graphic)의 같은 쪽 유형 변형으로 그린다(plan.tsx resolveVariant)
    variants: { C04: { layout: "band" }, C07: { style: "photo-full" }, C09: { hero: "photo-wide" }, C13: { card: "portrait-large" } },
    fallback: "graphic",
    requires: { photos: ["c01", "c04", "c07-02", "c07-03", "C09", "C13"] },
  },
  graphic: {
    id: "graphic",
    label: "인포그래픽형",
    desc: "사진 없음 — 그린 바탕 · 링 모티프 · F 그래픽 표지 · 색 면 간지 · 아이콘+큰 숫자 카드 8 · 가로 연혁 · 인포그래픽 확대. 사진 부족 시 기본·화면 발표용",
    theme: theme({ template: "graphic", cover: "graphic", coverPhoto: "none", concept: "green", motif: "ring" }),
    plan: "full",
    variants: { C04: { layout: "cards8" }, C06: { axis: "horizontal" }, C07: { style: "color-pattern" }, C09: { hero: "none" }, C10: { cards: "icon-large" } },
  },
  formal: {
    id: "formal",
    label: "격조·공공형",
    desc: "차콜 + 그린 강조 · 등고선 모티프 · 단색 간지 · 연혁 4단 · 임원 목록형 · 인증 목록형 · 신뢰 근거(인증·고객사·실적 총괄)를 사업 분야 앞으로. 공공 PQ 심사·입찰 증빙용",
    // 서체는 기본 프리텐다드(사용자 지시 2026-10-29: 세리프 제목은 회사소개서에 어울리지 않음 — 세리프 세트는 선택지로만 남김)
    theme: theme({ template: "formal", cover: "strips", coverPhoto: "photo", concept: "charcoal", motif: "contour" }),
    plan: "formal",
    variants: { C06: { axis: "columns4" }, C07: { style: "plain" }, C13: { card: "list" }, C16: { view: "table" } },
  },
  brief: {
    id: "brief",
    label: "요약·분야 브리프",
    desc: "표지 → 숫자 → 분야 개관 → 선택 분야 1장 요약 → 핵심 역량 → 인증 → 연락처(8~12쪽, 목차·부록 없음). 제안서·견적 첨부용",
    theme: theme({ template: "brief", cover: "band", coverPhoto: "photo", concept: "navy", motif: "drop" }),
    plan: "brief",
    variants: {},
  },
  research: {
    id: "research",
    label: "연구소·ESG 제안형",
    desc: "부설연구소(탄소중립 미래연구소) ESG 연구 용역 소개서 양식 — 스틸 블루 · 네이비 머리 띠 · G 연구소형 표지 · 제안사 일반현황 → 사업 분야·핵심 역량 → 주제 개관·동향·수행 절차 → 임원 이력서형 인력 → 수행실적",
    // 양식 원본: "[한국환경안전연구원] 회사소개서_260902(최종).pptx"(2026-09, 26쪽). 쪽 계획 research·주제 쪽(C21~C23)은 다음 단계 — 지금은 full 쪽 계획에 변형만
    theme: theme({ template: "research", cover: "research", coverPhoto: "photo", concept: "steel", motif: "drop" }),
    plan: "research",
    variants: { C06: { axis: "columns4" }, C10: { cards: "icon-large" }, C13: { card: "list" }, C16: { view: "table" } },
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

// ── 쪽 변형 선택지(계획서 §3-3) — 스튜디오 디자인 탭 칩·시험·폴백 판정이 같은 표를 본다 ──

export interface VariantField {
  /** PageVariant 키 */
  field: string;
  label: string;
  /** [값, 표기]. 첫 값이 기본(클래스 없음) */
  values: Array<[string, string]>;
  /** 사진(variant.photo 또는 인물 사진)이 있어야 그려지는 값 */
  photo?: string[];
}

/** 쪽 유형 → 변형 축. C01 표지는 DocumentTheme.cover(COVER_DESIGNS), C05 는 기존 visual 축(사진 여부만)이라 여기 없다 */
export const PAGE_VARIANT_FIELDS: Record<string, VariantField[]> = {
  C04: [{ field: "layout", label: "숫자 배치", values: [["grid", "격자(기본)"], ["band", "사진 배경 띠"], ["cards8", "아이콘+큰 숫자 카드 8"]], photo: ["band"] }],
  C06: [{ field: "axis", label: "연혁 축", values: [["columns", "연도 열(기본)"], ["horizontal", "한 줄 축(위·아래)"], ["columns4", "연대별 4단"]] }],
  C07: [{ field: "style", label: "간지 모양", values: [["leaf", "잎 창(기본)"], ["photo-full", "전면 사진"], ["color-pattern", "색 면 + 패턴"], ["plain", "단색"]], photo: ["photo-full"] }],
  C09: [{ field: "hero", label: "분야 히어로", values: [["figure", "숫자(사진 없음)"], ["photo", "사진"], ["photo-wide", "전폭 사진 띠"], ["none", "인포그래픽 확대(사진 자리 없음)"]], photo: ["photo", "photo-wide"] }],
  C10: [{ field: "cards", label: "역량 카드", values: [["compact", "기본"], ["icon-large", "아이콘 큰 변형"]] }],
  C13: [{ field: "card", label: "임원 카드", values: [["square", "정방 사진(기본)"], ["portrait-large", "3:4 큰 사진"], ["list", "목록형(사진 없음)"]], photo: ["portrait-large"] }],
  C16: [{ field: "view", label: "인증 보기", values: [["gallery", "갤러리(기본)"], ["table", "목록형"]] }],
};

/** 폴백 판정 결과 — 그릴 변형과, 폴백했으면 원래 값(쪽 검사 안내용) */
export interface ResolvedVariant {
  variant: PageVariant;
  /** 사진이 없어 바꾼 축 → 원래 값 */
  fallbacks: Array<{ field: string; from: string; to: string }>;
}

/**
 * 쪽 변형 확정 — {템플릿 쪽 유형 값, 템플릿 쪽 키 값, 저장 변형} 을 합친 뒤, 사진이 필요한 값인데 사진이 없으면
 * 템플릿 fallback(graphic)의 같은 쪽 유형 변형(없으면 기본값)으로 바꾼다. 안내는 fallbacks 로 돌려주고 PageVariant 에는 넣지 않는다(저장 금지 키).
 * @param hasPhoto 축별 사진 유무 — 기본은 variant.photo 유무
 */
export function resolveVariant(
  template: CatalogTemplate,
  key: string,
  type: string,
  saved: PageVariant | undefined,
  hasPhoto: (field: string, variant: PageVariant) => boolean = (_f, v) => Boolean(v.photo)
): ResolvedVariant {
  const variant: PageVariant = { ...templateVariant(template, key, type), ...(saved ?? {}) };
  const fallbacks: ResolvedVariant["fallbacks"] = [];
  for (const f of PAGE_VARIANT_FIELDS[type] ?? []) {
    const cur = variant[f.field];
    if (!cur || !f.photo?.includes(cur) || hasPhoto(f.field, variant)) continue;
    // hero: "photo" 는 기존 동작(사진 없으면 숫자 변형으로 조용히) — 안내는 템플릿 변형(photo-wide 등)에만
    if (type === "C09" && cur === "photo") continue;
    const alt = template.fallback ? templateVariant(templateOf(template.fallback), key, type)[f.field] : undefined;
    const to = alt && !f.photo.includes(alt) ? alt : f.values[0][0];
    fallbacks.push({ field: f.field, from: cur, to });
    if (to === f.values[0][0]) delete variant[f.field];
    else variant[f.field] = to;
  }
  return { variant, fallbacks };
}

/** 폴백 안내 문구(쪽 검사·확인할 내용) */
export function fallbackNote(type: string, fb: ResolvedVariant["fallbacks"]): string | undefined {
  if (!fb.length) return undefined;
  const fields = PAGE_VARIANT_FIELDS[type] ?? [];
  const name = (field: string, v: string) => fields.find((f) => f.field === field)?.values.find(([id]) => id === v)?.[1] ?? v;
  return fb.map((x) => `사진 없음 — ${name(x.field, x.from)} 대신 ${name(x.field, x.to)} 변형으로 그림`).join(" · ");
}

// ── 쪽 계획 종류별 섹션 번호·순서(목차·쪽 머리·북마크가 같은 표를 본다) ──

export interface PlanSection {
  /** master-content SECTIONS 의 key(원래 번호) */
  key: string;
  /** 이 쪽 계획에서 보여 줄 번호 */
  num: string;
  /** 목차 설명 덮어쓰기(없으면 SECTIONS.desc) */
  desc?: string;
}

const FULL_SECTIONS: PlanSection[] = ["01", "02", "03", "04", "05", "06", "부록"].map((k) => ({ key: k, num: k }));

/** 쪽 계획 종류 → 섹션 순서·번호. formal 은 신뢰 근거(05)를 사업 분야 앞 02 로, 부록 A 가 본편(신뢰 근거)에 들어가 부록은 B·C 만. brief 는 목차·부록 없이 5개 섹션 */
export const PLAN_SECTIONS: Record<TemplatePlanKind, PlanSection[]> = {
  full: FULL_SECTIONS,
  research: FULL_SECTIONS,
  formal: [
    { key: "01", num: "01" },
    { key: "05", num: "02", desc: "인증·등록·특허 · 주요 고객사·협력 기관 · 수행실적 총괄" },
    { key: "02", num: "03" },
    { key: "03", num: "04" },
    { key: "04", num: "05" },
    { key: "06", num: "06" },
    { key: "부록", num: "부록", desc: "B 분야별 수행실적 목록 · C 수행인력 상세 이력" },
  ],
  brief: [
    { key: "01", num: "01", desc: "숫자로 보는 KESI" },
    { key: "02", num: "02", desc: "사업 분야 개관 · 분야 1장 요약" },
    { key: "03", num: "03", desc: "핵심 역량" },
    { key: "05", num: "04", desc: "인증·등록·특허" },
    { key: "06", num: "05" },
  ],
};

/** 섹션 원래 번호 → 이 쪽 계획의 표시 번호(모르는 값·부록 A 같은 머리 문구는 그대로) */
export function sectionNum(plan: TemplatePlanKind, key: string): string {
  return PLAN_SECTIONS[plan].find((s) => s.key === key)?.num ?? key;
}
