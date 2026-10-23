/*
 * 회사소개서 서체 라이브러리(P5b) 공용 형식·상수 — 클라이언트 안전. docs/company-catalog-blueprint.md §5-3·5-4·§10
 * 저장: 309 catalog_fonts(서체 = 패밀리 하나, 굵기 파일 여럿)·catalog_font_sets(제목·본문·숫자 + 굵기 대응).
 * 분석(서버, fontkit)은 font-analysis.ts, 저장·변환은 font-library.ts, 세트 → @font-face 는 fonts.ts.
 */

export type FontRole = "display" | "body" | "figure";
export const FONT_ROLES: FontRole[] = ["display", "body", "figure"];
export const FONT_ROLE_LABEL: Record<FontRole, string> = { display: "제목", body: "본문", figure: "숫자" };

/** 디자인 시스템 CSS(kesi-catalog.css·print-overrides)가 쓰는 굵기 — 세트의 굵기 대응표는 이 네 칸을 채운다 */
export const CSS_WEIGHTS = [400, 500, 600, 700] as const;
export type CssWeight = (typeof CSS_WEIGHTS)[number];
export type WeightMap = Record<FontRole, Record<string, number>>;

/** OS/2 fsType 판정 — restricted·bitmap 은 PDF 에 넣을 수 없어 등록을 거부한다(D13) */
export type EmbedPolicy = "installable" | "editable" | "print" | "restricted" | "bitmap";
export const EMBED_LABEL: Record<EmbedPolicy, string> = {
  installable: "포함 허용",
  editable: "포함 허용(편집 가능)",
  print: "미리보기·인쇄 전용",
  restricted: "포함 제한",
  bitmap: "비트맵만 허용",
};

export type FontClass = "sans" | "serif" | "decorative";
export const FONT_CLASS_LABEL: Record<FontClass, string> = { sans: "고딕", serif: "명조", decorative: "장식·손글씨" };

export type FontOutline = "truetype" | "cff" | "cff2";

export const LICENSE_TYPES = [
  { id: "ofl", label: "SIL OFL(오픈 폰트 라이선스)" },
  { id: "free-commercial", label: "무료 상업용" },
  { id: "purchased", label: "구매(상용)" },
  { id: "other", label: "기타" },
] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number]["id"];

export const LICENSE_SCOPES = [
  { id: "print", label: "인쇄" },
  { id: "pdf", label: "PDF 포함(임베딩)" },
  { id: "web", label: "웹·화면" },
] as const;
export type LicenseScope = (typeof LICENSE_SCOPES)[number]["id"];

export const MAX_FONT_FILE_BYTES = 20 * 1024 * 1024;
export const FONT_FILE_EXTS = ["ttf", "otf", "woff", "woff2"] as const;

/** 회사소개서에 쓰는 문서 기호 — 서체에 없으면 대체 서체가 그린다(블루프린트 §5-3) */
export const DOC_SYMBOLS = "㈜·→↔○●◐₂‘’“”…–—×±°㎡①②③※「」";

/** 본문 가능 판정의 한글 기준 — 완성형 2,350자를 모두 가져야 한다 */
export const BODY_HANGUL_MIN = 2350;

export interface FontCoverage {
  /** 한글 완성형(KS X 1001) 2,350자 중 있는 글자 수 */
  hangul2350: number;
  /** 빠진 완성형 글자(앞 400자까지) */
  hangulMissing: string;
  /** 현대 한글 11,172자 중 있는 글자 수 */
  hangulAll: number;
  latin: boolean;
  digits: boolean;
  /** 문서 기호(DOC_SYMBOLS) 중 없는 것 */
  symbolsMissing: string;
  /** 고정폭 숫자(tnum 기능 또는 숫자 폭이 모두 같음) */
  tnum: boolean;
  /** 글자 범위(코드 포인트 [시작, 끝]) — 스튜디오가 문서에 쓰인 글자 중 빠진 글자를 찾는다 */
  ranges: Array<[number, number]>;
}

/** 글자 꼴 수치(em 단위) */
export interface FontMetrics {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  xHeight: number;
  capHeight: number;
  /** 한글 완성형 평균 글자 폭 */
  hangulAdvance: number | null;
  digitAdvance: number | null;
}

/** @font-face 보정값(%) — 기준 서체(프리텐다드)와 한글 평균 폭·윗/아랫 높이를 맞춘다(§5-4) */
export interface FontSizeAdjust {
  sizeAdjust: number;
  ascentOverride: number;
  descentOverride: number;
  lineGapOverride: number;
  basis: "hangul" | "x-height" | "none";
}

