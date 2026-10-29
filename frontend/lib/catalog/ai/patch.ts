/*
 * 회사소개서 LLM 편집(P6) 공용 핵심 — 쪽 개요(LLM 에 주는 고칠 수 있는 자리), JSON 패치 검증, 편집층 조각 만들기. 클라이언트 안전.
 * 블루프린트 §7-2: LLM 은 스키마에 맞는 JSON 패치만 돌려준다(좌표·크기는 건드리지 않음 — recruit applyMapping 원칙).
 *   §7-5 A·B: 모양·색은 이산 값만 고른다 — shape(라이브러리 일러스트 id·색 모드·분야/브랜드 토큰·맞춤 2값·변형) · style(글자·바탕 색 토큰, 대비 4.5:1 미만은 대체).
 *   숫자는 {{metric:지표 id}} 로만 쓰고, 지표 목록에 없는 숫자는 '검토' 표시를 붙인다. 근거 없는 최상급·이모지도 검토 표시.
 *   채택은 자리(노드 id)마다 고를 수 있다(부분 채택) — 결과는 보통 편집과 같은 편집층(PageEdits.nodes[id])에 들어간다.
 */
import { ILLUST_COLOR_MODES, contrastRatio, cssColorHex, groupCount, illustCandidates, type IllustrationInfo } from "@/lib/catalog/illustration-types";
import { fmt } from "@/lib/catalog/render/components/parts";
import { matchInfographic } from "@/lib/catalog/render/infographic/match";
import {
  INFO_TYPE_META,
  isInfoType,
  sanitizeInfoContent,
  type InfoBox,
  type InfoColorMode,
  type InfoContent,
  type InfoIllust,
  type InfoItem,
  type InfoType,
} from "@/lib/catalog/render/infographic/types";
import type { InfoSlotProps } from "@/lib/catalog/render/infographic/slot";
import { FILL_COLORS, TEXT_COLORS } from "@/lib/catalog/studio/design-system";
import { addedKind, patchNodeStyle, sanitizeNodeEdit, setInfo, type InfoOverride, type NodeEdit, type PageEdits } from "@/lib/catalog/studio/edits";
import { findPath, isInlineBlock, newUserId, type CNode } from "@/lib/catalog/studio/nodes";

// ───────────────────────── 지표 ─────────────────────────

export interface MetricBrief {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  footnote: string;
}

export const METRIC_TOKEN_RE = /\{\{metric:([a-z0-9.]{1,40})\}\}/g;

export function metricText(m: MetricBrief | undefined): string {
  return m ? fmt(m.value ?? null) : "-";
}

/** {{metric:id}} 표식을 사람이 읽는 값으로(검토 화면) */
export function readableText(text: string, metrics: Record<string, MetricBrief>): string {
  return text.replace(METRIC_TOKEN_RE, (_, id: string) => {
    const m = metrics[id];
    return m ? `${metricText(m)}` : `[없는 지표 ${id}]`;
  });
}

// ───────────────────────── 글 ↔ 노드 ─────────────────────────

const PLAIN_TAGS = new Set(["#text", "br", "strong", "b", "em", "i", "u", "small"]);

/** 고칠 수 있는 단순 문단인가 — 글·줄바꿈·굵게, 지표 칩만(아이콘·쪽 링크·쪽 번호·데이터 바인딩·구조 span 은 안 됨) */
export function isPlainInline(n: CNode): boolean {
  const ok = (c: CNode): boolean => {
    if (c.bind) return c.bind.startsWith("metric:");
    if (!PLAIN_TAGS.has(c.tag)) return false;
    if (c.tag !== "#text" && c.tag !== "br" && c.className) return false;
    return (c.children ?? []).every(ok);
  };
  return (n.children ?? []).every(ok);
}

/** 문단 자식 → 글(지표 칩은 {{metric:id}}) */
export function inlineText(n: CNode): string {
  const walk = (c: CNode): string => {
    if (c.tag === "#text") return c.text ?? "";
    if (c.tag === "br") return "\n";
    if (c.tag === "x-icon") return "";
    if (c.bind?.startsWith("metric:")) return `{{metric:${c.bind.slice(7)}}}`;
    return (c.children ?? []).map(walk).join("");
  };
  return (n.children ?? []).map(walk).join("").replace(/[ \t]+/g, " ").trim();
}

/** 글 → 문단 자식(지표 칩·줄바꿈) */
export function textToNodes(text: string, metrics: Record<string, MetricBrief>): CNode[] {
  const out: CNode[] = [];
  const pushText = (t: string) => {
    t.split("\n").forEach((part, i) => {
      if (i > 0) out.push({ id: newUserId(), tag: "br" });
      if (part) out.push({ id: newUserId(), tag: "#text", text: part });
    });
  };
  let last = 0;
  for (const m of text.matchAll(METRIC_TOKEN_RE)) {
    pushText(text.slice(last, m.index));
    const id = m[1];
    out.push({ id: newUserId(), tag: "span", attrs: { "data-metric": id }, bind: `metric:${id}`, children: [{ id: newUserId(), tag: "#text", text: metricText(metrics[id]) }] });
    last = (m.index ?? 0) + m[0].length;
  }
  pushText(text.slice(last));
  return out.length ? out : [{ id: newUserId(), tag: "#text", text: "" }];
}

/** 글자 수(공백 제외, 지표 표식은 값 길이로) */
export function charLen(text: string, metrics?: Record<string, MetricBrief>): number {
  const t = text.replace(METRIC_TOKEN_RE, (_, id: string) => (metrics ? metricText(metrics[id]) : "000"));
  return t.replace(/\s+/g, "").length;
}

// ───────────────────────── 쪽 개요 ─────────────────────────

export type BlockRole = "title" | "lead" | "heading" | "body" | "label" | "caption";

export interface TextBlock {
  kind: "text";
  id: string;
  role: BlockRole;
  text: string;
  maxChars: number;
  /** 사람이 읽는 자리 이름 */
  label: string;
  focus?: boolean;
  /** 맥락으로만(숫자 칸·아이콘·링크가 섞인 글 등) — 글은 고칠 수 없음(색은 style 로) */
  readonly?: boolean;
  /** 지금 직접 정한 글자·바탕 색 토큰(없으면 기본) */
  color?: string;
  background?: string;
}

export interface ListBlock {
  kind: "list";
  id: string;
  items: string[];
  maxItems: number;
  maxChars: number;
  label: string;
  focus?: boolean;
  color?: string;
  background?: string;
}

export interface InfoBlock {
  kind: "info";
  id: string;
  slot: string;
  type: InfoType;
  variant?: string;
  box: InfoBox;
  area: number;
  content: InfoContent;
  label: string;
  focus?: boolean;
  /** 지금 모양 — 일러스트(있으면 기본 도식 대신)·기본 도식 색 모드 */
  illust?: InfoIllust;
  colorMode?: InfoColorMode;
  /** 추가한 일러스트(L3) — 모양(색·맞춤·같은 항목 수 일러스트)만 고친다 */
  added?: boolean;
}

