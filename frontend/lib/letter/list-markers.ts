// 글머리 기호 종류(2026-10-19 사용자 요청) — 에디터 선택 창·공문 파서·PDF/HWPX 가 같은 정의를 쓴다.
// 에디터는 목록에 data-marker(종류)·data-level(들여쓰기 단계)을 달고, 화면 표시는 cdash.css 의
// @counter-style(mcm-*)로 그린다. 파서는 같은 정의로 기호 문자열을 만들어 문단 앞에 붙인다.
//
// 기본 단계는 공문 항목 구분 관례(1. → 가. → 1) → 가) → (1) → (가) → ① → ㉮)를 따른다.
// 단계 0 = 본문 문단과 같은 자리(첫 줄 들여쓰기), 단계 1부터는 한 단계마다 LIST_LEVEL_STEP_PT 씩 더 들여 쓰고
// 줄이 넘어가면 기호 뒤 글자 시작점에 맞춘다(내어쓰기).

export type ListMarkerKey =
  | "disc"
  | "circle"
  | "square"
  | "dash"
  | "ring"
  | "box"
  | "ref"
  | "decimal"
  | "decimal-paren"
  | "paren-decimal"
  | "ganada"
  | "ganada-paren"
  | "paren-ganada"
  | "circled"
  | "circled-ganada"
  | "lower-alpha"
  | "upper-alpha"
  | "lower-roman";

export interface ListMarkerDef {
  key: ListMarkerKey;
  ordered: boolean;
  /** 선택 창에 보이는 예시(첫 항목 기호) */
  sample: string;
  /** 선택 창 설명 */
  title: string;
  /** 처음 적용할 때의 들여쓰기 단계 */
  defaultLevel: number;
  /** 에디터 표시용 CSS list-style-type */
  css: string;
}

export const LIST_LEVEL_STEP_PT = 15;
export const LIST_LEVEL_MAX = 7;

const GANADA = "가나다라마바사아자차카타파하";
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const CIRCLED_GANADA = "㉮㉯㉰㉱㉲㉳㉴㉵㉶㉷㉸㉹㉺㉻";

export const LIST_MARKERS: ListMarkerDef[] = [
  { key: "disc", ordered: false, sample: "•", title: "점", defaultLevel: 1, css: "disc" },
  { key: "circle", ordered: false, sample: "◦", title: "작은 원", defaultLevel: 1, css: "circle" },
  { key: "square", ordered: false, sample: "▪", title: "네모", defaultLevel: 1, css: "square" },
  { key: "dash", ordered: false, sample: "-", title: "줄표", defaultLevel: 1, css: "mcm-dash" },
  { key: "ring", ordered: false, sample: "○", title: "동그라미", defaultLevel: 1, css: "mcm-ring" },
  { key: "box", ordered: false, sample: "□", title: "빈 네모", defaultLevel: 1, css: "mcm-box" },
  { key: "ref", ordered: false, sample: "※", title: "참고", defaultLevel: 1, css: "mcm-ref" },
  { key: "decimal", ordered: true, sample: "1.", title: "1. 2. 3.", defaultLevel: 0, css: "decimal" },
  { key: "ganada", ordered: true, sample: "가.", title: "가. 나. 다.", defaultLevel: 1, css: "mcm-ganada" },
  { key: "decimal-paren", ordered: true, sample: "1)", title: "1) 2) 3)", defaultLevel: 2, css: "mcm-decimal-paren" },
  { key: "ganada-paren", ordered: true, sample: "가)", title: "가) 나) 다)", defaultLevel: 3, css: "mcm-ganada-paren" },
  { key: "paren-decimal", ordered: true, sample: "(1)", title: "(1) (2) (3)", defaultLevel: 4, css: "mcm-paren-decimal" },
  { key: "paren-ganada", ordered: true, sample: "(가)", title: "(가) (나) (다)", defaultLevel: 5, css: "mcm-paren-ganada" },
  { key: "circled", ordered: true, sample: "①", title: "① ② ③", defaultLevel: 6, css: "mcm-circled" },
  { key: "circled-ganada", ordered: true, sample: "㉮", title: "㉮ ㉯ ㉰", defaultLevel: 7, css: "mcm-circled-ganada" },
  { key: "lower-alpha", ordered: true, sample: "a.", title: "a. b. c.", defaultLevel: 1, css: "lower-alpha" },
  { key: "upper-alpha", ordered: true, sample: "A.", title: "A. B. C.", defaultLevel: 1, css: "upper-alpha" },
  { key: "lower-roman", ordered: true, sample: "i.", title: "i. ii. iii.", defaultLevel: 1, css: "lower-roman" },
];

export function listMarkerDef(key: string | null | undefined): ListMarkerDef | undefined {
  return LIST_MARKERS.find((m) => m.key === key);
}

/** 가, 나, …, 하, 가가 … (alphabetic) */
function alphabetic(n: number, symbols: string): string {
  const chars = Array.from(symbols);
  let out = "";
  let v = n;
  while (v > 0) {
    v -= 1;
    out = chars[v % chars.length] + out;
    v = Math.floor(v / chars.length);
  }
  return out;
}

function roman(n: number): string {
  const table: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let v = n;
  let out = "";
  for (const [k, s] of table) {
    while (v >= k) {
      out += s;
      v -= k;
    }
  }
  return out;
}

/** n번째(1부터) 항목의 기호 + 뒤 공백. 정의가 없으면 종전 규칙(1. / •). */
export function listMarkerText(key: string | null | undefined, ordered: boolean, n: number): string {
  const def = listMarkerDef(key);
  if (!def) return ordered ? `${n}. ` : "• ";
  switch (def.key) {
    case "disc": return "• ";
    case "circle": return "◦ ";
    case "square": return "▪ ";
    case "dash": return "- ";
    case "ring": return "○ ";
    case "box": return "□ ";
    case "ref": return "※ ";
    case "decimal": return `${n}. `;
    case "decimal-paren": return `${n}) `;
    case "paren-decimal": return `(${n}) `;
    case "ganada": return `${alphabetic(n, GANADA)}. `;
    case "ganada-paren": return `${alphabetic(n, GANADA)}) `;
    case "paren-ganada": return `(${alphabetic(n, GANADA)}) `;
    case "circled": return n <= 20 ? `${Array.from(CIRCLED)[n - 1]} ` : `(${n}) `;
    case "circled-ganada": return n <= 14 ? `${Array.from(CIRCLED_GANADA)[n - 1]} ` : `(${alphabetic(n, GANADA)}) `;
    case "lower-alpha": return `${alphabetic(n, "abcdefghijklmnopqrstuvwxyz")}. `;
    case "upper-alpha": return `${alphabetic(n, "ABCDEFGHIJKLMNOPQRSTUVWXYZ")}. `;
    case "lower-roman": return `${roman(n)}. `;
  }
}

/** 목록 단계 문자열(data-level) → 0..LIST_LEVEL_MAX */
export function clampListLevel(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(LIST_LEVEL_MAX, Math.round(n)));
}

/**
 * 항목 맨 앞에 손으로 쳐 둔 기호(가. / 1) / (1) / ① / • / - 등) — 글머리 기호를 적용할 때 지워
 * 기호가 두 번 찍히지 않게 한다.
 */
export const TYPED_MARKER_RE =
  /^[\s\u00a0]*(?:\(?(?:\d{1,3}|[가-하]|[a-zA-Z]|[ivxIVX]{1,5})[.)]|\((?:\d{1,3}|[가-하])\)|[①-⑳㉮-㉻•◦▪○□※·∙\-–])[\s\u00a0]+/;
