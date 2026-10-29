/*
 * 회사소개서 서체 세트(블루프린트 §5-2) — 제목·본문·숫자 역할에 쓸 서체 조합. 클라이언트 안전(상수·순수 함수만).
 * 디자인 시스템 CSS 의 .kc-fontset--{id} 가 역할 변수(--kc-font-display/body/figure)를 바꾸고, 여기 있는 @font-face 파일이 그 이름을 채운다.
 * 파일은 frontend/public/print-kit/fonts/(TrueType 윤곽 WOFF — PDF 부분 포함용). converter 이미지에 없는 파일은 요청에 자산으로 실어 보낸다(html.ts).
 * 업로드 서체(서체 라이브러리, P5b)는 catalog_fonts·catalog_font_sets 로 이 목록 뒤에 붙는다 — 세트 하나를 buildCustomFontSet 이
 * 역할별 별칭 서체(kcs-{세트}-{역할}) @font-face 와 .kc-fontset--{세트} 변수 CSS 로 바꾼다(디자인 시스템 CSS 는 손대지 않는다).
 */

import {
  CSS_WEIGHTS,
  FONT_ROLES,
  FONT_ROLE_LABEL,
  type CatalogFont,
  type CatalogFontSet,
  type FontClass,
  type FontRole,
  type WeightMap,
} from "./font-types";

export interface FontFaceFile {
  family: string;
  weight: number;
  /** 기본 서체 파일 이름(public/print-kit/fonts) — 업로드 서체는 "" */
  file: string;
  /** 크기 보정(%) — 기준 서체(프리텐다드)와 한글 평균 글자 폭을 맞춘다(§5-4). 서체를 바꿔도 넘침이 크게 늘지 않게 */
  sizeAdjust?: number;
  /** 윗·아랫 높이 보정(%, size-adjust 를 곱한 크기 기준) — 기준 서체와 줄 안 글자 자리를 맞춘다(업로드 세트) */
  ascentOverride?: number;
  descentOverride?: number;
  lineGapOverride?: number;
  /** 업로드 서체 — 미리보기 주소·PDF 자산을 찾는 정보(woffKey = 저장소 키) */
  upload?: { fontId: string; fileWeight: number; woffKey: string };
}

/** 세트 역할 서체(스튜디오 검사용) — family 는 CSS 에 쓰인 이름(계산된 font-family 첫 이름과 맞춰 역할을 찾는다) */
export interface RoleFontInfo {
  fontId: string;
  label: string;
  family: string;
  classification: FontClass;
  source: "bundled" | "upload";
  active: boolean;
  ranges: Array<[number, number]>;
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
  /** 서체 라이브러리에서 만든 세트 */
  custom?: boolean;
  /** 역할 변수 CSS(.kc-fontset--{id}) — 사용자 세트만(기본 세트는 디자인 시스템 CSS 에 있다) */
  css?: string;
  roleFonts?: Record<FontRole, RoleFontInfo>;
  /** 고를 수 없는 이유(본문에 제목 전용 서체 등) */
  issues?: string[];
  /** 고를 수 있지만 알아 둘 것(명조 본문·tnum 없음 등) */
  warnings?: string[];
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
// 노토 산스 세트 전용 윗·아랫 높이 — 부분 집합 파일의 hhea(1.0·0.2em)와 Windows 높이(usWin 1.16·0.288em)가 달라
// Windows 화면(스튜디오 캔버스)만 글자 상자가 1.448em 이 된다 → 36pt 큰 문장(C04)의 둘째 줄 지표 칩이 줄 높이 46pt 를 넘어 넘침 1건(2026-10-29 실측).
// PDF(converter, Linux)가 쓰는 hhea 값을 그대로 지정해 화면을 PDF 와 같게 한다 — PDF 모양은 바뀌지 않는다. 명조 제목 세트의 본문 노토는 그대로 둔다.
const NOTO_SANS_SET: FontFaceFile[] = NOTO_SANS.map((f) => ({ ...f, ascentOverride: 100, descentOverride: 20, lineGapOverride: 0 }));

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
    faces: [...NOTO_SANS_SET, ...PRETENDARD],
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
    note: "서체 파일이 아직 없습니다 — 서체 라이브러리에서 IBM Plex Sans KR 을 올리고 세트를 만들면 쓸 수 있습니다.",
  },
];