/** 추가한 글상자·도형(L3) — 색(style)만 고친다 */
export interface AddedBlock {
  kind: "added";
  id: string;
  element: "text" | "shape";
  text: string;
  label: string;
  focus?: boolean;
  color?: string;
  background?: string;
}

/** 분야 쪽 대표 실적(데이터 위젯) — 실제 계약 후보에서만 고른다 */
export interface CasesBlock {
  kind: "cases";
  id: string;
  /** 지금 보이는 대표 실적(연도·표기) */
  items: Array<{ year: string; title: string }>;
  label: string;
  focus?: boolean;
}

export type OutlineBlock = TextBlock | ListBlock | InfoBlock | CasesBlock | AddedBlock;

export interface PageOutline {
  key: string;
  type: string;
  label: string;
  blocks: OutlineBlock[];
}

const ROLE_RULES: Array<[RegExp, BlockRole]> = [
  [/\bkc-(page-title|cover__title|divider__title|title)\b/, "title"],
  [/\bkc-lead\b/, "lead"],
  [/\bkc-blockhead\b/, "heading"],
  [/\bkc-(eyebrow|kpi__label|badge|areatag)\b/, "label"],
  [/\bkc-(caption|ig__desc|front__sub)\b/, "caption"],
];
const FIGURE_CLASS = /\bkc-(kpi__figure|stat__fig|ig__fig|kpi__unit)\b/;
// 템플릿 TP2 장식 묶음(표지 F 궤도·패턴 면·사진 바탕·표지 E 판)과 분야 요약(C20)의 문의 칸(회사 프로필 값)은 AI 가 고치지 않는다
const SKIP_CLASS = /\b(kc-head|kc-footnote|kc-notes|pk-outline|kc-draftmark|kc-drop|kc-front__orbit|kc-pattern|kc-kpis__bg|kc-front__plate|kc-front__full|kc-divider__full|kc-brief__contact)\b/;

const ROLE_LABEL: Record<BlockRole, string> = { title: "쪽 제목", lead: "리드 문장", heading: "블록 제목", body: "본문", label: "짧은 라벨", caption: "설명 글" };
const ROLE_CAP: Record<BlockRole, number> = { title: 30, lead: 260, heading: 30, body: 260, label: 24, caption: 120 };

function roleOf(n: CNode): BlockRole {
  const c = n.className ?? "";
  for (const [re, role] of ROLE_RULES) if (re.test(c)) return role;
  return "body";
}

function maxCharsFor(role: BlockRole, current: number): number {
  const floor = role === "lead" || role === "body" ? 60 : role === "caption" ? 30 : 10;
  return Math.min(ROLE_CAP[role], Math.max(floor, Math.ceil(current * 1.3)));
}

const snip = (t: string, n = 14) => (t.length > n ? `${t.slice(0, n)}…` : t);

/** 노드 스타일의 색 토큰 이름(var(--토큰) 일 때만) */
function styleToken(n: CNode, key: "color" | "background"): string | undefined {
  const v = n.style?.[key] ?? (key === "background" ? n.style?.backgroundColor : undefined);
  const m = typeof v === "string" ? /^var\(--([a-z0-9-]+)\)$/.exec(v.trim()) : null;
  return m?.[1];
}

function toneOf(n: CNode): { color?: string; background?: string } {
  const color = styleToken(n, "color");
  const background = styleToken(n, "background");
  return { ...(color ? { color } : {}), ...(background ? { background } : {}) };
}

/**
 * 파생 트리(편집층 적용 후) → 쪽 개요. 숨긴 요소·쪽 머리·각주·데이터 위젯 안은 빼고, 인포그래픽과 분야 대표 실적은 따로 둔다.
 * focusId 를 주면 그 요소(와 안쪽)를 focus 로 표시한다(사용자가 고른 블록).
 */
export function buildOutline(tree: CNode, item: { key: string; type: string; label: string }, opts: { focusId?: string | null; casesEditable?: boolean } = {}): PageOutline {
  const blocks: OutlineBlock[] = [];
  let lastHeading = "";
  const walk = (n: CNode, focus: boolean) => {
    if (n.hiddenByEdit || n.tag === "#text") return;
    const here = focus || (opts.focusId != null && n.id === opts.focusId);
    if (n.origin === "add") {
      // 추가한 요소의 글은 사람이 직접 고친다 — 글상자·도형의 색과 추가한 일러스트의 모양만 AI 자리로
      if (n.owner !== n.id) return;
      const kind = addedKind(n);
      if (kind === "illust" && n.widget === "infographic" && n.props) {
        const p = n.props as unknown as InfoSlotProps;
        blocks.push({ kind: "info", id: n.id, slot: p.slot, type: p.spec.type, variant: p.spec.variant, box: p.box, area: p.area ?? 1, content: p.spec.content, label: "추가한 일러스트", added: true, ...(p.spec.illust ? { illust: p.spec.illust } : {}), ...(here ? { focus: true } : {}) });
      } else if (kind === "text" || kind === "shape") {
        const text = kind === "text" ? inlineText(n) : "";
        blocks.push({ kind: "added", id: n.id, element: kind, text, label: kind === "text" ? `추가한 글상자${text ? ` '${snip(text)}'` : ""}` : "추가한 도형", ...toneOf(n), ...(here ? { focus: true } : {}) });
      }
      return;
    }
    const cls = n.className ?? "";
    if (SKIP_CLASS.test(cls) || n.attrs?.["aria-hidden"] === "true") return;
    if (n.widget === "infographic" && n.props) {
      const p = n.props as unknown as InfoSlotProps;
      blocks.push({
        kind: "info",
        id: n.id,
        slot: p.slot,
        type: p.spec.type,
        variant: p.spec.variant,
        box: p.box,
        area: p.area ?? 1,
        content: p.spec.content,
        label: `인포그래픽 · ${INFO_TYPE_META[p.spec.type]?.label ?? p.spec.type}${lastHeading ? `(${snip(lastHeading)})` : ""}`,
        ...(p.spec.illust ? { illust: p.spec.illust } : {}),
        ...(p.spec.colorMode ? { colorMode: p.spec.colorMode } : {}),
        ...(here ? { focus: true } : {}),
      });
      return;
    }
    if (n.widget) {
      if (n.widget === "cases" && opts.casesEditable) {
        const items = (n.children ?? [])
          .filter((li) => li.tag === "li")
          .map((li) => {
            const parts = (li.children ?? []).map((c) => inlineText({ id: "", tag: "span", children: [c] }));
            return { year: parts[0] ?? "", title: parts[1] ?? "" };
          });
        blocks.push({ kind: "cases", id: n.id, items, label: "대표 실적", ...(here ? { focus: true } : {}) });
      }
      return;
    }
    // 목록 — 항목이 모두 단순 문단이면 목록 통째로
    if ((n.tag === "ul" || n.tag === "ol") && n.origin !== "pin" && (n.children ?? []).length > 0 && n.children!.every((c) => c.tag === "li" && isInlineBlock(c) && isPlainInline(c))) {
      const items = n.children!.map(inlineText);
      const longest = Math.max(...items.map((t) => charLen(t)));
      blocks.push({
        kind: "list",
        id: n.id,
        items,
        maxItems: Math.min(10, items.length + 3),
        maxChars: Math.min(60, Math.max(24, Math.ceil(longest * 1.3))),
        label: `목록${lastHeading ? `(${snip(lastHeading)})` : ""}`,
        ...toneOf(n),
        ...(here ? { focus: true } : {}),
      });
      return;
    }
    if (isInlineBlock(n)) {
      const text = inlineText(n);
      if (!text) return;
      const role = roleOf(n);
      // 고정한 글 안쪽(소유 노드가 따로 있음)은 그 소유 노드 단위로만 고친다
      const readonly = FIGURE_CLASS.test(cls) || !isPlainInline(n) || n.tag === "a" || n.origin === "pin";
      if (role === "heading") lastHeading = text;
      blocks.push({
        kind: "text",
        id: n.id,
        role,
        text,
        maxChars: maxCharsFor(role, charLen(text)),
        label: role === "heading" || role === "label" ? `${ROLE_LABEL[role]} '${snip(text)}'` : ROLE_LABEL[role],
        ...toneOf(n),
        ...(here ? { focus: true } : {}),
        ...(readonly ? { readonly: true } : {}),
      });
      return;
    }
    // 구조 span(블록 제목의 오른쪽 말 등)이 섞인 문단은 맥락으로만
    for (const c of n.children ?? []) walk(c, here);
  };
  walk(tree, false);
  return { key: item.key, type: item.type, label: item.label, blocks };
}

