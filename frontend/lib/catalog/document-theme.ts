/*
 * 회사소개서 문서(판) 설정 — 템플릿·표지 디자인·표지 사진·서체 세트·색 컨셉·모티프. 클라이언트 안전(DB 접근은 projects.ts).
 * 문서마다 catalog_documents.theme(jsonb)에 저장한다. 렌더러(P4)는 표지 루트에 `kc-front--{cover}`, 쪽 루트에
 * `kc-tpl--{template} kc-motif--{motif} kc-concept--{concept}` 를 붙인다.
 * 표지 7안: A 잎 창·D 사진 띠는 10-22 확정, B 세 기둥·C 중앙 정렬은 TP1 시안(10-29)을 거쳐 사용자가 현재 안으로 확정했다(계획서 T-4).
 *   E 전면 사진(포토 에디토리얼)·F 그래픽(인포그래픽형, 10-29 모티프 궤도로 재설계)은 TP2 에서 더했다. 선택지는 이 상수 하나로만 관리한다(화면·검증·렌더러가 모두 이 목록을 본다).
 * 템플릿(TP0, 계획서 docs/catalog-templates-plan.md §3-1): 새 문서를 만들 때 고르고 문서마다 고정한다 — 편집층 노드 id 가
 *   마크업 구조 해시라 템플릿을 바꾸면 편집이 고아가 되기 때문. 같은 문서 안에서는 색·서체·표지·모티프만 바꾼다.
 *   템플릿 정의(기본 테마·쪽 변형)는 lib/catalog/templates.ts.
 */

import { FONT_SETS } from "./fonts";

export const COVER_DESIGNS = [
  { id: "leaf", label: "A 잎 창", desc: "사옥 사진을 잎 모양 창에 담은 표지", photo: "hq-cover-tall", confirmed: true },
  { id: "strips", label: "B 세 기둥", desc: "사진 한 장을 위가 둥근 세 기둥으로 나눠 엇갈려 세운 표지", photo: "hq-cover-tall", confirmed: true },
  { id: "center", label: "C 중앙 정렬", desc: "가운데 축·안쪽 테로 정리한 사진 없는 표지", photo: null, confirmed: true },
  { id: "band", label: "D 사진 띠", desc: "가로로 긴 사옥 사진 띠를 둔 표지", photo: "hq-cover-wide", confirmed: true },
  { id: "photo", label: "E 전면 사진", desc: "사진을 쪽 전면에 깔고 아래 반투명 판 위에 글을 둔 표지(포토 에디토리얼 기본). 사진이 없으면 F 그래픽으로 그립니다", photo: "hq-cover-wide", confirmed: true },
  { id: "graphic", label: "F 그래픽", desc: "왼쪽 글 단과 오른쪽 모티프 궤도(큰 물방울·윤곽 물방울·분야 6색 노드)로 꾸민 사진 없는 표지(인포그래픽형 기본)", photo: null, confirmed: true },
  { id: "research", label: "G 연구소형", desc: "왼쪽 연한 하늘빛 면에 자간 넓은 제목과 밑줄, 오른쪽에 사옥 사진을 둔 제안서형 표지(연구소·ESG 제안형 양식)", photo: "hq-cover-tall", confirmed: true },
] as const;

export type CoverDesign = (typeof COVER_DESIGNS)[number]["id"];
export const DEFAULT_COVER: CoverDesign = "leaf";

/** 기본 서체 세트(D2 변경, 10-22) — 세트 목록은 lib/catalog/fonts.ts FONT_SETS */
export const DEFAULT_FONT_SET = "pretendard";
export const FONT_SET_LABEL: Record<string, string> = Object.fromEntries(FONT_SETS.map((f) => [f.id, f.label]));

/** 색 컨셉(D12, 스튜디오 L2) — 디자인 시스템 테마 A·B·C(TP1 2026-10-29 확정값)·D 스틸 블루(연구소·ESG 제안형 양식, 2026-10-29). 값은 tokens.json */
export const COLOR_CONCEPTS = [
  { id: "navy", label: "A 네이비", desc: "CI 메인 네이비(확정)" },
  { id: "green", label: "B 그린", desc: "CI 그린 바탕" },
  { id: "charcoal", label: "C 차콜", desc: "차콜 + 그린 강조" },
  { id: "steel", label: "D 스틸 블루", desc: "연구소 제안서 양식의 청회색 — 네이비 머리 띠·청회색 글자·연한 회청 패널" },
] as const;
export type ColorConcept = (typeof COLOR_CONCEPTS)[number]["id"];
export const DEFAULT_CONCEPT: ColorConcept = "navy";