export const DEFAULT_FONT_SET_ID = "pretendard";

/** 서체 라이브러리에 '기본 서체'로 보이는 번들 서체(catalog_fonts source='bundled' 행의 원천) — 사용자 세트에서도 고를 수 있다 */
export const BUNDLED_FONTS: Array<{ fontId: string; family: string; displayName: string; classification: FontClass; files: Array<{ weight: number; file: string }>; license: { source: string; note: string } }> = [
  {
    fontId: "b-pretendard",
    family: "Pretendard",
    displayName: "프리텐다드",
    classification: "sans",
    files: PRETENDARD.map((f) => ({ weight: f.weight, file: f.file })),
    license: { source: "https://github.com/orioncactus/pretendard", note: "SIL OFL 1.1 — CFF 윤곽을 TrueType 윤곽으로 바꾼 수정본(LICENSE-Pretendard.txt)" },
  },
  {
    fontId: "b-noto-sans-kr",
    family: "Noto Sans KR",
    displayName: "노토 산스 KR",
    classification: "sans",
    files: NOTO_SANS.map((f) => ({ weight: f.weight, file: f.file })),
    license: { source: "https://fonts.google.com/noto/specimen/Noto+Sans+KR", note: "SIL OFL 1.1 — 가변 서체를 굵기 고정·한글 부분 집합으로 만든 수정본(LICENSE-Noto.txt)" },
  },
  {
    fontId: "b-noto-serif-kr",
    family: "Noto Serif KR",
    displayName: "노토 세리프 KR",
    classification: "serif",
    files: NOTO_SERIF.map((f) => ({ weight: f.weight, file: f.file })),
    license: { source: "https://fonts.google.com/noto/specimen/Noto+Serif+KR", note: "SIL OFL 1.1 — 가변 서체를 굵기 고정·한글 부분 집합으로 만든 수정본(LICENSE-Noto.txt)" },
  },
];

export function fontSetById(id: string | undefined | null, extra: FontSetDef[] = []): FontSetDef | undefined {
  return FONT_SETS.find((f) => f.id === id) ?? extra.find((f) => f.id === id);
}

/** 고를 수 있는 세트면 그대로, 아니면 기본 세트. extra = 서체 라이브러리 세트(사용자 세트) */
export function usableFontSet(id: string | undefined | null, extra: FontSetDef[] = []): FontSetDef {
  const hit = fontSetById(id, extra);
  return hit && hit.available ? hit : fontSetById(DEFAULT_FONT_SET_ID)!;
}

/** converter 이미지에 미리 넣어 둔 파일(Dockerfile 이 public/print-kit/fonts 를 통째로 COPY — 이미지 다시 만들기 전까지는 P4 의 3개만) */
export const CONVERTER_BUNDLED_FONTS = new Set(PRETENDARD.map((f) => f.file));

// ── 업로드 세트 ──

/** 앱 화면 미리보기 주소 — 기본 서체는 정적 파일, 업로드 서체는 서체 라우트(v = 저장소 키 끝부분: 파일을 바꾸면 주소도 바뀜) */
export function facePreviewUrl(f: FontFaceFile): string {
  if (f.upload) return `/api/catalog/fonts/${encodeURIComponent(f.upload.fontId)}/${f.upload.fileWeight}.woff?v=${encodeURIComponent(f.upload.woffKey.split("/").pop() ?? "")}`;
  return `/print-kit/fonts/${f.file}`;
}

/** PDF(converter) 자산 경로 — print.local 기준 */
export function facePrintPath(f: FontFaceFile): string {
  if (f.upload) return `fonts/u/${f.upload.fontId}/${f.upload.fileWeight}.woff`;
  return `fonts/${f.file}`;
}