export function editableBlocks(o: PageOutline): OutlineBlock[] {
  return o.blocks.filter((b) => !(b.kind === "text" && b.readonly));
}

// ───────────────────────── 검사 규칙 ─────────────────────────

export type FlagKind = "number" | "superlative" | "emoji" | "length" | "items" | "type" | "metric" | "case" | "trimmed" | "shape" | "color" | "contrast";

export interface Flag {
  kind: FlagKind;
  /** review = 사람이 확인(기본 채택 안 함) · note = 알림(자동으로 고친 것 등) */
  severity: "review" | "note";
  message: string;
}

/** 근거 없는 최상급·과장(디자인 시스템 README 콘텐츠 원칙) — '최초허가'는 제도 용어라 뺀다 */
const SUPERLATIVES: Array<[RegExp, string]> = [
  [/업계\s*(최고|최대|최초|1위|유일)/, "업계 최고·최대"],
  [/(국내|세계|업계|국내외)\s*(최고|최대|유일|1위|최다|최초)/, "국내·세계 최고·최대"],
  [/최초(?!\s*허가)/, "'최초'"],
  [/(최고|최상|최대|최다)(의|급|\s*수준)/, "최고·최상 수준"],
  [/유일(한|무이)/, "유일한"],
  [/독보적|압도적|완벽(한|하게)|탁월한|최적의|최상의/, "과장 표현"],
  [/(No\.?\s*1|넘버\s*원|일등|1등)/i, "1위·No.1"],
];

export function findSuperlatives(text: string): string[] {
  return SUPERLATIVES.filter(([re]) => re.test(text)).map(([, label]) => label);
}

const EMOJI = /\p{Extended_Pictographic}/u;

/** 지표 표식 밖의 아라비아 숫자 — 원래 쪽 글에 있던 숫자(이어 쓴 것)는 허용 목록으로 뺀다 */
export function looseNumbers(text: string, carried: Set<string>): string[] {
  const bare = text.replace(METRIC_TOKEN_RE, " ");
  const found = bare.match(/\d[\d,.]*/g) ?? [];
  return [...new Set(found.map((d) => d.replace(/[.,]+$/, "")).filter((d) => d && !carried.has(d)))];
}

/** 쪽 글에 이미 있던 숫자 모음(검토 표시 예외) */
export function numbersIn(texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const d of t.replace(METRIC_TOKEN_RE, " ").match(/\d[\d,.]*/g) ?? []) out.add(d.replace(/[.,]+$/, ""));
  return out;
}

export function outlineTexts(o: PageOutline): string[] {
  const out: string[] = [];
  for (const b of o.blocks) {
    if (b.kind === "text") out.push(b.text);
    else if (b.kind === "list") out.push(...b.items);
    else if (b.kind === "info") out.push(b.content.title ?? "", b.content.center?.label ?? "", ...b.content.items.flatMap((it) => [it.label, it.desc ?? "", it.when ?? "", it.sub ?? ""]));
    else if (b.kind === "cases") out.push(...b.items.map((c) => `${c.year} ${c.title}`));
    else out.push(b.text);
  }
  return out;
}

export interface CheckContext {
  metrics: Record<string, MetricBrief>;
  carried: Set<string>;
}

/** 글 하나 검사 — 없는 지표는 지우고, 숫자·최상급·이모지·길이를 표시 */
export function checkText(raw: string, maxChars: number, ctx: CheckContext): { text: string; flags: Flag[] } {
  const flags: Flag[] = [];
  let text = String(raw ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, 600);
  const unknown: string[] = [];
  text = text.replace(METRIC_TOKEN_RE, (all, id: string) => {
    if (ctx.metrics[id]) return all;
    unknown.push(id);
    return "";
  });
  if (unknown.length) flags.push({ kind: "metric", severity: "review", message: `목록에 없는 지표(${unknown.join(", ")})를 지웠습니다.` });
  const nums = looseNumbers(text, ctx.carried);
  if (nums.length) flags.push({ kind: "number", severity: "review", message: `지표에 묶이지 않은 숫자: ${nums.slice(0, 4).join(", ")} — 근거를 확인하세요.` });
  const sup = findSuperlatives(text);
  if (sup.length) flags.push({ kind: "superlative", severity: "review", message: `근거 없는 최상급·과장(${sup.join(", ")}) — 수치로 바꾸세요.` });
  if (EMOJI.test(text)) flags.push({ kind: "emoji", severity: "review", message: "이모지는 쓰지 않습니다." });
  const n = charLen(text, ctx.metrics);
  if (n > maxChars) flags.push({ kind: "length", severity: "note", message: `${n}자 — 권장 ${maxChars}자를 넘습니다(넘침 검사로 확인).` });
  return { text, flags };
}

// ───────────────────────── 패치 ─────────────────────────

export type PatchOp =
  | { op: "text"; id: string; text: string }
  | { op: "list"; id: string; items: string[] }
  | {
      op: "info";
      id: string;
      type?: string;
      variant?: string;
      title?: string;
      center?: { label: string; desc?: string };
      items?: Array<{ label: string; desc?: string; when?: string; icon?: string; metric?: string; sub?: string }>;
    }
  | { op: "cases"; id: string; ids: string[] }
  | {
      /** 모양·색(§7-5 A) — 일러스트 id·색 모드·토큰·맞춤만. null(또는 asset null) = 기본 도식으로 */
      op: "shape";
      id: string;
      illust?: { asset?: string | null; colors?: { mode: string; map?: Record<string, string> }; fit?: "width" | "height" | null } | null;
      variant?: string;
      colorMode?: string;
    }
  | { op: "style"; id: string; color?: string; background?: string };

