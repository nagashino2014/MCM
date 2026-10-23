/*
 * 회사소개서 문서(판) 설정 — 표지 디자인·표지 사진·서체 세트. 클라이언트 안전(DB 접근은 projects.ts).
 * 문서마다 catalog_documents.theme(jsonb)에 저장한다. 렌더러(P4)는 표지 루트에 `kc-front--{cover}` 를 붙인다.
 * 표지 4안(사용자 지시 10-22): A 잎 창·D 사진 띠는 확정, B 세 기둥·C 중앙 정렬은 확정 대기라 이름·모양이 바뀔 수 있다
 *   → 선택지는 이 상수 하나로만 관리한다(화면·검증·렌더러가 모두 이 목록을 본다).
 */

import { FONT_SETS } from "./fonts";

export const COVER_DESIGNS = [
  { id: "leaf", label: "A 잎 창", desc: "사옥 사진을 잎 모양 창에 담은 표지", photo: "hq-cover-tall", confirmed: true },
  { id: "strips", label: "B 세 기둥", desc: "사진 한 장을 위가 둥근 세 기둥으로 나눠 엇갈려 세운 표지", photo: "hq-cover-tall", confirmed: false },
  { id: "center", label: "C 중앙 정렬", desc: "가운데 축·안쪽 테로 정리한 사진 없는 표지", photo: null, confirmed: false },
  { id: "band", label: "D 사진 띠", desc: "가로로 긴 사옥 사진 띠를 둔 표지", photo: "hq-cover-wide", confirmed: true },
] as const;

export type CoverDesign = (typeof COVER_DESIGNS)[number]["id"];
export const DEFAULT_COVER: CoverDesign = "leaf";

/** 기본 서체 세트(D2 변경, 10-22) — 세트 목록은 lib/catalog/fonts.ts FONT_SETS */
export const DEFAULT_FONT_SET = "pretendard";
export const FONT_SET_LABEL: Record<string, string> = Object.fromEntries(FONT_SETS.map((f) => [f.id, f.label]));

/** 색 컨셉(D12, 스튜디오 L2) — 디자인 시스템 테마 A·B·C. A 네이비가 확정 기본값 */
export const COLOR_CONCEPTS = [
  { id: "navy", label: "A 네이비", desc: "CI 메인 네이비(확정)" },
  { id: "green", label: "B 그린", desc: "CI 그린 바탕" },
  { id: "charcoal", label: "C 차콜", desc: "차콜 + 그린 강조" },
] as const;
export type ColorConcept = (typeof COLOR_CONCEPTS)[number]["id"];
export const DEFAULT_CONCEPT: ColorConcept = "navy";

export interface DocumentTheme {
  fontSet: string;
  cover: CoverDesign;
  /** photo = 안의 사진을 씀, none = 사진 없는 변형(C 는 원래 사진 없음) */
  coverPhoto: "photo" | "none";
  /** 색 컨셉 — 쪽 루트의 kc-concept--{concept} */
  concept: ColorConcept;
}

export const DEFAULT_DOCUMENT_THEME: DocumentTheme = { fontSet: DEFAULT_FONT_SET, cover: DEFAULT_COVER, coverPhoto: "photo", concept: DEFAULT_CONCEPT };

export function isColorConcept(v: unknown): v is ColorConcept {
  return COLOR_CONCEPTS.some((c) => c.id === v);
}

export function isCoverDesign(v: unknown): v is CoverDesign {
  return COVER_DESIGNS.some((c) => c.id === v);
}

/** 저장값·요청값 정리 — 모르는 표지는 기본값(A 잎 창), 빠진 키는 기본값. */
export function sanitizeDocumentTheme(input: unknown): DocumentTheme {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const fontSet = typeof o.fontSet === "string" && /^[a-z0-9-]{1,40}$/.test(o.fontSet) ? o.fontSet : DEFAULT_FONT_SET;
  return {
    fontSet,
    cover: isCoverDesign(o.cover) ? o.cover : DEFAULT_COVER,
    coverPhoto: o.coverPhoto === "none" ? "none" : "photo",
    concept: isColorConcept(o.concept) ? o.concept : DEFAULT_CONCEPT,
  };
}

/** 렌더러용 표지 루트 클래스 */
export function coverRootClass(theme: DocumentTheme): string {
  return `kc-front--${theme.cover}`;
}
