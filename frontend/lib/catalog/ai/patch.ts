/*
 * 회사소개서 LLM 편집(P6) 공용 핵심 — 쪽 개요(LLM 에 주는 고칠 수 있는 자리), JSON 패치 검증, 편집층 조각 만들기. 클라이언트 안전.
 * 블루프린트 §7-2: LLM 은 스키마에 맞는 JSON 패치만 돌려준다(디자인·좌표는 건드리지 않음 — recruit applyMapping 원칙).
 *   숫자는 {{metric:지표 id}} 로만 쓰고, 지표 목록에 없는 숫자는 '검토' 표시를 붙인다. 근거 없는 최상급·이모지도 검토 표시.
 *   채택은 자리(노드 id)마다 고를 수 있다(부분 채택) — 결과는 보통 편집과 같은 편집층(PageEdits.nodes[id])에 들어간다.
 */
import { fmt } from "@/lib/catalog/render/components/parts";
import { matchInfographic } from "@/lib/catalog/render/infographic/match";
import {
  INFO_TYPE_META,
  isInfoType,
  sanitizeInfoContent,
  type InfoBox,
  type InfoContent,
  type InfoItem,
  type InfoType,
} from "@/lib/catalog/render/infographic/types";
import type { InfoSlotProps } from "@/lib/catalog/render/infographic/slot";
import { sanitizeNodeEdit, type NodeEdit, type PageEdits } from "@/lib/catalog/studio/edits";
import { isInlineBlock, newUserId, type CNode } from "@/lib/catalog/studio/nodes";

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
  /** 맥락으로만(숫자 칸·아이콘·링크가 섞인 글 등) — 고칠 수 없음 */
  readonly?: boolean;
}

export interface ListBlock {
  kind: "list";
  id: string;
  items: string[];
  maxItems: number;
  maxChars: number;
  label: string;
  focus?: boolean;
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

export type OutlineBlock = TextBlock | ListBlock | InfoBlock | CasesBlock;

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
  [/\bkc-(caption|ig__desc)\b/, "caption"],
];
const FIGURE_CLASS = /\bkc-(kpi__figure|stat__fig|ig__fig|kpi__unit)\b/;
const SKIP_CLASS = /\b(kc-head|kc-footnote|kc-notes|pk-outline|kc-draftmark|kc-drop)\b/;

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

/**
 * 파생 트리(편집층 적용 후) → 쪽 개요. 숨긴 요소·쪽 머리·각주·데이터 위젯 안은 빼고, 인포그래픽과 분야 대표 실적은 따로 둔다.
 * focusId 를 주면 그 요소(와 안쪽)를 focus 로 표시한다(사용자가 고른 블록).
 */
export function buildOutline(tree: CNode, item: { key: string; type: string; label: string }, opts: { focusId?: string | null; casesEditable?: boolean } = {}): PageOutline {
  const blocks: OutlineBlock[] = [];
  let lastHeading = "";
  const walk = (n: CNode, focus: boolean) => {
    if (n.hiddenByEdit || n.tag === "#text") return;
    if (n.origin === "add") return; // 추가한 글상자는 사람이 직접 고친다
    const cls = n.className ?? "";
    if (SKIP_CLASS.test(cls) || n.attrs?.["aria-hidden"] === "true") return;
    const here = focus || (opts.focusId != null && n.id === opts.focusId);
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

export type FlagKind = "number" | "superlative" | "emoji" | "length" | "items" | "type" | "metric" | "case" | "trimmed";

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
    else out.push(...b.items.map((c) => `${c.year} ${c.title}`));
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
  | { op: "cases"; id: string; ids: string[] };

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
  kind: "text" | "list" | "info" | "cases";
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

function infoLines(c: InfoContent, type: InfoType, metrics: Record<string, MetricBrief>): string[] {
  const lines = [`유형: ${INFO_TYPE_META[type]?.label ?? type}`];
  if (c.title) lines.push(`제목: ${c.title}`);
  if (c.center) lines.push(`중심: ${c.center.label}`);
  c.items.forEach((it, i) => {
    const v = it.metric ? ` = ${metricText(metrics[it.metric])}${metrics[it.metric]?.unit ?? ""}` : "";
    lines.push(`${i + 1}. ${it.label}${it.desc ? ` — ${it.desc}` : ""}${it.when ? ` (${it.when})` : ""}${v}`);
  });
  return lines;
}

export interface ValidateInput {
  outline: PageOutline;
  tree: CNode;
  ops: unknown;
  metrics: Record<string, MetricBrief>;
  candidates?: CaseCandidate[];
  source: "ai" | "rule";
}

/** LLM(또는 규칙) 패치 → 검토할 바꿈 목록. 개요에 없는 자리·읽기 전용 자리·형식이 틀린 연산은 버린다(dropped 에 사유) */
export function validatePatch(input: ValidateInput): { changes: ProposedChange[]; dropped: string[] } {
  const { outline, tree, metrics } = input;
  const byId = new Map(outline.blocks.map((b) => [b.id, b]));
  const ctx: CheckContext = { metrics, carried: numbersIn(outlineTexts(outline)) };
  const changes: ProposedChange[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  const ops = Array.isArray(input.ops) ? input.ops.slice(0, 40) : [];
  for (const raw of ops) {
    const op = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const id = typeof op.id === "string" ? op.id : "";
    const block = byId.get(id);
    if (!block) {
      dropped.push(`없는 자리(${id || "id 없음"})`);
      continue;
    }
    if (seen.has(id)) {
      dropped.push(`같은 자리를 두 번 고침(${block.label})`);
      continue;
    }
    if (op.op === "text" && block.kind === "text" && !block.readonly && typeof op.text === "string") {
      const { text, flags } = checkText(op.text, block.maxChars, ctx);
      if (!text || text === block.text) continue;
      seen.add(id);
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
      seen.add(id);
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
      const r = checkInfo(block, op as Extract<PatchOp, { op: "info" }>, ctx);
      if ("error" in r) {
        dropped.push(`${block.label}: ${r.error}`);
        continue;
      }
      if (r.type === block.type && r.variant === block.variant && JSON.stringify(r.content) === JSON.stringify(block.content)) continue;
      seen.add(id);
      const edit = sanitizeNodeEdit({ info: { type: r.type, ...(r.variant ? { variant: r.variant } : {}), content: r.content } }) ?? {};
      changes.push({
        id,
        kind: "info",
        label: block.label,
        before: infoLines(block.content, block.type, metrics),
        after: infoLines(r.content, r.type, metrics),
        flags: r.flags,
        edit,
        source: input.source,
      });
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
      seen.add(id);
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

/** 고른 바꿈을 편집층에 얹는다(대표 실적은 편집층 밖 — 따로 반영) */
export function applyChanges(edits: PageEdits, changes: ProposedChange[]): PageEdits {
  const next: PageEdits = JSON.parse(JSON.stringify(edits ?? { v: 1 }));
  for (const c of changes) {
    if (!c.edit) continue;
    next.nodes ??= {};
    const prev = next.nodes[c.id] ?? {};
    const merged: NodeEdit = { ...prev };
    if (c.edit.content) merged.content = c.edit.content;
    if (c.edit.info) merged.info = c.edit.info;
    next.nodes[c.id] = merged;
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