/** 그 인포그래픽 자리에 쓸 수 있는 일러스트(서버가 illustCandidates 로 고른 화이트리스트) */
export interface ShapeChoice {
  id: string;
  title: string;
  type: InfoType;
  /** 그림의 항목 수(내용 항목 수와 같아야 함) */
  count: number;
  /** 유채색 무리 수 — colors.map 의 무리 키("0"…) 상한 */
  groups: number;
  reasons: string[];
  /** 지금 내용을 얹으면 넘치는 글자 자리 수 */
  overflow: number;
  /** 지금 그 자리에 쓰인 일러스트 */
  current?: boolean;
}

/** 자리 하나의 일러스트 후보 — 항목 수 같은 라이브러리 자산 상위 limit 개 + 지금 쓰는 일러스트 */
export function shapeChoices(list: IllustrationInfo[], block: { content: InfoContent; type: InfoType; box: InfoBox; illust?: { asset: string } }, pageType: string, limit = 6): ShapeChoice[] {
  const out: ShapeChoice[] = illustCandidates(list, block.content, { type: block.type, pageType, box: block.box })
    .slice(0, limit)
    .map((c) => ({ id: c.info.assetId, title: c.info.title, type: c.info.type, count: c.info.count, groups: groupCount(c.info.palette), reasons: c.reasons.slice(0, 4), overflow: c.overflow }));
  const cur = block.illust ? list.find((i) => i.assetId === block.illust!.asset) : undefined;
  if (cur) {
    const hit = out.find((c) => c.id === cur.assetId);
    if (hit) hit.current = true;
    else out.unshift({ id: cur.assetId, title: cur.title, type: cur.type, count: cur.count, groups: groupCount(cur.palette), reasons: ["지금 쓰는 일러스트"], overflow: 0, current: true });
  }
  return out;
}

/** 일러스트 직접 색(colors.map)과 기본 도식 색에 쓰는 분야·브랜드 토큰 */
export const SHAPE_COLOR_TOKENS: string[] = [
  "brand",
  "accent",
  "accent-2",
  "ci-navy",
  "ci-green",
  "ci-blue",
  "ci-gray",
  ...[1, 2, 3, 4, 5, 6].flatMap((i) => [`area-${i}`, `area-${i}-mid`, `area-${i}-tint`]),
];

export const INFO_COLOR_MODES: Array<{ id: InfoColorMode; label: string }> = [
  { id: "area", label: "이 쪽 분야 색" },
  { id: "brand", label: "브랜드 색" },
  { id: "mono", label: "단색" },
];

/** 대비 기준(디자인 시스템 README — 본문 4.5:1) */
export const MIN_CONTRAST = 4.5;

export interface CaseCandidate {
  id: string;
  year: string;
  title: string;
  meta: string;
  /** 지금 대표 실적으로 지정됨 */
  featured: boolean;
}

export interface ProposedChange {
  /** 노드 id(쪽 편집층의 자리) */
  id: string;
  kind: "text" | "list" | "info" | "cases" | "shape" | "style";
  label: string;
  /** 검토 화면에 보이는 전·후(지표 표식은 값으로) */
  before: string[];
  after: string[];
  flags: Flag[];
  /** 편집층 조각(text·list·info) */
  edit?: NodeEdit;
  /** 대표 실적 계약 id(cases) — 채택 시 실적 노출 관리의 대표 실적 지정으로 반영 */
  featured?: string[];
  /** 이 바꿈의 LLM/규칙 원천 */
  source: "ai" | "rule";
  /** 다시 줄일 때 쓰는 원문(글·목록 항목, 지표 표식 포함) */
  raw?: string[];
  /** 색 토큰 덧씌우기(style) — 채택 때 patchNodeStyle 로(추가 요소·고정 글 안쪽도) */
  style?: Record<string, string>;
  /** 모양 바꿈이 얹히는 내용·유형(넘침 축약 때 이 내용을 줄인다) */
  content?: InfoContent;
  infoType?: InfoType;
  /** 바꾼 뒤 그 자리의 일러스트 id(없으면 기본 도식) — 축약 때 제목 뒤 지표 칩 폭을 셈 */
  illust?: string;
  /** 색이 바뀜(검토 화면 '색 바뀜' 칩) */
  recolor?: boolean;
}

/** 검토 화면의 바뀜 종류 이름 */
export function changeKindLabel(c: ProposedChange): string | null {
  if (c.kind === "shape") return c.illust ? "모양" : "모양(기본 도식)";
  if (c.kind === "style") return "색";
  return null;
}

export function hasReview(c: ProposedChange): boolean {
  return c.flags.some((f) => f.severity === "review");
}

function liTemplate(tree: CNode, listId: string): CNode | null {
  const find = (n: CNode): CNode | null => {
    if (n.id === listId) return n;
    for (const c of n.children ?? []) {
      const hit = find(c);
      if (hit) return hit;
    }
    return null;
  };
  const list = find(tree);
  return list?.children?.find((c) => c.tag === "li") ?? null;
}

/** 글 바꿈 → 편집층 조각(그 문단을 고정) */
export function textEdit(text: string, metrics: Record<string, MetricBrief>): NodeEdit {
  return sanitizeNodeEdit({ content: textToNodes(text, metrics) }) ?? { content: [] };
}

/** 목록 바꿈 → 편집층 조각(목록을 고정, 항목 모양은 첫 항목에서) */
export function listEdit(items: string[], tree: CNode, listId: string, metrics: Record<string, MetricBrief>): NodeEdit {
  const tpl = liTemplate(tree, listId);
  const content = items.map((t) => ({
    id: newUserId(),
    tag: "li",
    ...(tpl?.className ? { className: tpl.className } : {}),
    ...(tpl?.style ? { style: tpl.style } : {}),
    children: textToNodes(t, metrics),
  }));
  return sanitizeNodeEdit({ content }) ?? { content: [] };
}

const iconOk = (v: unknown) => typeof v === "string" && /^[a-z0-9-]{1,30}$/.test(v);

