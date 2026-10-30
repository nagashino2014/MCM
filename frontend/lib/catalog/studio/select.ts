/*
 * 스튜디오 선택 규칙 — 캔버스에서 누른 노드 → 고를 대상, 그 대상에서 할 수 있는 편집(L1·L2·L3). 클라이언트 안전 순수 함수.
 *   L1 내용: 글 고치기 · 사진 교체·초점 · 목록 항목 추가·삭제·순서
 *   L2 구조: 숨기기 · 인포그래픽 유형·변형·색 · 열 수 · 사진 배치(비율·맞춤) · 쪽 변형
 *   L3 자유 배치: 이동·크기(12열·4pt 맞춤) · 글자 크기(타입 스케일) · 글자·면 색(토큰) · 요소 추가
 * 쪽마다 상한(maxLevel)이 있다 — 흐름·자동 분쪽 쪽은 L2, 부록은 L1(블루프린트 §8-2).
 * 데이터 위젯(대표 실적·명단·표·연혁·조직도·로고·증서·지도) 안은 고르지 않고 위젯 통째로 고른다 — 행 단위 수정은 데이터 화면에서.
 */
import { INLINE_TAGS, findPath, hasText, isChip, isInlineBlock, type CNode } from "./nodes";

export type EditLevel = 1 | 2 | 3;

/** 글 고치기 단위인가 — 문단 블록, 또는 블록 자리에 놓인 인라인 요소(표지 눈썹 글처럼 span 하나가 한 줄) */
export function isTextBlock(n: CNode, parent: CNode | null): boolean {
  if (n.widget || n.tag === "#text") return false;
  if (isInlineBlock(n)) return !(parent && isInlineBlock(parent));
  if (!INLINE_TAGS.has(n.tag) || n.tag === "br" || n.tag === "x-icon" || isChip(n)) return false;
  if (!parent || isInlineBlock(parent)) return false;
  const kids = n.children ?? [];
  return kids.length > 0 && kids.every((c) => INLINE_TAGS.has(c.tag)) && hasText(n);
}

const LIST_TAGS = new Set(["ul", "ol"]);

/**
 * 모티프 장식 묶음(템플릿 TP2) — 표지 F 궤도·간지 패턴 면·숫자 띠 사진 바탕·표지 E 판. 안의 호·노드·물방울을 하나씩 고르지 않고 묶음 통째로
 * 고른다(옮기기·숨기기 단위). 클래스는 디자인 시스템 TP1 블록(kesi-catalog.css).
 * 연구소·ESG 제안형(10-30)의 도식 장식(사업분야 조각 바퀴·경영철학 클로버·기대효과 반원·쪽 아래 로고·쪽 번호 탭)도 묶음으로.
 */
export const DECOR_GROUP_RE = /\bkc-(front__orbit|pattern|kpis__bg|front__plate|front__full|divider__full|rs-biz__wheel|rs-clover|rs-effects__arc|rs-foot)\b/;

export interface Selection {
  id: string;
  node: CNode;
  path: CNode[];
  parent: CNode | null;
  kind: "text" | "image" | "widget" | "infographic" | "list" | "item" | "box" | "added";
}

/** 누른 노드 id → 고를 대상(위젯 안이면 위젯, 인라인 조각이면 그 글 블록). 쪽 루트·없음이면 null */
export function resolveSelection(root: CNode, hitId: string): Selection | null {
  const path = findPath(root, hitId);
  if (!path) return null;
  // 위젯 안이면 가장 가까운 위젯
  for (let i = path.length - 1; i >= 1; i--) {
    if (path[i].widget) return describe(path.slice(0, i + 1));
  }
  // 모티프 장식 묶음 안이면 묶음 통째로
  for (let i = 1; i < path.length; i++) {
    if (DECOR_GROUP_RE.test(path[i].className ?? "")) return describe(path.slice(0, i + 1));
  }
  // 추가한 요소 안이면 그 요소(루트)
  for (let i = 1; i < path.length; i++) {
    if (path[i].origin === "add") return describe(path.slice(0, i + 1));
  }
  // 글 블록 안의 인라인 조각이면 그 블록
  for (let i = 1; i < path.length; i++) {
    if (isTextBlock(path[i], path[i - 1] ?? null)) return describe(path.slice(0, i + 1));
  }
  let end = path.length;
  while (end > 1 && path[end - 1].tag === "#text") end--;
  if (end <= 1) return null;
  return describe(path.slice(0, end));
}

export function describe(path: CNode[]): Selection {
  const node = path[path.length - 1];
  const parent = path.length > 1 ? path[path.length - 2] : null;
  let kind: Selection["kind"] = "box";
  // 추가한 일러스트(313)는 인포그래픽 위젯이라 내용·모양 고치기가 되고, 추가 요소처럼 옮기고 크기를 바꾼다(capabilities 의 added)
  if (node.widget === "infographic") kind = "infographic";
  else if (node.origin === "add") kind = "added";
  else if (node.widget) kind = "widget";
  else if (node.tag === "img") kind = "image";
  else if (LIST_TAGS.has(node.tag)) kind = "list";
  else if (node.tag === "li" && parent && LIST_TAGS.has(parent.tag) && !parent.widget) kind = "item";
  else if (isTextBlock(node, parent)) kind = "text";
  return { id: node.id, node, path, parent, kind };
}

