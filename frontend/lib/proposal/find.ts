// 문서의 글 칸 — 찾기·바꾸기, [작성 필요]·연결 표기 목록, (P1) AI 수정이 같은 목록을 쓴다.
// 경로 문법은 미리보기 더블클릭 편집(data-edit="쪽|블록|경로")과 같다. 미리보기의 모든 data-edit 경로가
// 여기 들어 있는지는 tests/proposal-edit.test.ts 가 대조한다. 열거값·id·그림 데이터는 글 칸이 아니라 닿지 않는다.
import type { ProposalBlock, ProposalDocument } from "./types";
import { BLOCK_LABEL, getDeep, setAtPath } from "./edit";

/** bid: 블록 id · "_page"(쪽 제목·요약·장·절) · "_doc"(표지·문서 설정) */
export interface TextField { sid: string; bid: string; path: string; value: string }

const PENDING = "[작성 필요]";
const LINK_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
const TOKEN_RE = /\{\{[^{}]*\}\}/g;

/** 블록 종류별 글 칸 경로 */
export function blockTextPaths(b: ProposalBlock): string[] {
  const each = <T,>(list: T[] | undefined, fields: Array<keyof T & string>, base: string) => (list ?? []).flatMap((it, i) => fields.filter((f) => typeof it[f] === "string").map((f) => `${base}.${i}.${f}`));
  const opt = (o: Record<string, unknown>, keys: string[]) => keys.filter((k) => typeof o[k] === "string");
  switch (b.kind) {
    case "heading": case "text": return ["text"];
    case "bullets": return each(b.items, ["text"], "items");
    case "lead": return [...opt(b, ["label"]), "text"];
    case "callout": return ["title", "text"];
    case "stage": return ["label", "text"];
    case "cards": case "steps": return each(b.items, ["title", "body"], "items");
    case "kpis": return each(b.items, ["value", "unit", "label"], "items");
    case "table": return ["title", ...b.columns.map((_, i) => `columns.${i}`), ...b.rows.flatMap((r, ri) => r.map((_, ci) => `rows.${ri}.${ci}`)), ...opt(b, ["note"])];
    case "gantt": return ["title", ...b.periods.map((_, i) => `periods.${i}`), ...each(b.tasks, ["group", "label"], "tasks"), ...opt(b, ["note"])];
    case "figure": return ["title", ...(b.spec.content.center ? opt(b.spec.content.center, ["label"]).map((k) => `spec.content.center.${k}`) : []), ...each(b.spec.content.items, ["label", "desc", "when", "sub"], "spec.content.items")];
    case "diagram": return ["title", ...(b.spec.center ? opt(b.spec.center, ["label", "desc"]).map((k) => `spec.center.${k}`) : []), ...(b.spec.legend ?? []).map((_, i) => `spec.legend.${i}`), ...(b.spec.axes ?? []).map((_, i) => `spec.axes.${i}`), ...each(b.spec.items, ["label", "desc", "a", "b"], "spec.items")];
    case "image": return ["title"];
  }
}

const DOC_PATHS = ["title", "projectName", "client", "variables.siteName", "variables.duration", "variables.companyName"] as const;
const PAGE_PATHS = ["title", "summary", "chapter", "crumb"] as const;

/** 문서의 모든 글 칸(빈 칸 포함) — 표지·문서 설정 → 쪽 순서 */
export function textFields(doc: ProposalDocument): TextField[] {
  const out: TextField[] = [];
  const push = (sid: string, bid: string, path: string, v: unknown) => { if (typeof v === "string") out.push({ sid, bid, path, value: v }); };
  for (const p of DOC_PATHS) push("", "_doc", p, getDeep(doc, p.split(".")));
  for (const s of doc.sections) {
    for (const p of PAGE_PATHS) push(s.id, "_page", p, s[p]);
    for (const b of s.blocks) for (const p of blockTextPaths(b)) push(s.id, b.id, p, getDeep(b, p.split(".")));
  }
  return out;
}

export function setField(doc: ProposalDocument, f: Pick<TextField, "sid" | "bid" | "path">, value: string): ProposalDocument {
  if (f.bid !== "_doc") return setAtPath(doc, f.sid, f.bid, f.path, value);
  if (f.path.startsWith("variables.")) {
    const key = f.path.slice("variables.".length);
    return { ...doc, variables: { siteName: "", duration: "", companyName: "", ...doc.variables, [key]: value } };
  }
  return { ...doc, [f.path]: value };
}

// ── 사람이 읽는 칸 이름 ──────────────────────────────────────────────────────
const DOC_LABEL: Record<string, string> = { title: "제안서 제목", projectName: "용역명", client: "발주처", "variables.siteName": "사업장명", "variables.duration": "수행기간", "variables.companyName": "제안사명" };
const PAGE_LABEL: Record<string, string> = { title: "쪽 제목", summary: "요약", chapter: "장", crumb: "절" };