/** 인포그래픽 패치 → 내용·유형(검사 포함). 막히면 null 과 사유 */
export function checkInfo(
  block: InfoBlock,
  op: Extract<PatchOp, { op: "info" }>,
  ctx: CheckContext
): { type: InfoType; variant?: string; content: InfoContent; flags: Flag[] } | { error: string } {
  const flags: Flag[] = [];
  let type: InfoType = block.type;
  if (op.type != null) {
    if (!isInfoType(op.type)) return { error: `모르는 인포그래픽 유형 '${String(op.type)}'` };
    type = op.type;
  }
  let content: InfoContent = block.content;
  if (op.items || op.title !== undefined || op.center !== undefined) {
    const meta = INFO_TYPE_META[type];
    const items: InfoItem[] = (op.items ?? block.content.items).slice(0, 20).map((raw, i) => {
      const r = raw as Record<string, unknown>;
      const label = checkText(String(r.label ?? ""), meta.maxLabel, ctx);
      const it: InfoItem = { id: `a${i + 1}`, label: label.text };
      flags.push(...label.flags.map((f) => ({ ...f, message: `항목 ${i + 1} 라벨: ${f.message}` })));
      if (r.desc) {
        const d = checkText(String(r.desc), Math.max(meta.maxDesc, 20), ctx);
        it.desc = d.text;
        flags.push(...d.flags.map((f) => ({ ...f, message: `항목 ${i + 1} 설명: ${f.message}` })));
        if (meta.maxDesc === 0) flags.push({ kind: "type", severity: "note", message: `${meta.label} 유형은 설명 글을 그리지 않습니다.` });
      }
      if (typeof r.when === "string" && r.when.trim()) it.when = r.when.trim().slice(0, 20);
      if (typeof r.sub === "string" && r.sub.trim()) it.sub = r.sub.trim().slice(0, 40);
      if (iconOk(r.icon)) it.icon = r.icon as string;
      if (typeof r.metric === "string") {
        const m = ctx.metrics[r.metric];
        if (m) {
          it.metric = r.metric;
          it.value = m.value ?? undefined;
          if (m.unit) it.unit = m.unit;
        } else flags.push({ kind: "metric", severity: "review", message: `항목 ${i + 1}: 목록에 없는 지표 '${r.metric}'를 뺐습니다.` });
      }
      return it;
    });
    // when 의 숫자(연도)는 원래 내용에 있던 것만 근거로 본다
    const whenNums = looseNumbers(items.map((it) => it.when ?? "").join(" "), ctx.carried);
    if (whenNums.length) flags.push({ kind: "number", severity: "review", message: `시점 ${whenNums.slice(0, 4).join(", ")} — 근거를 확인하세요.` });
    content = sanitizeInfoContent({ ...block.content, items, ...(op.title !== undefined ? { title: op.title } : {}), ...(op.center !== undefined ? { center: op.center } : {}) });
    // 수치형 유형인데 지표 없는 항목이 있으면 막는다(숫자를 지어내지 못하게)
    if (meta.family === "number" && content.items.some((it) => !it.metric && it.value == null)) return { error: `${meta.label}는 항목마다 지표가 있어야 합니다.` };
  }
  const { candidates, blocked } = matchInfographic(content, { box: block.box, current: block.type });
  const stop = blocked.find((b) => b.type === type);
  if (stop) return { error: `${INFO_TYPE_META[type].label}: ${stop.reason}` };
  const cand = candidates.find((c) => c.type === type);
  const variant = op.variant && INFO_TYPE_META[type].variants.some((v) => v.id === op.variant) ? op.variant : type === block.type ? block.variant : cand?.variant;
  const n = content.items.length;
  const meta = INFO_TYPE_META[type];
  if (n < meta.min || n > meta.max) flags.push({ kind: "items", severity: "review", message: `항목 ${n}개 — ${meta.label}는 ${meta.min}~${meta.max}개입니다.` });
  // 항목마다 같은 알림(설명 글 안 그림 등)은 한 번만
  const seenMsg = new Set<string>();
  return { type, variant, content, flags: flags.filter((f) => !seenMsg.has(f.message) && (seenMsg.add(f.message), true)) };
}

/** 인포그래픽 항목 줄(검토 화면) — 지표는 값으로 */
export function infoItemLines(c: InfoContent, metrics: Record<string, MetricBrief>): string[] {
  return c.items.map((it, i) => {
    const v = it.metric ? ` = ${metricText(metrics[it.metric])}${metrics[it.metric]?.unit ?? ""}` : "";
    return `${i + 1}. ${it.label}${it.desc ? ` — ${it.desc}` : ""}${it.when ? ` (${it.when})` : ""}${v}`;
  });
}

function infoLines(c: InfoContent, type: InfoType, metrics: Record<string, MetricBrief>): string[] {
  const lines = [`유형: ${INFO_TYPE_META[type]?.label ?? type}`];
  if (c.title) lines.push(`제목: ${c.title}`);
  if (c.center) lines.push(`중심: ${c.center.label}`);
  return [...lines, ...infoItemLines(c, metrics)];
}

// ───────────────────────── 모양·색(§7-5 A·B) ─────────────────────────

const SHAPE_KEYS = new Set(["op", "id", "illust", "variant", "colorMode"]);
const STYLE_KEYS = new Set(["op", "id", "color", "background"]);

/** 받지 않는 키(좌표·크기·hex 같은 값이 섞여 오면 버리고 알린다) */
function extraKeys(op: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(op).filter((k) => !allowed.has(k)).slice(0, 6);
}

/** 토큰 이름 — "area-4" 또는 "var(--area-4)" 만(hex·rgb·임의 CSS 는 null) */
function tokenName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  const m = /^var\(--([a-z0-9-]{1,30})\)$/.exec(t);
  return m ? m[1] : /^[a-z][a-z0-9-]{0,29}$/.test(t) ? t : null;
}

const illustModeLabel = (m: string | undefined) => ILLUST_COLOR_MODES.find((x) => x.id === (m ?? "area"))?.label ?? m ?? "";
const infoModeLabel = (m: string | undefined) => INFO_COLOR_MODES.find((x) => x.id === (m ?? "area"))?.label ?? m ?? "";

interface ShapeState {
  illust?: InfoIllust;
  type: InfoType;
  variant?: string;
  colorMode?: InfoColorMode;
}

function shapeLines(s: ShapeState, titleOf: (id: string) => string): string[] {
  if (s.illust) {
    const own = Object.keys(s.illust.colors?.map ?? {}).length;
    return [
      `모양: 일러스트 '${titleOf(s.illust.asset)}'`,
      `색: ${illustModeLabel(s.illust.colors?.mode)}${own ? ` + 직접 고른 색 ${own}곳` : ""}`,
      `크기: ${s.illust.fit === "width" ? "자리 폭 전체" : "자리 높이에 맞춤"}`,
    ];
  }
  const meta = INFO_TYPE_META[s.type];
  const v = meta?.variants.find((x) => x.id === s.variant)?.label;
  return [`모양: 기본 도식(${meta?.label ?? s.type}${v ? ` · ${v}` : ""})`, `색: ${infoModeLabel(s.colorMode)}`];
}

/** 일러스트 직접 색 정리 — 무리 키("0"…무리 수-1)·항목 키("i1"…항목 수)와 분야·브랜드 토큰만 */
function cleanColorMap(raw: unknown, choice: ShapeChoice | undefined, flags: Flag[]): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  let bad = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 24)) {
    const t = tokenName(v);
    const g = /^\d{1,2}$/.test(k) ? Number(k) : null;
    const it = /^i(\d{1,2})$/.exec(k);
    const keyOk = g != null ? !choice || g < choice.groups : it ? Number(it[1]) >= 1 && (!choice || Number(it[1]) <= choice.count) : false;
    if (keyOk && t && SHAPE_COLOR_TOKENS.includes(t)) out[k] = t;
    else bad += 1;
  }
  if (bad) flags.push({ kind: "color", severity: "note", message: `토큰이 아니거나 그림에 없는 자리의 색 ${bad}곳은 뺐습니다.` });
  return Object.keys(out).length ? out : undefined;
}

