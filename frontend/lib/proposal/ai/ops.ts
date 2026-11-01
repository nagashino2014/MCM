// 제안서 AI 수정(P1) 공용 핵심 — LLM 이 돌려준 JSON op 를 범위·허용 경로·읽기 전용 칸으로 거르고, 검사 표시를 붙이고,
// 채택할 때 문서에 적용한다. 서버(제안 검증)와 화면(채택·원문 대조)이 같은 함수를 쓴다. 계획: docs/proposal-ai-editing-plan.md §3.
// 원칙: LLM 은 글만 고친다 — 모양·크기·색·수치 칸은 손대지 않고, [작성 필요] 칸·성명 표·'적용 예시' 쪽은 읽기 전용이다.
import type { BulletItem, CardItem, ProposalBlock, ProposalBlockKind, ProposalDocument, ProposalSection } from "../types";
import { BLOCK_LABEL, findBlock, getDeep, newId, stripMark, updateSection } from "../edit";
import { blockTextPaths, fieldLabel, setField } from "../find";
import { blockHash } from "../hash";
import { validateBlock } from "../validate";
import { findSuperlatives, looseNumbers, numbersIn } from "@/lib/catalog/ai/patch";

export type AiScope = "block" | "page";
/** 지시 칩 — 규칙 대체안을 고를 때도 쓴다 */
export type AiAction = "polish" | "bullets" | "shorten" | "expand" | "client" | "free";

export const AI_ACTIONS: Array<{ id: Exclude<AiAction, "free">; label: string; instruction: string }> = [
  { id: "polish", label: "다듬기", instruction: "뜻과 사실은 그대로 두고 문장을 더 간결하고 읽기 쉽게 다듬어 주세요." },
  { id: "bullets", label: "개조식으로", instruction: "서술 문장을 원본 제안서 문체의 개조식(○ 1단 · - 2단)으로 바꿔 주세요." },
  { id: "shorten", label: "줄이기", instruction: "핵심만 남기고 분량을 지금의 70~80% 로 줄여 주세요." },
  { id: "expand", label: "늘리기", instruction: "지면을 넘지 않는 범위에서 수행 방법과 확인 근거를 보강해 주세요. 모르는 사실은 [작성 필요]로 남겨 주세요." },
  { id: "client", label: "발주처 맞춤", instruction: "발주처 메모와 사업장 정보를 반영해 이 발주처에 맞는 표현으로 고쳐 주세요." },
];

/** AI 가 새로 만들거나 바꿔 넣을 수 있는 블록(글로 이루어진 것만) */
export const AI_CREATABLE: ProposalBlockKind[] = ["heading", "text", "bullets", "lead", "callout", "stage", "cards", "steps", "table"];
const PENDING = "[작성 필요]";

// ── op 형식 ──────────────────────────────────────────────────────────────────
export type AiOp =
  | { op: "set"; block: string; path: string; value: string }
  | { op: "items"; block: string; items: Array<Partial<BulletItem & CardItem>> }
  | { op: "table"; block: string; columns?: string[]; rows: string[][] }
  | { op: "replace"; block: string; with: Record<string, unknown> }
  | { op: "insert"; section: string; after: string | null; block: Record<string, unknown> }
  | { op: "remove"; block: string }
  | { op: "page"; section: string; title?: string; summary?: string };

export type FlagKind = "number" | "superlative" | "emoji" | "mark" | "link" | "client" | "longer" | "pending";
export interface AiFlag { kind: FlagKind; severity: "review" | "note"; message: string }

/** 검증을 통과한 op — 채택 때 원문 대조에 쓰는 base 와 화면에 보일 전·후를 함께 갖는다 */
export interface CheckedOp {
  key: string;
  op: "set" | "replace" | "insert" | "remove" | "page";
  section: string;
  /** set·page: 칸 경로, 나머지: 블록 */
  block: string;
  path?: string;
  value?: string;
  title?: string;
  summary?: string;
  /** replace·insert 로 넣을 블록(검증·새 id 완료) */
  next?: ProposalBlock;
  after?: string | null;
  /** 원문 대조 — set·page 는 이전 글, replace·remove 는 블록 지문 */
  base: string | Record<string, string | undefined>;
  label: string;
  before: string[];
  afterLines: string[];
  flags: AiFlag[];
}

