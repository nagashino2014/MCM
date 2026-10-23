/*
 * 회사소개서 서체 세트(블루프린트 §5-2) — 제목·본문·숫자 역할에 쓸 서체 조합. 클라이언트 안전(상수만).
 * 디자인 시스템 CSS 의 .kc-fontset--{id} 가 역할 변수(--kc-font-display/body/figure)를 바꾸고, 여기 있는 @font-face 파일이 그 이름을 채운다.
 * 파일은 frontend/public/print-kit/fonts/(TrueType 윤곽 WOFF — PDF 부분 포함용). converter 이미지에 없는 파일은 요청에 자산으로 실어 보낸다(html.ts).
 * 업로드 서체(서체 라이브러리, P5b)는 catalog_fonts·catalog_font_sets 로 이 목록 뒤에 붙는다.
 */

export interface FontFaceFile {
  family: string;
  weight: number;
  file: string;
  /** 크기 보정(%) — 기준 서체(프리텐다드)와 한글 평균 글자 폭을 맞춘다(§5-4). 서체를 바꿔도 넘침이 크게 늘지 않게 */
  sizeAdjust?: number;
}

export interface FontSetDef {
  id: string;
  label: string;
  desc: string;
  /** 역할별 서체 이름(표시용) */
  roles: { display: string; body: string; figure: string };
  faces: FontFaceFile[];
  /** 서체 파일이 있어 고를 수 있는가 */
  available: boolean;
  note?: string;
}

const PRETENDARD: FontFaceFile[] = [
  { family: "Pretendard", weight: 400, file: "Pretendard-Regular.woff" },
  { family: "Pretendard", weight: 600, file: "Pretendard-SemiBold.woff" },
  { family: "Pretendard", weight: 700, file: "Pretendard-Bold.woff" },
];
// 크기 보정값 = 프리텐다드 한글 평균 글자 폭(0.864em) ÷ 그 서체 한글 평균 글자 폭 — 자주 쓰는 소개서 낱말 표본으로 잼(2026-10-22,
// fontTools hmtx). 노토 산스 0.920em → 93.9%, 노토 세리프 굵게 0.966em → 89.4%. 영문·숫자 폭 차이는 ±5% 안.
const NOTO_SANS: FontFaceFile[] = [
  { family: "Noto Sans KR", weight: 400, file: "NotoSansKR-Regular.woff", sizeAdjust: 93.9 },
  { family: "Noto Sans KR", weight: 600, file: "NotoSansKR-SemiBold.woff", sizeAdjust: 93.9 },
  { family: "Noto Sans KR", weight: 700, file: "NotoSansKR-Bold.woff", sizeAdjust: 93.9 },
];
const NOTO_SERIF: FontFaceFile[] = [{ family: "Noto Serif KR", weight: 700, file: "NotoSerifKR-Bold.woff", sizeAdjust: 89.4 }];

export const FONT_SETS: FontSetDef[] = [
  {
    id: "pretendard",
    label: "프리텐다드",
    desc: "기본 세트(확정). 화면·인쇄 모두 또렷한 모던 고딕입니다.",
    roles: { display: "Pretendard", body: "Pretendard", figure: "Pretendard" },
    faces: PRETENDARD,
    available: true,
  },
  {
    id: "noto",
    label: "노토 산스",
    desc: "KESI CI 가이드 전용서체(본고딕 계열). 글자 폭이 조금 넓습니다.",
    roles: { display: "Noto Sans KR", body: "Noto Sans KR", figure: "Noto Sans KR" },
    // 빠진 글자는 프리텐다드로 채운다(CSS 대체 순서와 같음)
    faces: [...NOTO_SANS, ...PRETENDARD],
    available: true,
  },
  {
    id: "serif",
    label: "명조 제목",
    desc: "제목만 노토 세리프(명조), 본문은 노토 산스. 격식 있는 인상입니다.",
    roles: { display: "Noto Serif KR", body: "Noto Sans KR", figure: "Noto Sans KR" },
    faces: [...NOTO_SERIF, ...NOTO_SANS, ...PRETENDARD],
    available: true,
  },
  {
    id: "plex",
    label: "IBM Plex",
    desc: "테크니컬 고딕(IBM Plex Sans KR).",
    roles: { display: "IBM Plex Sans KR", body: "IBM Plex Sans KR", figure: "IBM Plex Sans" },
    faces: [],
    available: false,
    note: "서체 파일이 아직 없습니다 — 서체 라이브러리(업로드)에서 올리면 쓸 수 있습니다.",
  },
];

export const DEFAULT_FONT_SET_ID = "pretendard";

export function fontSetById(id: string | undefined | null): FontSetDef | undefined {
  return FONT_SETS.find((f) => f.id === id);
}

/** 고를 수 있는 세트면 그대로, 아니면 기본 세트 */
export function usableFontSet(id: string | undefined | null): FontSetDef {
  const hit = fontSetById(id);
  return hit && hit.available ? hit : fontSetById(DEFAULT_FONT_SET_ID)!;
}

/** converter 이미지에 미리 넣어 둔 파일(Dockerfile 이 public/print-kit/fonts 를 통째로 COPY — 이미지 다시 만들기 전까지는 P4 의 3개만) */
export const CONVERTER_BUNDLED_FONTS = new Set(PRETENDARD.map((f) => f.file));