export interface ShapeCheck {
  override: InfoOverride;
  before: string[];
  after: string[];
  flags: Flag[];
  recolor: boolean;
  /** 바꾼 뒤 일러스트 id(없으면 기본 도식) */
  illust?: string;
}

/**
 * 모양 연산 검사 — 일러스트는 그 자리 후보(항목 수 같은 라이브러리 자산)나 지금 쓰는 것만, 색은 모드·분야/브랜드 토큰만, 맞춤은 2값만.
 * base = 이 연산이 얹힐 내용·유형(같은 자리의 내용 바꿈이 먼저 있으면 그 결과), cur = 그때의 일러스트. 바뀐 것이 없으면 null.
 */
export function checkShape(
  block: InfoBlock,
  op: Record<string, unknown>,
  choices: ShapeChoice[],
  base: { content: InfoContent; type: InfoType },
  cur: InfoIllust | undefined
): ShapeCheck | { error: string } | null {
  const flags: Flag[] = [];
  const { type } = base;
  const n = base.content.items.length;
  const byId = new Map(choices.map((c) => [c.id, c]));
  let next: InfoIllust | undefined = cur;
  let choice = cur ? byId.get(cur.asset) : undefined;
  if ("illust" in op) {
    const raw = op.illust;
    const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    if (raw === null || (o && o.asset === null)) {
      if (block.added) return { error: "추가한 일러스트는 기본 도식으로 바꿀 수 없습니다(지우고 새로 넣습니다)." };
      next = undefined;
    } else if (o) {
      const asset = typeof o.asset === "string" ? o.asset : cur?.asset;
      if (!asset) return { error: "고를 일러스트 id 가 없습니다." };
      if (asset !== cur?.asset) {
        const c = byId.get(asset);
        if (!c) return { error: `후보에 없는 일러스트(${asset.slice(0, 24)})` };
        if (c.count !== n) return { error: `'${c.title}'은 항목 ${c.count}개 그림인데 내용은 ${n}개입니다.` };
        choice = c;
        if (c.overflow) flags.push({ kind: "shape", severity: "note", message: `글자 넘침 예상 ${c.overflow}자리 — 넘침 검사로 확인합니다.` });
      }
      // 판 교체처럼 색 설정은 이어 받는다(직접 고른 색은 같은 그림일 때만 — 무리 번호가 그림마다 다르다)
      let colors = cur?.colors ? (asset === cur.asset ? cur.colors : { mode: cur.colors.mode }) : undefined;
      if (o.colors !== undefined) {
        const c = (o.colors && typeof o.colors === "object" ? o.colors : {}) as Record<string, unknown>;
        const mode = ILLUST_COLOR_MODES.find((m) => m.id === c.mode)?.id;
        if (!mode) flags.push({ kind: "color", severity: "note", message: `모르는 색 모드(${String(c.mode).slice(0, 20)}) — 지금 색을 둡니다.` });
        else {
          const map = cleanColorMap(c.map, choice, flags);
          colors = map ? { mode, map } : { mode };
        }
      }
      let fit = cur?.fit;
      if (o.fit === "width") fit = "width";
      else if (o.fit === null || o.fit === "height") fit = undefined;
      else if (o.fit !== undefined) flags.push({ kind: "shape", severity: "note", message: "크기는 '자리 폭 전체'와 '자리 높이에 맞춤' 두 가지뿐이라 지금 값을 둡니다." });
      next = { asset, ...(colors ? { colors } : {}), ...(fit ? { fit } : {}) };
    }
  }
  const override: InfoOverride = {};
  if (JSON.stringify(next ?? null) !== JSON.stringify(cur ?? null)) override.illust = next ?? null;
  const meta = INFO_TYPE_META[type];
  if (op.variant != null) {
    if (next) flags.push({ kind: "shape", severity: "note", message: "일러스트에는 변형이 없어 변형은 두지 않았습니다." });
    else if (meta.variants.some((v) => v.id === op.variant)) {
      if (op.variant !== block.variant) {
        override.type = type;
        override.variant = op.variant as string;
      }
    } else flags.push({ kind: "shape", severity: "note", message: `${meta.label}에 없는 변형(${String(op.variant).slice(0, 20)})은 뺐습니다.` });
  }
  if (op.colorMode != null) {
    const cm = INFO_COLOR_MODES.find((m) => m.id === op.colorMode)?.id;
    if (next) flags.push({ kind: "color", severity: "note", message: "일러스트 색은 색 모드(illust.colors)로 정합니다 — colorMode 는 뺐습니다." });
    else if (!cm) flags.push({ kind: "color", severity: "note", message: `모르는 색 모드(${String(op.colorMode).slice(0, 20)})는 뺐습니다.` });
    else if (cm !== (block.colorMode ?? "area")) {
      override.type = type;
      override.colorMode = cm;
    }
  }
  if (Object.keys(override).length === 0) return null;
  const titleOf = (id: string) => byId.get(id)?.title ?? "지금 일러스트";
  const before = shapeLines({ illust: cur, type, variant: block.variant, colorMode: block.colorMode }, titleOf);
  const after = shapeLines({ illust: next, type, variant: override.variant ?? block.variant, colorMode: override.colorMode ?? block.colorMode }, titleOf);
  const colorLine = (l: string[]) => l.find((x) => x.startsWith("색:"));
  const recolor = colorLine(before) !== colorLine(after) || (cur?.asset === next?.asset && JSON.stringify(cur?.colors?.map ?? {}) !== JSON.stringify(next?.colors?.map ?? {}));
  return { override, before, after, flags, recolor, ...(next ? { illust: next.asset } : {}) };
}

/** 가장 가까운 조상에 직접 칠한 바탕 토큰 */
function ancestorBackground(tree: CNode, id: string): string | undefined {
  const path = findPath(tree, id) ?? [];
  for (let i = path.length - 2; i >= 0; i--) {
    const t = styleToken(path[i], "background");
    if (t) return t;
  }
  return undefined;
}

/**
 * 색 연산 검사 — 글자 색은 글자 팔레트, 바탕은 면 팔레트 토큰만. 칠한 뒤 글자·바탕 대비가 4.5:1 미만이면
 * 흰 글자·짙은 글자 중 대비가 큰 쪽으로 대체하고(알림), 그래도 모자라면 거부한다. 바탕을 모르면 쪽 바탕(paper)으로 잰다.
 */