/** 템플릿 id — 정의는 lib/catalog/templates.ts CATALOG_TEMPLATES(여기는 순환 참조를 피하려고 id 목록만) */
export const TEMPLATE_IDS = ["standard", "photo", "graphic", "formal", "brief", "research"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export const DEFAULT_TEMPLATE: TemplateId = "standard";

/**
 * 모티프(CI 그래픽 모티프, 디자인 시스템 .kc-motif--*) — 표지·간지·뒤표지와 요소 모서리 모양.
 * 물방울(drop) 하나만 남긴다: TP1 의 링(ring)·등고선(contour)은 2026-10-30 사용자 지시("별로 마음에 들지 않음, 폐기")로 폐기했다 —
 * 새 템플릿을 만들 때 참고 자료를 보강해 다시 설계한다. 저장된 ring·contour 는 sanitizeDocumentTheme 이 drop 으로 읽는다(모르는 값 = 기본값).
 */
export const MOTIFS = [{ id: "drop", label: "물방울", desc: "물방울·잎 모양(지금 모습)" }] as const;
export type Motif = (typeof MOTIFS)[number]["id"];
export const DEFAULT_MOTIF: Motif = "drop";

export interface DocumentTheme {
  /** 템플릿(문서별 고정 — 새 문서 만들 때만 정한다). 저장값이 없으면 standard */
  template: TemplateId;
  fontSet: string;
  cover: CoverDesign;
  /** photo = 안의 사진을 씀, none = 사진 없는 변형(C 는 원래 사진 없음) */
  coverPhoto: "photo" | "none";
  /** 색 컨셉 — 쪽 루트의 kc-concept--{concept} */
  concept: ColorConcept;
  /** 모티프 — 쪽 루트의 kc-motif--{motif}. 저장값이 없으면 drop */
  motif: Motif;
  /** 선택 분야(brief 템플릿의 분야 1장 요약용, 분야 번호 1~6) — 다른 템플릿은 비움 */
  areas?: number[];
}

export const DEFAULT_DOCUMENT_THEME: DocumentTheme = {
  template: DEFAULT_TEMPLATE,
  fontSet: DEFAULT_FONT_SET,
  cover: DEFAULT_COVER,
  coverPhoto: "photo",
  concept: DEFAULT_CONCEPT,
  motif: DEFAULT_MOTIF,
};

export function isColorConcept(v: unknown): v is ColorConcept {
  return COLOR_CONCEPTS.some((c) => c.id === v);
}

export function isCoverDesign(v: unknown): v is CoverDesign {
  return COVER_DESIGNS.some((c) => c.id === v);
}

export function isTemplateId(v: unknown): v is TemplateId {
  return TEMPLATE_IDS.some((id) => id === v);
}

export function isMotif(v: unknown): v is Motif {
  return MOTIFS.some((m) => m.id === v);
}

/** 선택 분야 정리 — 1~6 정수, 중복 제거, 오름차순. 비어 있으면 undefined */
export function sanitizeAreas(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 6))].sort((a, b) => a - b);
  return out.length ? out : undefined;
}

/** 저장값·요청값 정리 — 모르는 표지는 기본값(A 잎 창), 빠진 키는 기본값(템플릿 standard·모티프 drop → 기존 문서는 그대로). 폐기한 모티프(ring·contour)도 drop. */
export function sanitizeDocumentTheme(input: unknown): DocumentTheme {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const fontSet = typeof o.fontSet === "string" && /^[a-z0-9-]{1,40}$/.test(o.fontSet) ? o.fontSet : DEFAULT_FONT_SET;
  const areas = sanitizeAreas(o.areas);
  return {
    template: isTemplateId(o.template) ? o.template : DEFAULT_TEMPLATE,
    fontSet,
    cover: isCoverDesign(o.cover) ? o.cover : DEFAULT_COVER,
    coverPhoto: o.coverPhoto === "none" ? "none" : "photo",
    concept: isColorConcept(o.concept) ? o.concept : DEFAULT_CONCEPT,
    motif: isMotif(o.motif) ? o.motif : DEFAULT_MOTIF,
    ...(areas ? { areas } : {}),
  };
}

/**
 * 테마 변경 요청에서 바꿀 수 있는 항목만 고른다(올바른 값만 — 기본값으로 덮어쓰지 않게).
 * template 은 문서별 고정이라 여기서 빠진다(서버 저장 경로 둘 — projects.ts saveDocumentTheme·studio/store.ts — 가 같은 규칙을 쓴다).
 */
export function pickThemePatch(patch: Partial<DocumentTheme> | Record<string, unknown> | undefined): Partial<DocumentTheme> {
  const t = (patch ?? {}) as Record<string, unknown>;
  const clean: Partial<DocumentTheme> = {};
  if (isCoverDesign(t.cover)) clean.cover = t.cover;
  if (t.coverPhoto === "photo" || t.coverPhoto === "none") clean.coverPhoto = t.coverPhoto;
  if (typeof t.fontSet === "string" && /^[a-z0-9-]{1,40}$/.test(t.fontSet)) clean.fontSet = t.fontSet;
  if (isColorConcept(t.concept)) clean.concept = t.concept;
  if (isMotif(t.motif)) clean.motif = t.motif;
  if ("areas" in t) clean.areas = sanitizeAreas(t.areas);
  return clean;
}

/** 렌더러용 표지 루트 클래스 */
export function coverRootClass(theme: DocumentTheme): string {
  return `kc-front--${theme.cover}`;
}