export interface ScopeInfo {
  scope: AiScope;
  section: ProposalSection;
  /** 블록 범위의 대상 블록 */
  blockId?: string;
}

// ── 읽기 전용 판정 ───────────────────────────────────────────────────────────
/** '제안 적용 예시' 쪽 — 실적처럼 보이게 고치면 안 된다 */
export const isExamplePage = (s: Pick<ProposalSection, "title" | "crumb">) => /예시/.test(`${s.crumb ?? ""} ${s.title ?? ""}`);
/** 사람 이름 칸이 있는 표(참여인력) */
const isPeopleTable = (b: ProposalBlock) => b.kind === "table" && b.columns.some((c) => /성명|이름|담당자/.test(c));
const textOf = (b: ProposalBlock, path: string) => { const v = getDeep(b, path.split(".")); return typeof v === "string" ? v : ""; };
/** 블록에 [작성 필요] 칸이 있는가 — 있으면 목록·표 통째 바꾸기를 막는다(칸을 지울 수 있으므로) */
const hasPending = (b: ProposalBlock) => blockTextPaths(b).some((p) => textOf(b, p).includes(PENDING));
export const isReadonlyBlock = (s: ProposalSection, b: ProposalBlock) => isExamplePage(s) || isPeopleTable(b);

/** AI 에게 막는 글 칸 — 수치·축·기간은 사람이 정한다 */
function aiBlockedPath(b: ProposalBlock, path: string): boolean {
  if (b.kind === "kpis" && /^items\.\d+\.(value|unit)$/.test(path)) return true;
  if (b.kind === "gantt" && /^periods\.\d+$/.test(path)) return true;
  if (b.kind === "diagram" && /^spec\.(legend|axes)\.\d+$/.test(path)) return true;
  return false;
}

/** 블록에서 AI 가 고칠 수 있는 글 칸 */
export function editablePaths(s: ProposalSection, b: ProposalBlock): string[] {
  if (isReadonlyBlock(s, b)) return [];
  return blockTextPaths(b).filter((p) => !aiBlockedPath(b, p) && !textOf(b, p).includes(PENDING));
}

// ── 글 정리·검사 ─────────────────────────────────────────────────────────────
const clean = (v: unknown, max: number, oneLine: boolean): string => {
  let t = String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\r/g, "");
  t = oneLine ? t.replace(/\s*\n\s*/g, " ") : t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return t.replace(/[ \t]{2,}/g, " ").trim().slice(0, max);
};
const ONE_LINE = /^(title|label|columns\.\d+|periods\.\d+|tasks\.\d+\.(group|label)|items\.\d+\.(title|value|unit|label)|spec\.(content\.)?(center\.label|items\.\d+\.label)|spec\.(legend|axes)\.\d+)$/;
const EMOJI = /\p{Extended_Pictographic}/u;
const LINK_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
/** 제안서에서 흔한 번호 문형 — 숫자 검사에서 뺀다(단계·항 번호·조항·쪽 참조·월차·규격) */
const NUMBER_PHRASES = /\d+\s*(단계|차|장|절|조|항|호|번째)|제\s*\d+\s*(조|항|호|장)|\b[GWIE]\d{2}\b|\bM\d+\b|ISO\s*\d+|Scope\s*\d/g;

export interface CheckContext {
  /** 원문·원장·변수·지시문에 있던 숫자(검사 예외) */
  carried: Set<string>;
  /** 연결 표기 이름 */
  linkNames: Set<string>;
  /** 발주처 이름(글자로 쓰면 {{client}} 로 바꾸자고 표시) */
  client: string;
  action: AiAction;
}