/** 업로드 파일 하나의 분석 결과(저장 전) */
export interface FontFileAnalysis {
  fileName: string;
  bytes: number;
  format: "ttf" | "otf" | "woff" | "woff2" | "unknown";
  outline: FontOutline | null;
  family: string;
  /** 한국어 패밀리 이름(이름 테이블에 있으면) */
  familyLocal: string | null;
  subfamily: string;
  postscriptName: string;
  weight: number;
  italic: boolean;
  variable: { min: number; max: number; default: number } | null;
  /** 가변 서체를 굵기 고정할 값(400·600·700 중 범위 안) */
  instanceWeights: number[];
  embed: EmbedPolicy;
  noSubsetting: boolean;
  classification: FontClass;
  licenseHint: string | null;
  licenseUrl: string | null;
  copyright: string | null;
  coverage: FontCoverage;
  metrics: FontMetrics;
  /** 거부 사유(하나라도 있으면 등록하지 않는다) */
  errors: string[];
  warnings: string[];
}

/** 패밀리 묶음 판정 */
export interface FontFamilyVerdict {
  family: string;
  displayName: string;
  /** 분석 결과 배열의 번호 */
  fileIndexes: number[];
  /** 저장될 굵기(가변 서체는 고정할 굵기들) */
  weights: number[];
  bodyCapable: boolean;
  roles: FontRole[];
  /** 제목 전용인 이유 */
  reasons: string[];
  classification: FontClass;
  embed: EmbedPolicy;
  coverage: FontCoverage;
  sizeAdjust: FontSizeAdjust;
  warnings: string[];
  /** 같은 패밀리의 등록된 업로드 서체(굵기를 더하거나 바꾼다) */
  existingFontId: string | null;
}

export interface CatalogFontFile {
  weight: number;
  style: "normal" | "italic";
  /** 원본 업로드 파일(저장소 키) — 기본 서체는 null */
  storageKey: string | null;
  /** 미리보기·PDF 용 TrueType 윤곽 WOFF(저장소 키) — 기본 서체는 null */
  woffKey: string | null;
  /** 기본 서체 파일 이름(public/print-kit/fonts) */
  file?: string;
  format: string;
  bytes: number;
  woffBytes: number;
  fileName: string;
  postscriptName: string;
  outline: FontOutline;
  /** CFF 윤곽을 TrueType 으로 바꿨는가 */
  converted: boolean;
  /** 가변 서체에서 굵기를 고정해 만들었는가 */
  fromVariable: boolean;
  uploadedAt: string;
  /** 이 굵기의 한글 완성형 글자 수(화면 표시용) */
  hangul2350?: number;
}

export interface CatalogFontLicense {
  type: LicenseType;
  /** 출처(내려받은 곳·구입처 URL 등) */
  source: string;
  scope: LicenseScope[];
  /** 증빙 메모(구매 서체는 필수) */
  note: string;
  confirmedBy: string | null;
  confirmedAt: string;
}

export interface CatalogFont {
  fontId: string;
  family: string;
  displayName: string;
  source: "bundled" | "upload";
  files: CatalogFontFile[];
  roles: FontRole[];
  bodyCapable: boolean;
  reasons: string[];
  classification: FontClass;
  license: CatalogFontLicense | null;
  embed: EmbedPolicy;
  noSubsetting: boolean;
  coverage: FontCoverage;
  metrics: FontMetrics;
  sizeAdjust: FontSizeAdjust;
  isActive: boolean;
  uploadedBy: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
}

/** 사용자 세트(catalog_font_sets) */
export interface CatalogFontSet {
  setId: string;
  name: string;
  displayFontId: string;
  bodyFontId: string;
  figureFontId: string;
  weightMap: WeightMap;
  orderNo: number;
  updatedAt: string;
}

/** 서체·세트를 쓰는 곳 */
export interface FontUsage {
  /** 세트 id → 그 세트를 쓰는 문서 */
  documentsBySet: Record<string, Array<{ docId: string; title: string }>>;
  /** 서체 id → 그 서체를 쓰는 세트 id */
  setsByFont: Record<string, string[]>;
  /** 서체 id → 그 서체로 만든 PDF(생성본) 수 */
  editionsByFont: Record<string, number>;
}

/** 코드 포인트가 범위 목록 안에 있는가(이분 탐색) */
export function inRanges(ranges: Array<[number, number]>, cp: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = ranges[mid];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/** 정렬된 코드 포인트 → 연속 범위 */
export function toRanges(codePoints: Iterable<number>): Array<[number, number]> {
  const sorted = Array.from(new Set(codePoints)).sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (const cp of sorted) {
    const last = out[out.length - 1];
    if (last && cp === last[1] + 1) last[1] = cp;
    else out.push([cp, cp]);
  }
  return out;
}
