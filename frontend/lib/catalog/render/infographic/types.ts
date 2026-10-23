/*
 * 회사소개서 인포그래픽 — 내용(중립 구조)과 모양(유형)을 나눠 저장한다(블루프린트 §4-1). 클라이언트 안전(타입·상수·정리 함수만).
 * 같은 내용을 단계 흐름 ↔ 순환 ↔ 기둥으로 바꿔도 글이 사라지지 않고, 수치형끼리(막대 ↔ 구성비 ↔ 큰 숫자)도 바뀐다.
 * 형태가 다른 변환(목록 → 수치)은 막고 이유를 보여 준다(match.ts).
 */

export type InfoType =
  | "process"
  | "cycle"
  | "hub"
  | "pillars"
  | "cards"
  | "iconGrid"
  | "layers"
  | "matrix"
  | "timeline"
  | "roadmap"
  | "network"
  | "bar"
  | "share"
  | "stats"
  | "compare"
  | "map";

export type InfoFamily = "list" | "number";
export type InfoColorMode = "area" | "brand" | "mono";

export interface InfoItem {
  id: string;
  label: string;
  desc?: string;
  /** 보조 표기(영문 머리 등) */
  sub?: string;
  value?: number;
  /** 전후 비교의 이전 값 */
  prev?: number;
  unit?: string;
  /** 숫자 대신 보일 글자(예: "87.0점") */
  valueText?: string;
  prevText?: string;
  /** 시점(연혁·로드맵) */
  when?: string;
  /** lucide 아이콘 이름(parts.tsx ICONS) */
  icon?: string;
  /** 권역 코드(lib/catalog/regions REGION_GROUPS id) — 지도형 */
  region?: string;
  /** 강조 항목 */
  key?: boolean;
  /** 구성비 색 단계 1~5(kc-s1..5) */
  tone?: number;
}

export interface InfoContent {
  title?: string;
  center?: { label: string; desc?: string };
  items: InfoItem[];
  /** 수치 단위(항목에 없을 때) */
  unit?: string;
  /** 전후 비교 범례(이전·이후) */
  legend?: [string, string];
  /** 2×2 행렬 축 이름 [세로 위, 세로 아래, 가로 왼쪽, 가로 오른쪽] */
  axes?: [string, string, string, string];
}

export interface InfoSpec {
  type: InfoType;
  variant?: string;
  colorMode?: InfoColorMode;
  content: InfoContent;
}

/** 슬롯 크기 힌트(pt) — 원형 도식 크기와 적합도 계산에 쓴다 */
export interface InfoBox {
  w: number;
  h: number;
}

export interface InfoTypeMeta {
  type: InfoType;
  label: string;
  family: InfoFamily;
  /** 항목 수 허용 범위 */
  min: number;
  max: number;
  /** 라벨 권장 최대 글자 수 */
  maxLabel: number;
  maxDesc: number;
  variants: Array<{ id: string; label: string }>;
  /** 필요한 높이(pt, 대략) — 슬롯이 낮으면 감점 */
  minHeight: number;
  /** 내용 조건 */
  needs?: "when" | "prev" | "region" | "four" | "value";
  use: string;
}

export const INFO_TYPES: InfoTypeMeta[] = [
  { type: "process", label: "단계 흐름", family: "list", min: 3, max: 7, maxLabel: 12, maxDesc: 40, variants: [{ id: "h", label: "가로" }, { id: "v", label: "세로" }], minHeight: 70, use: "허가 절차, 수행 방법" },
  { type: "cycle", label: "순환", family: "list", min: 3, max: 6, maxLabel: 12, maxDesc: 0, variants: [{ id: "ring", label: "원형" }], minHeight: 200, use: "사후관리, 반복 업무" },
  { type: "hub", label: "허브·방사", family: "list", min: 3, max: 8, maxLabel: 12, maxDesc: 0, variants: [{ id: "radial", label: "방사형" }], minHeight: 200, use: "분야 개관, 서비스 묶음" },
  { type: "pillars", label: "기둥", family: "list", min: 2, max: 5, maxLabel: 14, maxDesc: 60, variants: [{ id: "col", label: "기둥" }], minHeight: 80, use: "분야별 서비스, 원칙" },
  { type: "cards", label: "카드", family: "list", min: 2, max: 8, maxLabel: 16, maxDesc: 80, variants: [{ id: "2", label: "2열" }, { id: "3", label: "3열" }, { id: "4", label: "4열" }], minHeight: 60, use: "경영철학, 역량" },
  { type: "iconGrid", label: "아이콘 격자", family: "list", min: 3, max: 12, maxLabel: 16, maxDesc: 0, variants: [{ id: "4", label: "4열" }, { id: "3", label: "3열" }, { id: "6", label: "6열" }], minHeight: 60, use: "서비스 목록" },
  { type: "layers", label: "층위", family: "list", min: 2, max: 4, maxLabel: 18, maxDesc: 50, variants: [{ id: "nest", label: "동심" }], minHeight: 120, use: "범위·포함 관계" },
  { type: "matrix", label: "2×2 행렬", family: "list", min: 4, max: 4, maxLabel: 14, maxDesc: 40, variants: [{ id: "2x2", label: "2×2" }], minHeight: 120, needs: "four", use: "두 축 분류" },
  { type: "timeline", label: "시간축", family: "list", min: 3, max: 10, maxLabel: 16, maxDesc: 0, variants: [{ id: "h", label: "가로" }], minHeight: 80, needs: "when", use: "연혁, 추진 경과" },
  { type: "roadmap", label: "로드맵", family: "list", min: 2, max: 6, maxLabel: 12, maxDesc: 40, variants: [{ id: "steps", label: "계단" }], minHeight: 110, needs: "when", use: "목표 시점 단계" },
  { type: "network", label: "협력 관계", family: "list", min: 3, max: 8, maxLabel: 10, maxDesc: 0, variants: [{ id: "ring", label: "원형" }], minHeight: 200, use: "자문·협력 기관" },
  { type: "bar", label: "막대", family: "number", min: 2, max: 12, maxLabel: 10, maxDesc: 0, variants: [{ id: "h", label: "가로 막대" }, { id: "v", label: "세로 막대" }], minHeight: 70, needs: "value", use: "분포·순위" },
  { type: "share", label: "구성비", family: "number", min: 2, max: 6, maxLabel: 12, maxDesc: 0, variants: [{ id: "donut", label: "도넛" }, { id: "stack", label: "100% 띠" }], minHeight: 60, needs: "value", use: "구성 비율" },
  { type: "stats", label: "큰 숫자", family: "number", min: 1, max: 6, maxLabel: 18, maxDesc: 0, variants: [{ id: "row", label: "한 줄" }], minHeight: 50, needs: "value", use: "핵심 수치" },
  { type: "compare", label: "전후 비교", family: "number", min: 1, max: 4, maxLabel: 14, maxDesc: 0, variants: [{ id: "bars", label: "막대" }], minHeight: 40, needs: "prev", use: "개선 성과" },
  { type: "map", label: "지도", family: "number", min: 2, max: 17, maxLabel: 8, maxDesc: 0, variants: [{ id: "regions", label: "권역" }], minHeight: 170, needs: "region", use: "권역별 실적" },
];