export function fieldLabel(doc: ProposalDocument, f: Pick<TextField, "sid" | "bid" | "path">): string {
  if (f.bid === "_doc") return `표지 · ${DOC_LABEL[f.path] ?? f.path}`;
  const s = doc.sections.find((x) => x.id === f.sid);
  const page = s?.pageId ?? (s ? String(doc.sections.indexOf(s) + 1) : "");
  if (f.bid === "_page") return `${page} · ${PAGE_LABEL[f.path] ?? f.path}`;
  const b = s?.blocks.find((x) => x.id === f.bid);
  if (!b) return page;
  const seg = f.path.split(".");
  const n = (i: string) => Number(i) + 1;
  let part = "";
  if (seg[0] === "rows") part = `${n(seg[1])}행 ${n(seg[2])}열`;
  else if (seg[0] === "columns") part = `${n(seg[1])}열 머리글`;
  else if (seg[0] === "periods") part = `기간 ${n(seg[1])}`;
  else if (seg[0] === "tasks") part = `${n(seg[1])}번째 과업`;
  else if (seg[0] === "items" || (seg[0] === "spec" && seg.includes("items"))) part = `${n(seg[seg.indexOf("items") + 1])}번째 항목`;
  else if (f.path === "title") part = "제목";
  else if (f.path === "note") part = "주석";
  return `${page} · ${BLOCK_LABEL[b.kind]}${part ? ` · ${part}` : ""}`;
}

// ── [작성 필요]·연결 표기 ────────────────────────────────────────────────────
export interface PendingItem extends TextField { kind: "todo" | "link"; count: number; names?: string[] }

/** 발행을 막는 칸 — [작성 필요]가 남은 칸, 값이 비었거나 없는 연결 표기({{siteName}} 등)가 남은 칸 */
export function pendingItems(doc: ProposalDocument): PendingItem[] {
  const values: Record<string, string> = { client: doc.client, projectName: doc.projectName, ...doc.variables };
  const out: PendingItem[] = [];
  for (const f of textFields(doc)) {
    const todo = f.value.split(PENDING).length - 1;
    if (todo) out.push({ ...f, kind: "todo", count: todo });
    const names = [...f.value.matchAll(LINK_RE)].map((m) => m[1]).filter((name) => !(Object.hasOwn(values, name) && typeof values[name] === "string" && values[name].trim()));
    // 연결 표기 문법이 틀린 것({{ }} 안에 다른 글자)도 발행 검사에 걸리므로 함께 보인다.
    const broken = [...f.value.matchAll(TOKEN_RE)].filter((m) => !/^\{\{\s*[A-Za-z][A-Za-z0-9_]*\s*\}\}$/.test(m[0])).map((m) => m[0]);
    if (names.length || broken.length) out.push({ ...f, kind: "link", count: names.length + broken.length, names: [...new Set([...names, ...broken])] });
  }
  return out;
}

// ── 찾기·바꾸기 ──────────────────────────────────────────────────────────────
export interface FindOptions { caseSensitive?: boolean }
export interface FindMatch extends TextField { start: number; end: number; key: string; skip?: string }

/** 바꾸면 표식이 깨지는 범위 — 연결 표기 {{…}} 와 굵게 표식 ** */
function guardedRanges(text: string): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  for (const m of text.matchAll(TOKEN_RE)) out.push([m.index, m.index + m[0].length, "연결 표기"]);
  for (const m of text.matchAll(/\*\*/g)) out.push([m.index, m.index + 2, "굵게 표식"]);
  return out;
}

export function findMatches(doc: ProposalDocument, query: string, opts: FindOptions = {}): FindMatch[] {
  if (!query) return [];
  const q = opts.caseSensitive ? query : query.toLocaleLowerCase("ko-KR");
  const out: FindMatch[] = [];
  for (const f of textFields(doc)) {
    const hay = opts.caseSensitive ? f.value : f.value.toLocaleLowerCase("ko-KR");
    if (hay.length !== f.value.length) continue; // 대소문자 변환으로 길이가 달라지는 글자는 위치를 맞출 수 없다
    const guards = guardedRanges(f.value);
    for (let at = hay.indexOf(q); at >= 0; at = hay.indexOf(q, at + q.length)) {
      const end = at + q.length;
      // 표식 안에 들어가거나 걸치는 일치는 건너뛴다(표식 전체를 정확히 바꾸는 것은 허용).
      const g = guards.find(([s, e]) => at < e && end > s && !(at <= s && end >= e));
      out.push({ ...f, start: at, end, key: `${f.sid}|${f.bid}|${f.path}|${at}`, ...(g ? { skip: `${g[2]}를 가로질러 바꿀 수 없습니다` } : {}) });
    }
  }
  return out;
}

/** 일치를 바꾼다 — only 가 있으면 그 key 만. 표식을 깨는 일치는 건너뛴다. */
export function replaceMatches(doc: ProposalDocument, query: string, replacement: string, opts: FindOptions & { only?: Set<string> } = {}): { doc: ProposalDocument; replaced: number; skipped: number } {
  const matches = findMatches(doc, query, opts).filter((m) => !opts.only || opts.only.has(m.key));
  const byField = new Map<string, FindMatch[]>();
  for (const m of matches) { const k = `${m.sid}|${m.bid}|${m.path}`; byField.set(k, [...(byField.get(k) ?? []), m]); }
  let next = doc, replaced = 0, skipped = 0;
  for (const list of byField.values()) {
    const f = list[0];
    let text = f.value;
    // 뒤에서부터 바꿔야 앞 일치의 위치가 유지된다.
    for (const m of [...list].sort((a, b) => b.start - a.start)) {
      if (m.skip) { skipped++; continue; }
      text = text.slice(0, m.start) + replacement + text.slice(m.end); replaced++;
    }
    if (text !== f.value) next = setField(next, f, text);
  }
  return { doc: next, replaced, skipped };
}
