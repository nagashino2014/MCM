// 제안서 전용 도식 — 회사소개서 인포그래픽(InfoSpec 16종)에 없는, 원본 제안서 4종에 반복해 나온 구조 8종.
// 내용(items)만 저장하고 모양은 렌더러가 그린다. HWPX 에는 300dpi PNG 로 들어가고 편집 원본은 문서에 남는다.
export type DiagramKind = "hub" | "org" | "beforeAfter" | "pyramid" | "arc" | "chevrons" | "scatter" | "venn";

export interface DiagramItem {
  id: string;
  label: string;
  /** 설명 — 줄바꿈(\n)은 목록 줄 */
  desc?: string;
  /** 아이콘 이름(DIAGRAM_ICONS) */
  icon?: string;
  /** 조직도: top·left·right·unit / 산점도: 계열 a·b */
  group?: string;
  /** 전후 비교: 이전·이후 */
  a?: string;
  b?: string;
  /** 산점도 좌표 0~100 */
  x?: number;
  y?: number;
  /** 항목 색 직접 지정(#rrggbb) — 다색 팔레트 대신 */
  color?: string;
}

export interface DiagramSpec {
  kind: DiagramKind;
  center?: { label: string; desc?: string };
  items: DiagramItem[];
  /** 전후 비교 머리 / 산점도 계열 이름 */
  legend?: [string, string];
  /** 산점도 축 [가로, 세로] */
  axes?: [string, string];
  /** 색 — 없거나 multi = 항목마다 다른 색(기본), theme = 테마 단색 */
  tone?: "multi" | "theme";
}

export interface DiagramMeta {
  kind: DiagramKind;
  label: string;
  min: number;
  max: number;
  /** 편집 화면에 보일 항목 필드 */
  fields: Array<"desc" | "icon" | "group" | "ab" | "xy">;
  center: boolean;
  /** 기본 크기(mm) */
  size: [number, number];
  use: string;
}

export const DIAGRAM_TYPES: DiagramMeta[] = [
  { kind: "hub", label: "허브·방사", min: 3, max: 10, fields: ["desc", "icon"], center: true, size: [174, 80], use: "개별법→통합, 제안사 강점, 과업 영역" },
  { kind: "org", label: "수행 조직도", min: 2, max: 12, fields: ["desc", "group"], center: false, size: [174, 88], use: "PM·지원 인력·사업소별 팀" },
  { kind: "beforeAfter", label: "전후 비교", min: 2, max: 7, fields: ["ab"], center: false, size: [174, 82], use: "제도 도입 전후, 현황→개선" },
  { kind: "pyramid", label: "피라미드", min: 2, max: 5, fields: ["desc"], center: false, size: [174, 70], use: "미션·비전·핵심가치, 단계 위계" },
  { kind: "arc", label: "반원 방사", min: 3, max: 7, fields: ["icon"], center: true, size: [174, 74], use: "기대효과, 추진 목표" },
  { kind: "chevrons", label: "단계 화살표", min: 2, max: 6, fields: ["desc"], center: false, size: [174, 66], use: "단계별 추진체계, 과업 단계" },
  { kind: "scatter", label: "중대성 매트릭스", min: 2, max: 20, fields: ["group", "xy"], center: false, size: [140, 96], use: "중대성 평가, 위험 우선순위" },
  { kind: "venn", label: "세 원 결합", min: 3, max: 3, fields: ["desc"], center: false, size: [174, 62], use: "추진 원칙 3가지, 핵심 전략" },
];
export const DIAGRAM_META: Record<DiagramKind, DiagramMeta> = Object.fromEntries(DIAGRAM_TYPES.map((m) => [m.kind, m])) as Record<DiagramKind, DiagramMeta>;
export const isDiagramKind = (v: unknown): v is DiagramKind => typeof v === "string" && v in DIAGRAM_META;

export const DIAGRAM_ICON_NAMES = [
  "factory", "wind", "droplets", "volume-2", "trash-2", "flask-conical", "leaf", "sprout", "recycle", "shield-check",
  "file-check", "search-check", "clipboard-check", "users", "gauge", "scale", "bar-chart-3", "target", "building-2", "landmark",
  "lightbulb", "handshake", "graduation-cap", "settings", "workflow", "calendar-check", "compass", "trending-up", "award", "book-open",
  "megaphone", "database", "network", "hard-hat", "map", "file-text", "message-square", "zap", "globe",
] as const;

export const ORG_GROUPS = [
  { id: "top", label: "최상위(책임자)" },
  { id: "left", label: "왼쪽 지원" },
  { id: "right", label: "오른쪽 현황" },
  { id: "unit", label: "하단 팀" },
] as const;