/** 굵기 대응 기본값 — CSS 굵기 맞춤 규칙과 같다(400·500 은 500 까지 굵은 쪽 → 가는 쪽, 600 이상은 굵은 쪽 → 가는 쪽, 400 미만은 가는 쪽 먼저) */
export function nearestWeight(target: number, available: number[]): number {
  const ws = Array.from(new Set(available)).sort((a, b) => a - b);
  if (!ws.length || ws.includes(target)) return target;
  const lighter = ws.filter((w) => w < target).reverse();
  const heavier = ws.filter((w) => w > target);
  if (target >= 400 && target <= 500) {
    const upTo500 = heavier.filter((w) => w <= 500);
    return upTo500[0] ?? lighter[0] ?? heavier[0];
  }
  if (target < 400) return lighter[0] ?? heavier[0];
  return heavier[0] ?? lighter[0];
}

export function defaultRoleWeights(fileWeights: number[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of CSS_WEIGHTS) out[String(w)] = nearestWeight(w, fileWeights);
  return out;
}

export function defaultWeightMap(fonts: Record<FontRole, CatalogFont | undefined>): WeightMap {
  const out = {} as WeightMap;
  for (const role of FONT_ROLES) out[role] = defaultRoleWeights((fonts[role]?.files ?? []).filter((f) => f.style === "normal").map((f) => f.weight));
  return out;
}

/** 세트 고르기 규칙(§5-4 가독성 안전장치) — errors 는 저장·적용을 막고, warnings 는 알린다 */
export function checkFontSetChoice(
  fonts: Record<FontRole, CatalogFont | undefined>,
  weightMap: WeightMap
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  // 없는 문서 기호 — 서체마다 한 번(제목·본문이 같은 서체면 한 줄). 기준 서체 프리텐다드 자신은 알리지 않는다
  const symbolRoles = new Map<string, { font: CatalogFont; roles: FontRole[] }>();
  for (const role of ["display", "body"] as FontRole[]) {
    const f = fonts[role];
    if (!f || !f.coverage.symbolsMissing || f.fontId === "b-pretendard") continue;
    const hit = symbolRoles.get(f.fontId) ?? { font: f, roles: [] };
    hit.roles.push(role);
    symbolRoles.set(f.fontId, hit);
  }
  for (const { font, roles } of symbolRoles.values())
    warnings.push(`${roles.map((r) => FONT_ROLE_LABEL[r]).join("·")} 서체에 없는 문서 기호 ${font.coverage.symbolsMissing} 는 대체 서체(프리텐다드 등)로 채웁니다.`);
  for (const role of FONT_ROLES) {
    const f = fonts[role];
    if (!f) {
      errors.push(`${FONT_ROLE_LABEL[role]} 서체를 고르세요.`);
      continue;
    }
    if (!f.roles.includes(role)) {
      if (role === "body") errors.push(`'${f.displayName}'은 제목 전용 서체라 본문에 쓸 수 없습니다(${f.reasons.join(", ") || "본문 조건 미달"}).`);
      else if (role === "figure") errors.push(`'${f.displayName}'에는 숫자 0–9 가 모두 있지 않아 숫자 서체로 쓸 수 없습니다.`);
      else errors.push(`'${f.displayName}'은 ${FONT_ROLE_LABEL[role]} 서체로 쓸 수 없습니다.`);
    }
    const weights = new Set(f.files.filter((x) => x.style === "normal").map((x) => x.weight));
    for (const w of CSS_WEIGHTS) {
      const mapped = weightMap[role]?.[String(w)];
      if (mapped == null || !weights.has(mapped)) errors.push(`${FONT_ROLE_LABEL[role]} 서체 굵기 ${w} 에 대응할 파일이 없습니다.`);
    }
    if (!f.isActive) warnings.push(`'${f.displayName}'은 비활성 서체입니다(새 세트에는 고를 수 없고, 이미 쓰는 세트는 그대로 그립니다).`);
    if (f.embed === "print") warnings.push(`'${f.displayName}'은 미리보기·인쇄 전용 서체입니다 — PDF 를 받은 사람이 그 글자를 고칠 수는 없습니다.`);
  }
  const body = fonts.body;
  if (body) {
    const regular = weightMap.body?.["400"];
    if (regular != null && regular < 350) errors.push(`본문 굵기 400 에 Light·Thin(${regular})을 쓸 수 없습니다 — 가는 본문은 인쇄·화면 모두 읽기 어렵습니다.`);
    if (body.classification === "serif") warnings.push("명조 본문 — 화면(모니터·PDF 배포)에서는 획이 가늘어 읽기 어렵습니다. 인쇄판에서는 괜찮습니다.");
  }
  const display = fonts.display;
  if (display && display.coverage.hangul2350 < 2350) warnings.push(`제목 서체에 한글 완성형 ${2350 - display.coverage.hangul2350}자가 없습니다 — 그 글자는 프리텐다드로 채웁니다.`);
  const figure = fonts.figure;
  if (figure && figure.roles.includes("figure") && !figure.coverage.tnum) warnings.push("숫자 서체에 고정폭 숫자(tnum)가 없어 표의 숫자 자리가 줄마다 조금씩 어긋날 수 있습니다.");
  return { errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)) };
}