export function checkStyle(
  block: TextBlock | ListBlock | AddedBlock,
  op: Record<string, unknown>,
  tree: CNode,
  area?: number
): { style: Record<string, string>; before: string[]; after: string[]; flags: Flag[] } | { error: string } | null {
  const flags: Flag[] = [];
  const want: { color?: string; background?: string } = {};
  for (const key of ["color", "background"] as const) {
    if (op[key] == null) continue;
    const t = tokenName(op[key]);
    const pool = key === "color" ? TEXT_COLORS : FILL_COLORS;
    if (!t || !pool.includes(t)) return { error: `${key === "color" ? "글자" : "바탕"} 색은 디자인 토큰만 씁니다('${String(op[key]).slice(0, 24)}'는 받지 않음).` };
    want[key] = t;
  }
  if (!want.color && !want.background) return { error: "바꿀 색이 없습니다." };
  if (block.kind === "added" && block.element === "shape" && want.color && !want.background) return { error: "도형은 글자가 없어 바탕 색만 바꿉니다." };
  const hex = (t: string) => cssColorHex(`var(--${t})`, area);
  const fgTok = want.color ?? block.color ?? "ink";
  const bgTok = want.background ?? block.background ?? ancestorBackground(tree, block.id) ?? "paper";
  const fg = hex(fgTok);
  const bg = hex(bgTok);
  const hasText = !(block.kind === "added" && block.element === "shape");
  if (hasText && fg && bg) {
    const ratio = contrastRatio(fg, bg);
    if (ratio < MIN_CONTRAST) {
      const alt = (["on-brand", "ink"] as const).map((t) => ({ t, r: hex(t) ? contrastRatio(hex(t)!, bg) : 0 })).sort((a, b) => b.r - a.r)[0];
      if (alt.r < MIN_CONTRAST) return { error: `바탕 '${bgTok}'에서는 대비 4.5:1 을 맞출 글자 색이 없습니다.` };
      flags.push({ kind: "contrast", severity: "note", message: `'${fgTok}' 글자는 바탕 '${bgTok}'에서 대비 ${ratio.toFixed(1)}:1 — ${alt.t === "ink" ? "짙은" : "흰"} 글자로 바꿨습니다.` });
      want.color = alt.t;
    }
  }
  const style: Record<string, string> = {};
  if (want.color && want.color !== block.color) style.color = `var(--${want.color})`;
  if (want.background && want.background !== block.background) style.background = `var(--${want.background})`;
  if (Object.keys(style).length === 0) return null;
  const line = (c?: string, b?: string) => [...(hasText ? [`글자 색: ${c ?? "기본"}`] : []), `바탕: ${b ?? "기본"}`];
  return { style, before: line(block.color, block.background), after: line(want.color ?? block.color, want.background ?? block.background), flags };
}

export interface ValidateInput {
  outline: PageOutline;
  tree: CNode;
  ops: unknown;
  metrics: Record<string, MetricBrief>;
  candidates?: CaseCandidate[];
  /** 인포그래픽 자리별 일러스트 후보(모양 연산 화이트리스트) */
  illusts?: Record<string, ShapeChoice[]>;
  /** 쪽 분야 번호(대비 계산의 --area) */
  area?: number;
  source: "ai" | "rule";
}

/** 연산 순서 — 내용 바꿈을 먼저 보고 모양·색을 그 위에 얹는다 */
const OP_RANK: Record<string, number> = { shape: 1, style: 2 };