/** 여러 개 고른 것 중 다른 고른 요소 안에 든 것은 뺀다(함께 옮기기·숨기기에서 두 번 적용되지 않게) */
export function outermost(root: CNode, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => !(findPath(root, id) ?? []).slice(0, -1).some((a) => set.has(a.id)));
}

/** 위쪽으로 고를 수 있는 다음 조상(쪽 루트 전까지) */
export function parentSelection(root: CNode, sel: Selection): Selection | null {
  for (let i = sel.path.length - 2; i >= 1; i--) {
    const n = sel.path[i];
    if (n.tag === "#text") continue;
    return describe(sel.path.slice(0, i + 1));
  }
  void root;
  return null;
}

export interface Capabilities {
  editText: boolean;
  image: boolean;
  listItem: boolean;
  hide: boolean;
  infographic: boolean;
  columns: boolean;
  photoLayout: boolean;
  move: boolean;
  resize: boolean;
  typeStep: boolean;
  color: boolean;
  /** 복제(L3) — 추가한 요소·글·사진만(데이터 영역·도식은 빼고) */
  duplicate: boolean;
  /** 막힌 이유(사용자에게 보여 줌) */
  locked?: string;
}

const GRID_COLS_RE = /^repeat\(([1-6]), minmax\(0, 1fr\)\)$/;

export function gridColumnsOf(n: CNode): number | null {
  const v = n.style?.gridTemplateColumns;
  const m = typeof v === "string" ? GRID_COLS_RE.exec(v) : null;
  return m ? Number(m[1]) : null;
}

export function capabilities(sel: Selection, maxLevel: EditLevel): Capabilities {
  const n = sel.node;
  const inWidget = sel.kind === "widget" || sel.kind === "infographic";
  const isRoot = sel.path.length <= 1;
  const added = sel.kind === "added" || n.origin === "add";
  const caps: Capabilities = {
    editText: (sel.kind === "text" || sel.kind === "item") && isTextBlock(n, sel.parent) || (added && n.className?.includes("kc-x-text") === true),
    image: sel.kind === "image" || (added && n.className?.includes("kc-x-image") === true),
    listItem: sel.kind === "item" || (sel.kind === "list" && (n.children?.length ?? 0) > 0),
    hide: maxLevel >= 2 && !isRoot,
    infographic: maxLevel >= 2 && sel.kind === "infographic",
    columns: maxLevel >= 2 && !inWidget && gridColumnsOf(n) != null,
    photoLayout: maxLevel >= 2 && sel.kind === "image",
    move: maxLevel >= 3 && !isRoot,
    resize: maxLevel >= 3 && !isRoot && n.tag !== "#text",
    // 넣은 일러스트는 글자 크기·색을 일러스트 패널(그림 비율·색 모드)로 고친다
    typeStep: maxLevel >= 3 && (sel.kind === "text" || added) && !n.widget,
    color: maxLevel >= 3 && (sel.kind === "text" || sel.kind === "box" || added) && !n.widget,
    duplicate: maxLevel >= 3 && !isRoot && (added || sel.kind === "text" || (sel.kind === "image" && Boolean(n.asset))),
  };
  if (sel.kind === "widget") caps.locked = "데이터에서 자동으로 채우는 영역입니다. 행·항목은 데이터 화면에서 고칩니다.";
  else if (maxLevel === 1) caps.locked = "자동으로 쪽을 나누는 부록 쪽이라 글만 고칠 수 있습니다.";
  else if (maxLevel === 2 && !inWidget) caps.locked = "자동으로 채우는 쪽이라 위치·크기는 바꿀 수 없습니다.";
  return caps;
}

/** 데이터 위젯 → 원천 화면(데이터 탭 바로가기) */
export const WIDGET_SOURCE: Record<string, { label: string; href: string; what: string }> = {
  cases: { label: "실적 노출 관리", href: "/sales/catalog/projects", what: "대표 실적(대표 실적 표시 계약)" },
  table: { label: "실적 노출 관리", href: "/sales/catalog/projects", what: "실적·인력 표(표시 범위·대외 표기)" },
  people: { label: "인물 노출 관리", href: "/sales/catalog/people", what: "임원·인력(노출·사진·약력)" },
  org: { label: "조직도", href: "/sales/catalog/org", what: "조직도(최신 확정판)" },
  logos: { label: "고객사 로고", href: "/sales/catalog/assets", what: "고객사·협력 기관 로고" },
  credentials: { label: "회사 프로필 관리", href: "/admin/company-profile", what: "면허·인증·특허·수상" },
  timeline: { label: "회사 프로필 관리", href: "/admin/company-profile", what: "연혁" },
  chips: { label: "계약 관리", href: "/contracts", what: "통합환경허가 수행 업종" },
  map: { label: "계약 관리", href: "/contracts", what: "권역별 수행 실적·사업장 위치" },
};