const familyAlias = (setId: string, role: FontRole) => `kcs-${setId}-${role}`;
const FALLBACK = `"Pretendard", "Malgun Gothic", sans-serif`;

/** 사용자 세트 → 그릴 수 있는 세트 정의(@font-face 목록 + 역할 변수 CSS + 검사 정보). fontsById 에 역할 서체가 있어야 한다 */
export function buildCustomFontSet(set: CatalogFontSet, fontsById: Map<string, CatalogFont>): FontSetDef {
  const fonts = {
    display: fontsById.get(set.displayFontId),
    body: fontsById.get(set.bodyFontId),
    figure: fontsById.get(set.figureFontId),
  } as Record<FontRole, CatalogFont | undefined>;
  const { errors, warnings } = checkFontSetChoice(fonts, set.weightMap);
  const faces: FontFaceFile[] = [];
  const roleFonts = {} as Record<FontRole, RoleFontInfo>;
  const vars: string[] = [];
  for (const role of FONT_ROLES) {
    const f = fonts[role];
    const alias = familyAlias(set.setId, role);
    vars.push(`--kc-font-${role}: "${alias}", ${FALLBACK};`);
    if (!f) continue;
    roleFonts[role] = { fontId: f.fontId, label: f.displayName, family: alias, classification: f.classification, source: f.source, active: f.isActive, ranges: f.coverage.ranges };
    const adj = f.sizeAdjust;
    for (const w of CSS_WEIGHTS) {
      const fileWeight = set.weightMap[role]?.[String(w)];
      const file = f.files.find((x) => x.weight === fileWeight && x.style === "normal");
      if (!file) continue;
      faces.push({
        family: alias,
        weight: w,
        file: file.file ?? "",
        sizeAdjust: adj.sizeAdjust !== 100 ? adj.sizeAdjust : undefined,
        ascentOverride: adj.ascentOverride,
        descentOverride: adj.descentOverride,
        lineGapOverride: adj.lineGapOverride,
        upload: f.source === "upload" && file.woffKey ? { fontId: f.fontId, fileWeight: file.weight, woffKey: file.woffKey } : undefined,
      });
    }
  }
  const label = (r: FontRole) => fonts[r]?.displayName ?? "(없음)";
  return {
    id: set.setId,
    label: set.name,
    desc: `서체 라이브러리 세트 — 제목 ${label("display")} · 본문 ${label("body")} · 숫자 ${label("figure")}.`,
    roles: { display: label("display"), body: label("body"), figure: label("figure") },
    // 빠진 글자는 프리텐다드로 채운다(역할 변수의 대체 순서와 같음)
    faces: [...faces, ...PRETENDARD],
    available: errors.length === 0,
    note: errors.length ? errors.join(" ") : undefined,
    custom: true,
    css: `.kc-fontset--${set.setId} { ${vars.join(" ")} }`,
    roleFonts,
    issues: errors,
    warnings,
  };
}