/** LLM(또는 규칙) 패치 → 검토할 바꿈 목록. 개요에 없는 자리·읽기 전용 자리·형식이 틀린 연산은 버린다(dropped 에 사유) */
export function validatePatch(input: ValidateInput): { changes: ProposedChange[]; dropped: string[] } {
  const { outline, tree, metrics } = input;
  const byId = new Map(outline.blocks.map((b) => [b.id, b]));
  const ctx: CheckContext = { metrics, carried: numbersIn(outlineTexts(outline)) };
  const changes: ProposedChange[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  const ops = (Array.isArray(input.ops) ? input.ops.slice(0, 40) : [])
    .map((raw, i) => ({ op: (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>, i }))
    .sort((a, b) => (OP_RANK[String(a.op.op)] ?? 0) - (OP_RANK[String(b.op.op)] ?? 0) || a.i - b.i)
    .map((x) => x.op);
  for (const op of ops) {
    const id = typeof op.id === "string" ? op.id : "";
    const block = byId.get(id);
    if (!block) {
      dropped.push(`없는 자리(${id || "id 없음"})`);
      continue;
    }
    // 내용 바꿈은 자리마다 하나, 모양·색은 내용 바꿈과 따로 하나씩
    const slotKey = op.op === "shape" || op.op === "style" ? `${String(op.op)}:${id}` : id;
    if (seen.has(slotKey)) {
      dropped.push(`같은 자리를 두 번 고침(${block.label})`);
      continue;
    }
    if (op.op === "text" && block.kind === "text" && !block.readonly && typeof op.text === "string") {
      const { text, flags } = checkText(op.text, block.maxChars, ctx);
      if (!text || text === block.text) continue;
      seen.add(slotKey);
      changes.push({
        id,
        kind: "text",
        label: block.label,
        before: [readableText(block.text, metrics)],
        after: [readableText(text, metrics)],
        flags,
        edit: textEdit(text, metrics),
        source: input.source,
        raw: [text],
      });
    } else if (op.op === "list" && block.kind === "list" && Array.isArray(op.items)) {
      const flags: Flag[] = [];
      const items = op.items
        .slice(0, block.maxItems)
        .map((t, i) => {
          const r = checkText(String(t ?? ""), block.maxChars, ctx);
          flags.push(...r.flags.map((f) => ({ ...f, message: `${i + 1}번 항목: ${f.message}` })));
          return r.text;
        })
        .filter(Boolean);
      if (op.items.length > block.maxItems) flags.push({ kind: "trimmed", severity: "note", message: `항목을 ${block.maxItems}개까지만 남겼습니다.` });
      if (items.length === 0 || JSON.stringify(items) === JSON.stringify(block.items)) continue;
      seen.add(slotKey);
      changes.push({
        id,
        kind: "list",
        label: block.label,
        before: block.items.map((t) => readableText(t, metrics)),
        after: items.map((t) => readableText(t, metrics)),
        flags,
        edit: listEdit(items, tree, id, metrics),
        source: input.source,
        raw: items,
      });
    } else if (op.op === "info" && block.kind === "info") {
      if (block.added) {
        dropped.push(`${block.label}: 추가한 일러스트의 글은 캔버스에서 고칩니다.`);
        continue;
      }
      const r = checkInfo(block, op as Extract<PatchOp, { op: "info" }>, ctx);
      if ("error" in r) {
        dropped.push(`${block.label}: ${r.error}`);
        continue;
      }
      if (r.type === block.type && r.variant === block.variant && JSON.stringify(r.content) === JSON.stringify(block.content)) continue;
      seen.add(slotKey);
      const flags = [...r.flags];
      // 일러스트는 그림의 항목 수가 고정 — 항목 수가 바뀌면 기본 도식으로 그린다(같은 수 일러스트는 모양 연산으로 다시 고른다)
      const dropIllust = Boolean(block.illust) && r.content.items.length !== block.content.items.length;
      if (dropIllust) flags.push({ kind: "shape", severity: "note", message: "항목 수가 바뀌어 일러스트 대신 기본 도식으로 그립니다." });
      const edit = sanitizeNodeEdit({ info: { type: r.type, ...(r.variant ? { variant: r.variant } : {}), content: r.content, ...(dropIllust ? { illust: null } : {}) } }) ?? {};
      changes.push({
        id,
        kind: "info",
        label: block.label,
        before: infoLines(block.content, block.type, metrics),
        after: infoLines(r.content, r.type, metrics),
        flags,
        edit,
        source: input.source,
        content: r.content,
        infoType: r.type,
        ...(block.illust && !dropIllust ? { illust: block.illust.asset } : {}),
      });
    } else if (op.op === "shape" && block.kind === "info") {
      const prior = changes.find((c) => c.id === id && c.kind === "info");
      const base = { content: prior?.content ?? block.content, type: prior?.infoType ?? block.type };
      const cur = prior?.edit?.info?.illust === null ? undefined : block.illust;
      const r = checkShape(block, op, input.illusts?.[id] ?? [], base, cur);
      const extra = extraKeys(op, SHAPE_KEYS);
      if (extra.length) dropped.push(`${block.label}: 모양 연산의 받지 않는 값(${extra.join(", ")})은 버렸습니다 — 좌표·크기·색 값은 쓰지 않습니다.`);
      if (r && "error" in r) {
        dropped.push(`${block.label}: ${r.error}`);
        continue;
      }
      if (!r) continue;
      seen.add(slotKey);
      if (prior) {
        prior.edit = sanitizeNodeEdit({ info: { ...prior.edit?.info, ...r.override } }) ?? prior.edit;
        prior.before = [...prior.before, ...r.before];
        prior.after = [...prior.after, ...r.after];
        prior.flags = [...prior.flags, ...r.flags];
        if (r.illust) prior.illust = r.illust;
        else delete prior.illust;
        if (r.recolor) prior.recolor = true;
      } else {
        changes.push({
          id,
          kind: "shape",
          label: block.label,
          before: r.before,
          after: r.after,
          flags: r.flags,
          edit: sanitizeNodeEdit({ info: r.override }) ?? {},
          source: input.source,
          content: block.content,
          infoType: block.type,
          ...(r.illust ? { illust: r.illust } : {}),
          ...(r.recolor ? { recolor: true } : {}),
        });
      }
    } else if (op.op === "style" && (block.kind === "text" || block.kind === "list" || block.kind === "added")) {
      const r = checkStyle(block, op, tree, input.area);
      const extra = extraKeys(op, STYLE_KEYS);
      if (extra.length) dropped.push(`${block.label}: 색 연산의 받지 않는 값(${extra.join(", ")})은 버렸습니다 — 색 토큰만 씁니다.`);
      if (r && "error" in r) {
        dropped.push(`${block.label}: ${r.error}`);
        continue;
      }
      if (!r) continue;
      seen.add(slotKey);
      changes.push({ id: `${id}~style`, kind: "style", label: block.label, before: r.before, after: r.after, flags: r.flags, style: r.style, source: input.source, recolor: true });
    } else if (op.op === "cases" && block.kind === "cases" && Array.isArray(op.ids)) {
      const pool = new Map((input.candidates ?? []).map((c) => [c.id, c]));
      const ids = [...new Set(op.ids.map(String))].filter((x) => pool.has(x)).slice(0, 4);
      const unknown = op.ids.length - ids.length;
      const flags: Flag[] = unknown > 0 ? [{ kind: "case", severity: "note", message: `후보에 없는 실적 ${unknown}건은 뺐습니다.` }] : [];
      if (ids.length === 0) {
        dropped.push(`${block.label}: 후보 목록의 실적을 고르지 않았습니다.`);
        continue;
      }
      const chosen = ids.map((x) => pool.get(x)!).sort((a, b) => a.year.localeCompare(b.year));
      seen.add(slotKey);
      changes.push({
        id,
        kind: "cases",
        label: block.label,
        before: block.items.map((c) => `${c.year} ${c.title}`),
        after: chosen.map((c) => `${c.year} ${c.title}`),
        flags: [...flags, { kind: "case", severity: "note", message: "채택하면 실적 노출 관리의 '대표 실적' 지정이 바뀝니다(이 분야의 다른 쪽에도 반영)." }],
        featured: chosen.map((c) => c.id),
        source: input.source,
      });
    } else {
      dropped.push(`${block.label}: 이 자리에 맞지 않는 연산(${String(op.op)})`);
    }
  }
  return { changes, dropped };
}

/** 바꿈이 고치는 노드 id(색 바꿈은 검토 목록에서 내용 바꿈과 따로 고르도록 id 뒤에 ~style 을 붙인다) */
export function changeNodeId(c: ProposedChange): string {
  return c.kind === "style" ? c.id.replace(/~style$/, "") : c.id;
}

/**
 * 고른 바꿈을 편집층에 얹는다(대표 실적은 편집층 밖 — 따로 반영).
 * 인포그래픽 내용·모양은 setInfo(추가한 일러스트도), 색은 patchNodeStyle(고정한 글 안쪽·추가 요소도 — derived = 지금 그린 파생 트리)로.
 */
export function applyChanges(edits: PageEdits, changes: ProposedChange[], derived?: CNode): PageEdits {
  let next: PageEdits = JSON.parse(JSON.stringify(edits ?? { v: 1 }));
  for (const c of changes) {
    const id = changeNodeId(c);
    if (c.style) {
      if (derived) next = patchNodeStyle(next, derived, id, c.style);
      else {
        next.nodes ??= {};
        const prev = next.nodes[id] ?? {};
        next.nodes[id] = { ...prev, style: { ...(prev.style ?? {}), ...c.style } };
      }
      continue;
    }
    if (!c.edit) continue;
    if (c.edit.content) {
      next.nodes ??= {};
      next.nodes[id] = { ...(next.nodes[id] ?? {}), content: c.edit.content };
    }
    if (c.edit.info) next = setInfo(next, id, { ...(next.nodes?.[id]?.info ?? {}), ...c.edit.info });
  }
  return next;
}

/** 바꿈의 글을 줄인 것으로 갈아 끼운다(넘침 자동 축약) */
export function replaceChangeText(c: ProposedChange, texts: string[], tree: CNode, metrics: Record<string, MetricBrief>): ProposedChange {
  if (c.kind === "text" && texts[0]) return { ...c, after: [readableText(texts[0], metrics)], edit: textEdit(texts[0], metrics), raw: [texts[0]] };
  if (c.kind === "list" && texts.length) return { ...c, after: texts.map((t) => readableText(t, metrics)), edit: listEdit(texts, tree, c.id, metrics), raw: texts };
  return c;
}

/** 지표 목록(LLM 컨텍스트·검토 화면용) */
export function metricBriefs(metrics: Record<string, { id: string; label: string; value: number | null; unit: string; footnote: string } | undefined>): Record<string, MetricBrief> {
  const out: Record<string, MetricBrief> = {};
  for (const [id, m] of Object.entries(metrics)) if (m) out[id] = { id, label: m.label, value: m.value, unit: m.unit, footnote: m.footnote };
  return out;
}