export function checkText(before: string, after: string, ctx: CheckContext): AiFlag[] {
  const flags: AiFlag[] = [];
  const nums = looseNumbers(after.replace(NUMBER_PHRASES, " ").replace(LINK_RE, " "), ctx.carried);
  if (nums.length) flags.push({ kind: "number", severity: "review", message: `근거를 확인할 숫자: ${nums.slice(0, 4).join(", ")}` });
  const sup = findSuperlatives(after).filter((x) => !findSuperlatives(before).includes(x));
  if (sup.length) flags.push({ kind: "superlative", severity: "review", message: `근거 없는 과장 표현(${sup.join(", ")})` });
  if (EMOJI.test(after)) flags.push({ kind: "emoji", severity: "review", message: "이모지는 쓰지 않습니다." });
  if ((after.match(/\*\*/g)?.length ?? 0) % 2) flags.push({ kind: "mark", severity: "review", message: "굵게 표식(**)의 짝이 맞지 않습니다." });
  const names = (t: string) => [...t.matchAll(LINK_RE)].map((m) => m[1]);
  // 문법이 틀린 표기({{없는값}} 등)도 발행을 막으므로 함께 잡는다.
  const tokens = [...after.matchAll(/\{\{([^{}]*)\}\}/g)].map((m) => m[1].trim());
  const unknown = tokens.filter((n) => !ctx.linkNames.has(n));
  const lost = names(before).filter((n) => !names(after).includes(n));
  if (unknown.length) flags.push({ kind: "link", severity: "review", message: `없는 연결 표기: ${[...new Set(unknown)].join(", ")}` });
  else if (lost.length) flags.push({ kind: "link", severity: "note", message: `연결 표기가 빠졌습니다: ${[...new Set(lost)].join(", ")}` });
  if (ctx.client.trim().length >= 2 && after.includes(ctx.client.trim()) && !before.includes(ctx.client.trim())) flags.push({ kind: "client", severity: "note", message: "발주처 이름을 글자로 썼습니다 — {{client}} 표기를 쓰면 발주처가 바뀌어도 따라갑니다." });
  if (after.split(PENDING).length > before.split(PENDING).length) flags.push({ kind: "pending", severity: "note", message: "채울 칸([작성 필요])이 생겼습니다." });
  const len = (t: string) => t.replace(/\s/g, "").length;
  if (ctx.action === "shorten" ? len(after) > len(before) : len(after) > len(before) * 1.6 + 20) flags.push({ kind: "longer", severity: "note", message: "글이 길어졌습니다 — 쪽 넘침을 확인하세요." });
  return flags;
}

export function carriedNumbers(texts: string[]): Set<string> { return numbersIn(texts); }

// ── 블록 → 사람이 읽는 줄(검토 화면) ─────────────────────────────────────────
const BULLET_MARK: Record<string, string> = { 1: "○", 2: "-", 3: "·", note: "※", result: "⇒", check: "✓" };
export function blockLines(b: ProposalBlock): string[] {
  switch (b.kind) {
    case "heading": case "text": return b.text.split("\n").filter(Boolean);
    case "bullets": return b.items.map((it) => `${"  ".repeat(it.level - 1)}${BULLET_MARK[it.mark ?? it.level]} ${it.text}`);
    case "lead": return [`${b.label ? `[${b.label}] ` : ""}${b.text}`];
    case "callout": return [b.title, ...b.text.split("\n").filter(Boolean)];
    case "stage": return [`${b.label} | ${b.text}`];
    case "cards": case "steps": return b.items.map((it, i) => `${String(i + 1).padStart(2, "0")} ${it.title}${it.body ? ` — ${it.body.replace(/\n/g, " / ")}` : ""}`);
    case "kpis": return b.items.map((it) => `${it.value}${it.unit ?? ""} ${it.label}`);
    case "table": return [...(b.title ? [b.title] : []), b.columns.join(" | "), ...b.rows.map((r) => r.join(" | "))];
    case "gantt": return [b.title, ...b.tasks.map((t) => `${t.group ? `${t.group} · ` : ""}${t.label}`)];
    default: return [("title" in b && b.title) || BLOCK_LABEL[b.kind]];
  }
}

// ── 검증 ─────────────────────────────────────────────────────────────────────
export interface ValidateInput {
  doc: ProposalDocument;
  scope: ScopeInfo;
  ops: unknown;
  ctx: CheckContext;
}