export const INFO_TYPE_META: Record<InfoType, InfoTypeMeta> = Object.fromEntries(INFO_TYPES.map((m) => [m.type, m])) as Record<InfoType, InfoTypeMeta>;

export function isInfoType(v: unknown): v is InfoType {
  return typeof v === "string" && v in INFO_TYPE_META;
}

export function defaultVariant(type: InfoType): string {
  return INFO_TYPE_META[type].variants[0].id;
}

const str = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max);
  return t;
};
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e12 ? v : undefined);

/** 저장값·요청값 정리 — 모르는 키·과한 길이·항목 수(20)를 자른다. */
export function sanitizeInfoContent(input: unknown): InfoContent {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 20).map((raw, i): InfoItem => {
    const it = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const id = typeof it.id === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(it.id) ? it.id : `i${i + 1}`;
    const out: InfoItem = { id, label: str(it.label, 80) ?? "" };
    const desc = str(it.desc, 200);
    if (desc) out.desc = desc;
    const sub = str(it.sub, 40);
    if (sub) out.sub = sub;
    const value = num(it.value);
    if (value != null) out.value = value;
    const prev = num(it.prev);
    if (prev != null) out.prev = prev;
    const unit = str(it.unit, 8);
    if (unit) out.unit = unit;
    const vt = str(it.valueText, 20);
    if (vt) out.valueText = vt;
    const pt = str(it.prevText, 20);
    if (pt) out.prevText = pt;
    const when = str(it.when, 20);
    if (when) out.when = when;
    if (typeof it.icon === "string" && /^[a-z0-9-]{1,30}$/.test(it.icon)) out.icon = it.icon;
    if (typeof it.region === "string" && /^[a-z0-9_-]{1,20}$/.test(it.region)) out.region = it.region;
    if (it.key === true) out.key = true;
    if (typeof it.tone === "number" && Number.isInteger(it.tone) && it.tone >= 1 && it.tone <= 5) out.tone = it.tone;
    return out;
  });
  const out: InfoContent = { items };
  const title = str(o.title, 80);
  if (title) out.title = title;
  if (o.center && typeof o.center === "object") {
    const c = o.center as Record<string, unknown>;
    const label = str(c.label, 40);
    if (label) out.center = { label, ...(str(c.desc, 60) ? { desc: str(c.desc, 60) } : {}) };
  }
  const unit = str(o.unit, 8);
  if (unit) out.unit = unit;
  if (Array.isArray(o.legend) && o.legend.length === 2) out.legend = [str(o.legend[0], 20) ?? "", str(o.legend[1], 20) ?? ""];
  if (Array.isArray(o.axes) && o.axes.length === 4) out.axes = o.axes.map((a) => str(a, 20) ?? "") as InfoContent["axes"];
  return out;
}

export function sanitizeInfoSpec(input: unknown, fallback: InfoSpec): InfoSpec {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const type = isInfoType(o.type) ? o.type : fallback.type;
  const variant = typeof o.variant === "string" && INFO_TYPE_META[type].variants.some((v) => v.id === o.variant) ? o.variant : defaultVariant(type);
  const colorMode: InfoColorMode = o.colorMode === "brand" || o.colorMode === "mono" ? o.colorMode : "area";
  return { type, variant, colorMode, content: o.content ? sanitizeInfoContent(o.content) : fallback.content };
}

/** 내용의 형태 — 수치가 모든 항목에 있으면 수치형 */
export function contentFamily(c: InfoContent): InfoFamily {
  return c.items.length > 0 && c.items.every((it) => it.value != null) ? "number" : "list";
}