/** LLM op 를 검증해 채택할 수 있는 op 목록으로. 버린 것은 사유와 함께. */
export function validateOps({ doc, scope, ops, ctx }: ValidateInput): { ops: CheckedOp[]; dropped: string[] } {
  const out: CheckedOp[] = [];
  const dropped: string[] = [];
  const s = scope.section;
  const inScope = (bid: string) => (scope.scope === "block" ? bid === scope.blockId : s.blocks.some((b) => b.id === bid));
  const blockOf = (bid: string) => s.blocks.find((b) => b.id === bid);
  const touched = new Set<string>();
  const list = Array.isArray(ops) ? ops.slice(0, 60) : [];
  list.forEach((raw, i) => {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const kind = String(o.op ?? "");
    const bid = typeof o.block === "string" ? o.block : "";
    const drop = (why: string) => dropped.push(`${i + 1}번 제안(${kind || "형식 없음"}): ${why}`);
    const key = `op${i}`;
    try {
      if (kind === "page") {
        if (scope.scope !== "page" || o.section !== s.id) return drop("이 쪽 범위가 아닙니다.");
        if (isExamplePage(s)) return drop("적용 예시 쪽은 고치지 않습니다.");
        const title = o.title === undefined ? undefined : clean(o.title, 200, true);
        const summary = o.summary === undefined ? undefined : clean(o.summary, 600, false);
        if (title === undefined && summary === undefined) return drop("바꿀 내용이 없습니다.");
        if (title !== undefined && (s.title.includes(PENDING) || !title)) return drop("쪽 제목을 비우거나 작성 필요 칸을 바꿀 수 없습니다.");
        if (summary !== undefined && (s.summary ?? "").includes(PENDING)) return drop("작성 필요 칸은 사람이 채웁니다.");
        const before = [title !== undefined ? s.title : null, summary !== undefined ? s.summary ?? "" : null].filter((x): x is string => x !== null);
        const after = [title, summary].filter((x): x is string => x !== undefined);
        if (before.join("\n") === after.join("\n")) return;
        out.push({ key, op: "page", section: s.id, block: "_page", title, summary, base: { title: title !== undefined ? s.title : undefined, summary: summary !== undefined ? s.summary ?? "" : undefined },
          label: `${s.pageId ?? ""} · 쪽 제목·요약`, before, afterLines: after, flags: after.flatMap((t, k) => checkText(before[k] ?? "", t, ctx)) });
        return;
      }
      if (kind === "insert") {
        if (scope.scope !== "page" || o.section !== s.id) return drop("새 블록은 쪽 단위 수정에서만 넣습니다.");
        if (isExamplePage(s)) return drop("적용 예시 쪽은 고치지 않습니다.");
        const after = o.after === null || o.after === undefined ? null : String(o.after);
        if (after !== null && !blockOf(after)) return drop("넣을 자리를 찾지 못했습니다.");
        const next = newBlock(o.block);
        if (!next) return drop("만들 수 없는 블록 종류입니다.");
        const lines = blockLines(next);
        out.push({ key, op: "insert", section: s.id, block: next.id, next, after, base: after ?? "", label: `${s.pageId ?? ""} · 새 ${BLOCK_LABEL[next.kind]}`, before: [], afterLines: lines, flags: checkText("", lines.join("\n"), ctx) });
        return;
      }
      const b = blockOf(bid);
      if (!b || !inScope(bid)) return drop("고를 수 있는 범위 밖의 블록입니다.");
      if (isReadonlyBlock(s, b)) return drop("적용 예시 쪽·성명 표는 고치지 않습니다.");
      // 한 블록에는 칸 고치기 여러 개 또는 통째 바꾸기 하나만 — 섞이면 채택 때 서로를 무효로 만든다.
      const busy = kind === "set" ? touched.has(bid) : [...touched].some((k) => k === bid || k.startsWith(`${bid}|`));
      if (busy) return drop("같은 블록에 겹친 제안입니다.");
      if (kind === "set") {
        const path = String(o.path ?? "");
        if (!editablePaths(s, b).includes(path)) return drop(`고칠 수 없는 칸입니다(${path}).`);
        const before = textOf(b, path);
        const value = clean(o.value, 40000, ONE_LINE.test(path));
        if (!value && before) return drop("칸을 비우는 제안은 받지 않습니다.");
        if (value === before) return;
        const trial = setField({ ...doc, sections: [{ ...s, blocks: [b] }] }, { sid: s.id, bid, path }, value).sections[0].blocks[0];
        validateBlock(trial);
        touched.add(`${bid}|${path}`);
        out.push({ key, op: "set", section: s.id, block: bid, path, value, base: before, label: fieldLabel(doc, { sid: s.id, bid, path }), before: [before], afterLines: [value], flags: checkText(before, value, ctx) });
        return;
      }
      if (kind === "remove") {
        if (scope.scope !== "page") return drop("블록 지우기는 쪽 단위 수정에서만 합니다.");
        if (!AI_CREATABLE.includes(b.kind) || hasPending(b)) return drop("도식·그림·수치·작성 필요 칸이 있는 블록은 지우지 않습니다.");
        touched.add(bid);
        out.push({ key, op: "remove", section: s.id, block: bid, base: blockHash(b), label: `${s.pageId ?? ""} · ${BLOCK_LABEL[b.kind]} 지우기`, before: blockLines(b), afterLines: [], flags: [] });
        return;
      }
      // items·table·replace → 같은 자리의 새 블록으로 바꾼다
      if (!AI_CREATABLE.includes(b.kind) || hasPending(b)) return drop("이 블록은 칸 단위로만 고칩니다(도식·수치·작성 필요 칸).");
      let raw2: Record<string, unknown> | null = null;
      if (kind === "items") {
        if (b.kind !== "bullets" && b.kind !== "cards" && b.kind !== "steps") return drop("목록이 아닌 블록입니다.");
        raw2 = { ...b, items: o.items };
      } else if (kind === "table") {
        if (b.kind !== "table") return drop("표가 아닌 블록입니다.");
        const columns = Array.isArray(o.columns) ? o.columns : b.columns;
        raw2 = { ...b, columns, rows: o.rows, ...(Array.isArray(o.columns) && o.columns.length !== b.columns.length ? { widths: undefined } : {}) };
      } else if (kind === "replace") {
        raw2 = o.with && typeof o.with === "object" ? (o.with as Record<string, unknown>) : null;
      } else return drop("알 수 없는 제안 형식입니다.");
      const next = newBlock(raw2, bid);
      if (!next) return drop("만들 수 없는 블록 종류이거나 형식이 맞지 않습니다.");
      const before = blockLines(b), afterLines = blockLines(next);
      if (before.join("\n") === afterLines.join("\n") && next.kind === b.kind) return;
      touched.add(bid);
      out.push({ key, op: "replace", section: s.id, block: bid, next, base: blockHash(b),
        label: `${s.pageId ?? ""} · ${BLOCK_LABEL[b.kind]}${next.kind !== b.kind ? ` → ${BLOCK_LABEL[next.kind]}` : ""}`, before, afterLines, flags: checkText(before.join("\n"), afterLines.join("\n"), ctx) });
    } catch (e) {
      drop(e instanceof Error ? e.message : "형식이 맞지 않습니다.");
    }
  });
  return { ops: out, dropped };
}

/** LLM 이 준 블록을 정리·검사한다 — 글 블록만, 글머리 기호는 level/mark 로, id 는 새로(바꾸기면 원래 id) */
function newBlock(raw: unknown, keepId?: string): ProposalBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const r = { ...(raw as Record<string, unknown>) };
  const kind = String(r.kind ?? "") as ProposalBlockKind;
  if (!AI_CREATABLE.includes(kind)) return null;
  r.id = keepId ?? newId();
  if (kind === "bullets" && Array.isArray(r.items)) {
    r.items = r.items.slice(0, 40).map((x) => {
      const it = (x && typeof x === "object" ? x : { text: x }) as Record<string, unknown>;
      const level = [1, 2, 3].includes(Number(it.level)) ? Number(it.level) : 1;
      const mark = ["note", "result", "check"].includes(String(it.mark)) ? it.mark : undefined;
      return { level, text: clean(stripMark(String(it.text ?? "")), 2000, false), ...(mark ? { mark } : {}) };
    }).filter((it) => it.text);
  }
  if ((kind === "cards" || kind === "steps") && Array.isArray(r.items)) {
    r.items = r.items.slice(0, kind === "steps" ? 6 : 12).map((x) => {
      const it = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return { title: clean(it.title, 200, true), body: clean(it.body, 2000, false), ...(it.key === true ? { key: true } : {}), ...(typeof it.color === "string" ? { color: it.color } : {}) };
    });
    if (kind === "cards") { r.columns = [2, 3, 4].includes(Number(r.columns)) ? Number(r.columns) : Math.min(4, Math.max(2, (r.items as unknown[]).length)); r.numbered = r.numbered !== false; }
  }
  if (kind === "table") {
    const columns = Array.isArray(r.columns) ? r.columns.slice(0, 12).map((c) => clean(c, 200, true)) : [];
    r.columns = columns;
    r.rows = Array.isArray(r.rows) ? r.rows.slice(0, 80).map((row) => columns.map((_, ci) => clean(Array.isArray(row) ? row[ci] : "", 4000, false))) : [];
    r.title = clean(r.title ?? "", 200, true);
    r.style = ["grid", "clean", "form"].includes(String(r.style)) ? r.style : "grid";
    if (Array.isArray(r.widths) && r.widths.length !== columns.length) delete r.widths;
  }
  for (const k of ["text", "title", "label"]) if (typeof r[k] === "string") r[k] = clean(r[k], k === "text" ? 40000 : 200, k !== "text");
  if (kind === "heading") r.level = [1, 2, 3].includes(Number(r.level)) ? Number(r.level) : 3;
  if (kind === "callout") { r.variant = r.variant === "point" ? "point" : "note"; r.title = r.title || (r.variant === "point" ? "POINT" : "참고"); }
  try { return validateBlock(r); } catch { return null; }
}

// ── 적용(채택) ───────────────────────────────────────────────────────────────
/** 고른 op 를 문서에 적용한다. 그사이 바뀐 칸·블록(base 불일치)은 적용하지 않고 stale 로 돌려준다. */
export function applyOps(doc: ProposalDocument, ops: CheckedOp[]): { doc: ProposalDocument; applied: CheckedOp[]; stale: CheckedOp[] } {
  let next = doc;
  const applied: CheckedOp[] = [], stale: CheckedOp[] = [];
  // 지우기·바꾸기·칸 고치기를 먼저, 넣기는 마지막에(넣을 자리가 그대로 있도록)
  const order = [...ops].sort((a, b) => Number(a.op === "insert") - Number(b.op === "insert"));
  for (const o of order) {
    const sec = next.sections.find((x) => x.id === o.section);
    if (!sec) { stale.push(o); continue; }
    if (o.op === "page") {
      const base = o.base as Record<string, string | undefined>;
      if ((base.title !== undefined && sec.title !== base.title) || (base.summary !== undefined && (sec.summary ?? "") !== base.summary)) { stale.push(o); continue; }
      next = updateSection(next, sec.id, (x) => ({ ...x, ...(o.title !== undefined ? { title: o.title } : {}), ...(o.summary !== undefined ? { summary: o.summary || undefined } : {}) }));
      applied.push(o); continue;
    }
    if (o.op === "insert") {
      if (o.after && !sec.blocks.some((b) => b.id === o.after)) { stale.push(o); continue; }
      const nb = { ...o.next!, id: findBlock(next, o.next!.id) ? newId() : o.next!.id };
      next = updateSection(next, sec.id, (x) => { const blocks = [...x.blocks]; blocks.splice(o.after ? blocks.findIndex((b) => b.id === o.after) + 1 : 0, 0, nb); return { ...x, blocks }; });
      applied.push(o); continue;
    }
    const b = sec.blocks.find((x) => x.id === o.block);
    if (!b) { stale.push(o); continue; }
    if (o.op === "set") {
      if (textOf(b, o.path!) !== o.base) { stale.push(o); continue; }
      next = setField(next, { sid: sec.id, bid: b.id, path: o.path! }, o.value!);
    } else {
      if (blockHash(b) !== o.base) { stale.push(o); continue; }
      next = updateSection(next, sec.id, (x) => (o.op === "remove" ? { ...x, blocks: x.blocks.filter((y) => y.id !== b.id) } : { ...x, blocks: x.blocks.map((y) => (y.id === b.id ? o.next! : y)) }));
    }
    applied.push(o);
  }
  return { doc: next, applied, stale };
}

export const hasReview = (o: CheckedOp) => o.flags.some((f) => f.severity === "review");
