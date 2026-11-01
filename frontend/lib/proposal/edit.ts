// 제안서 편집 연산 — React 와 무관한 순수 함수(편집기·검사 공용).
// 블록 만들기·모양 바꾸기·경로로 값 넣기·쪽 이동/넘기기.
import type { BulletItem, CardItem, ProposalBlock, ProposalBlockKind, ProposalDocument, ProposalSection } from "./types";
import { DIAGRAM_META, type DiagramKind, type DiagramSpec } from "./diagrams/types";

export const newId = (prefix = "b") => `${prefix}_${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "").slice(0, 20)}`;

export const BLOCK_LABEL: Record<ProposalBlockKind, string> = {
  heading: "제목", text: "본문", bullets: "개조식", lead: "핵심 메시지", callout: "참고·포인트 상자", stage: "단계 띠",
  cards: "카드", steps: "단계 흐름", kpis: "큰 숫자", table: "표", gantt: "일정표", figure: "인포그래픽", diagram: "도식", image: "그림·사진",
};

/** 블록 추가 목록 — 원본 제안서에서 자주 쓰인 순서 */
export const BLOCK_PALETTE: Array<{ kind: ProposalBlockKind; label: string; hint: string; variant?: string }> = [
  { kind: "heading", label: "제목", hint: "1. / 1.1 / □ 3단" },
  { kind: "bullets", label: "개조식", hint: "○ - · ※ ⇒" },
  { kind: "text", label: "본문", hint: "서술 문단" },
  { kind: "lead", label: "핵심 메시지", hint: "옅은 면 + 주색 띠" },
  { kind: "stage", label: "단계 띠", hint: "1단계 | 제목" },
  { kind: "cards", label: "카드", hint: "2~4열 강점·원칙" },
  { kind: "steps", label: "단계 흐름", hint: "01 ▶ 02 ▶ 03" },
  { kind: "kpis", label: "큰 숫자", hint: "실적·인력 수치" },
  { kind: "table", label: "표", hint: "격자·간결·양식형" },
  { kind: "gantt", label: "일정표", hint: "월별 막대 일정" },
  { kind: "callout", label: "참고·포인트", hint: "※ 참고, POINT" },
  { kind: "diagram", label: "도식", hint: "허브·조직도·전후 비교 등 8종" },
  { kind: "figure", label: "인포그래픽", hint: "회사소개서 16종" },
  { kind: "image", label: "그림·사진", hint: "PNG·JPEG" },
];

export function defaultDiagram(kind: DiagramKind): DiagramSpec {
  const it = (label: string, extra: Partial<DiagramSpec["items"][number]> = {}, i = 0) => ({ id: `i${i + 1}`, label, ...extra });
  switch (kind) {
    case "hub": return { kind, center: { label: "통합환경관리" }, items: ["대기", "수질", "폐기물", "소음·진동", "악취", "토양"].map((l, i) => it(l, {}, i)) };
    case "org": return { kind, items: [it("사업수행 책임자", { group: "top", desc: "PM 1명" }, 0), it("분야별 전문가", { group: "left" }, 1), it("측정 전문가", { group: "left" }, 2), it("참여 인력", { group: "right", desc: "7명" }, 3), it("A 사업장 팀", { desc: "팀장 1명\n팀원 2명" }, 4), it("B 사업장 팀", { desc: "팀장 1명\n팀원 2명" }, 5), it("품질보증팀", { desc: "검토 2명" }, 6)] };
    case "beforeAfter": return { kind, legend: ["기존", "개선"], items: [it("허가 신청", { a: "10개 허가 복수 신청", b: "1개 통합허가 신청" }, 0), it("검토 절차", { a: "서류 확인 위주", b: "전문 검토·사전 협의" }, 1), it("사후 관리", { a: "매체별 단속", b: "주기적 허가 검토·기술 진단" }, 2)] };
    case "pyramid": return { kind, items: [it("비전", { desc: "지향점" }, 0), it("추진 전략", { desc: "전략 방향" }, 1), it("실행 과제", { desc: "세부 과제" }, 2)] };
    case "arc": return { kind, center: { label: "기대 효과" }, items: ["법규 준수", "운영 효율", "위험 감소", "신뢰 제고", "지속 개선"].map((l, i) => it(l, {}, i)) };
    case "chevrons": return { kind, items: [it("1단계 사전 조사", { desc: "자료 수집\n현장 확인" }, 0), it("2단계 계획서 작성", { desc: "1~8장 작성\n교차 검토" }, 1), it("3단계 허가 취득", { desc: "사전 협의\n보완 대응" }, 2)] };
    case "scatter": return { kind, axes: ["사업 영향도", "이해관계자 관심도"], legend: ["환경", "사회·지배구조"], items: [it("기후변화 대응", { x: 82, y: 78 }, 0), it("자원순환", { x: 70, y: 64 }, 1), it("안전보건", { x: 60, y: 82, group: "b" }, 2), it("윤리경영", { x: 35, y: 48, group: "b" }, 3)] };
    case "venn": return { kind, items: [it("현황의 정확성", { desc: "허가·도면·현장 대조" }, 0), it("판단의 설명력", { desc: "쟁점별 근거와 대안" }, 1), it("운영의 실행성", { desc: "조건·담당·기록 인계" }, 2)] };
  }
}

export function makeBlock(kind: ProposalBlockKind): ProposalBlock {
  const id = newId();
  switch (kind) {
    case "heading": return { kind, id, level: 3, text: "소제목" };
    case "text": return { kind, id, text: "" };
    case "bullets": return { kind, id, items: [{ level: 1, text: "핵심 내용" }, { level: 2, text: "세부 내용" }] };
    case "lead": return { kind, id, text: "이 쪽의 핵심 메시지를 한 문장으로 씁니다." };
    case "callout": return { kind, id, variant: "note", title: "참고", text: "" };
    case "stage": return { kind, id, label: "1단계", text: "단계 이름" };
    case "cards": return { kind, id, columns: 3, numbered: true, items: [{ title: "항목 1", body: "" }, { title: "항목 2", body: "" }, { title: "항목 3", body: "" }] };
    case "steps": return { kind, id, items: [{ title: "자료 수집", body: "" }, { title: "현장 확인", body: "" }, { title: "작성·검토", body: "" }, { title: "제출·협의", body: "" }] };
    case "kpis": return { kind, id, items: [{ value: "0", unit: "건", label: "수행 실적" }, { value: "0", unit: "명", label: "전문 인력" }, { value: "0", unit: "년", label: "업력" }] };
    case "table": return { kind, id, title: "표 제목", style: "grid", columns: ["구분", "내용", "비고"], rows: [["", "", ""], ["", "", ""]] };
    case "gantt": return { kind, id, title: "과업 수행 일정", periods: Array.from({ length: 12 }, (_, i) => `M${i + 1}`), tasks: [{ group: "착수", label: "자료 수집", start: 0, end: 1 }, { group: "수행", label: "본 과업", start: 2, end: 9, tone: "key" }, { group: "완료", label: "최종 보고", start: 10, end: 11, tone: "report" }] };
    case "figure": return { kind, id, title: "수행 절차", widthMm: 174, heightMm: 46, spec: { type: "process", variant: "h", colorMode: "brand", content: { items: [{ id: "i1", label: "현황 조사" }, { id: "i2", label: "계획 수립" }, { id: "i3", label: "성과물 제출" }] } } };
    case "diagram": { const spec = defaultDiagram("hub"); const [w, h] = DIAGRAM_META.hub.size; return { kind, id, title: "도식 제목", widthMm: w, heightMm: h, spec }; }
    case "image": return { kind, id, title: "", dataUrl: "", widthMm: 120, heightMm: 70 };
  }
}

const linesOf = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const stripMark = (s: string) => s.replace(/^\s*(?:[○❍◦●□■❑▪\-–·•※⇒✓]|\d+[.)])\s*/, "");

/** 내용을 지키며 바꿀 수 있는 모양 */
export function conversions(b: ProposalBlock): ProposalBlockKind[] {
  switch (b.kind) {
    case "text": return ["bullets", "lead", "callout"];
    case "bullets": return ["text", "cards", "steps"];
    case "lead": return ["text", "callout", "stage"];
    case "callout": return ["text", "lead"];
    case "cards": return ["steps", "table", "bullets"];
    case "steps": return ["cards", "table"];
    case "stage": return ["lead", "heading"];
    case "heading": return ["stage"];
    case "table": return b.columns.length >= 2 ? ["cards", "steps"] : [];
    default: return [];
  }
}

export function convertBlock(b: ProposalBlock, to: ProposalBlockKind): ProposalBlock {
  const id = b.id;
  const textOf = (): string => {
    switch (b.kind) {
      case "text": case "lead": return b.text;
      case "callout": return b.text;
      case "bullets": return b.items.map((x) => x.text).join("\n");
      case "stage": return b.text;
      case "heading": return b.text;
      default: return "";
    }
  };
  const itemsOf = (): CardItem[] => {
    switch (b.kind) {
      case "cards": case "steps": return b.items.map((x) => ({ ...x }));
      case "table": return b.rows.map((r) => ({ title: r[0] || "", body: r.slice(1).filter(Boolean).join("\n") }));
      case "bullets": {
        const out: CardItem[] = [];
        for (const it of b.items) {
          if (it.level === 1 || !out.length) out.push({ title: it.text, body: "" });
          else out[out.length - 1].body += (out[out.length - 1].body ? "\n" : "") + it.text;
        }
        return out;
      }
      default: return [];
    }
  };
  switch (to) {
    case "text": return { kind: "text", id, text: textOf() };
    case "lead": return { kind: "lead", id, text: linesOf(textOf()).join(" ") };
    case "callout": return { kind: "callout", id, variant: "note", title: "참고", text: textOf() };
    case "stage": return { kind: "stage", id, label: "1단계", text: linesOf(textOf())[0] ?? "" };
    case "heading": return { kind: "heading", id, level: 3, text: linesOf(textOf())[0] ?? "" };
    case "bullets": {
      if (b.kind === "cards") return { kind: "bullets", id, items: b.items.flatMap((c): BulletItem[] => [{ level: 1, text: c.title }, ...linesOf(c.body).map((t): BulletItem => ({ level: 2, text: stripMark(t) }))]) };
      return { kind: "bullets", id, items: linesOf(textOf()).map((t): BulletItem => ({ level: 1, text: stripMark(t) })) };
    }
    case "cards": { const items = itemsOf(); return { kind: "cards", id, columns: (Math.min(4, Math.max(2, items.length)) as 2 | 3 | 4), numbered: true, items }; }
    case "steps": return { kind: "steps", id, items: itemsOf().slice(0, 6) };
    case "table": return { kind: "table", id, title: "", style: "grid", columns: ["구분", "내용"], rows: itemsOf().map((x) => [x.title, x.body]) };
    default: return b;
  }
}

// ── 경로로 값 넣기(미리보기 더블클릭 편집) ───────────────────────────────────
function setDeep(target: unknown, path: string[], value: string): unknown {
  if (!path.length) return value;
  const [head, ...rest] = path;
  if (Array.isArray(target)) {
    const i = Number(head);
    const copy = [...target];
    copy[i] = setDeep(copy[i], rest, value);
    return copy;
  }
  const o = (target && typeof target === "object" ? target : {}) as Record<string, unknown>;
  return { ...o, [head]: setDeep(o[head], rest, value) };
}
export function getDeep(target: unknown, path: string[]): unknown {
  return path.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), target);
}

export function setAtPath(doc: ProposalDocument, sid: string, bid: string, path: string, value: string): ProposalDocument {
  const segs = path.split(".");
  return {
    ...doc,
    sections: doc.sections.map((s) => {
      if (s.id !== sid) return s;
      if (bid === "_page") return setDeep(s, segs, value) as ProposalSection;
      return { ...s, blocks: s.blocks.map((b) => (b.id === bid ? (setDeep(b, segs, value) as ProposalBlock) : b)) };
    }),
  };
}
export function getAtPath(doc: ProposalDocument, sid: string, bid: string, path: string): string {
  const s = doc.sections.find((x) => x.id === sid);
  if (!s) return "";
  const v = getDeep(bid === "_page" ? s : s.blocks.find((b) => b.id === bid), path.split("."));
  return typeof v === "string" ? v : "";
}

// ── 쪽·블록 이동 ─────────────────────────────────────────────────────────────
export function updateSection(doc: ProposalDocument, sid: string, fn: (s: ProposalSection) => ProposalSection): ProposalDocument {
  return { ...doc, sections: doc.sections.map((s) => (s.id === sid ? fn(s) : s)) };
}
export function updateBlock(doc: ProposalDocument, bid: string, fn: (b: ProposalBlock) => ProposalBlock): ProposalDocument {
  return { ...doc, sections: doc.sections.map((s) => (s.blocks.some((b) => b.id === bid) ? { ...s, blocks: s.blocks.map((b) => (b.id === bid ? fn(b) : b)) } : s)) };
}
export function findBlock(doc: ProposalDocument, bid: string): { section: ProposalSection; block: ProposalBlock; index: number } | null {
  for (const section of doc.sections) {
    const index = section.blocks.findIndex((b) => b.id === bid);
    if (index >= 0) return { section, block: section.blocks[index], index };
  }
  return null;
}

/** 블록 복제 — 새 id. 도식 항목 id 는 블록 안에서만 쓰여 그대로 둔다. */
export function cloneBlock(b: ProposalBlock): ProposalBlock { return { ...structuredClone(b), id: newId() }; }

export function insertSectionAfter(doc: ProposalDocument, afterId: string | null, s: ProposalSection): ProposalDocument {
  const i = afterId ? doc.sections.findIndex((x) => x.id === afterId) : doc.sections.length - 1;
  const sections = [...doc.sections];
  sections.splice(i + 1, 0, s);
  return { ...doc, sections };
}

/** 넘친 쪽의 마지막 블록을 다음 이어지는 쪽으로 보낸다(없으면 같은 장·절의 새 쪽을 만든다). */
export function pushLastBlockToNextPage(doc: ProposalDocument, sid: string): { doc: ProposalDocument; target: string } | null {
  const i = doc.sections.findIndex((s) => s.id === sid);
  const s = doc.sections[i];
  if (!s || s.blocks.length < 2) return null;
  const last = s.blocks[s.blocks.length - 1];
  const next = doc.sections[i + 1];
  const continues = next && next.chapter === s.chapter && next.crumb === s.crumb && !next.title;
  const sections = [...doc.sections];
  sections[i] = { ...s, blocks: s.blocks.slice(0, -1) };
  if (continues) { sections[i + 1] = { ...next, blocks: [last, ...next.blocks] }; return { doc: { ...doc, sections }, target: next.id }; }
  const created: ProposalSection = { id: newId("p"), title: "", chapter: s.chapter, crumb: s.crumb, pageId: s.pageId ? `${s.pageId}-2` : undefined, blocks: [last] };
  sections.splice(i + 1, 0, created);
  return { doc: { ...doc, sections }, target: created.id };
}

// ── 목록·표 편집 ─────────────────────────────────────────────────────────────
export function moveItem<T>(list: T[], i: number, d: number): T[] { const a = [...list]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; }

type TableBlock = Extract<ProposalBlock, { kind: "table" }>;
/** at 위치에 빈 행을 넣는다(at = 행 수면 맨 끝). */
export function insertTableRow(b: TableBlock, at: number): TableBlock {
  const rows = [...b.rows]; rows.splice(Math.max(0, Math.min(at, rows.length)), 0, b.columns.map(() => "")); return { ...b, rows };
}
/** 열을 옮긴다 — 머리글·모든 행의 칸·열 폭이 함께 움직인다. */
export function moveTableColumn(b: TableBlock, i: number, d: number): TableBlock {
  const j = i + d;
  if (j < 0 || j >= b.columns.length) return b;
  return { ...b, columns: moveItem(b.columns, i, d), rows: b.rows.map((r) => moveItem(r, i, d)), ...(b.widths ? { widths: moveItem(b.widths, i, d) } : {}) };
}

export type BulletAction = "insert" | "indent" | "outdent" | "remove";
/** 미리보기 겹친 입력창의 개조식 단축키 — 지금 줄 글을 반영하고 동작을 적용한다. focus 는 다음에 열 줄. */
export function bulletAction(items: BulletItem[], i: number, value: string, action: BulletAction): { items: BulletItem[]; focus: number } {
  const next = items.map((x, k) => (k === i ? { ...x, text: value } : x));
  const cur = next[i];
  if (!cur) return { items, focus: i };
  switch (action) {
    case "insert": next.splice(i + 1, 0, { level: cur.level, text: "", ...(cur.mark ? { mark: cur.mark } : {}) }); return { items: next, focus: i + 1 };
    case "indent": case "outdent": {
      const level = Math.max(1, Math.min(3, cur.level + (action === "indent" ? 1 : -1))) as 1 | 2 | 3;
      next[i] = { ...cur, level }; return { items: next, focus: i };
    }
    case "remove": if (next.length < 2) return { items: next, focus: i }; next.splice(i, 1); return { items: next, focus: Math.max(0, i - 1) };
  }
}

// ── 실행 취소 ────────────────────────────────────────────────────────────────
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastAt = 0;
  private lastKey = "";
  constructor(private limit = 100, private mergeMs = 900) {}
  push(prev: T, key = "") {
    const now = Date.now();
    if (key && key === this.lastKey && now - this.lastAt < this.mergeMs) { this.lastAt = now; return; }
    this.past.push(prev);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.lastAt = now; this.lastKey = key;
  }
  undo(current: T): T | null { const p = this.past.pop(); if (p === undefined) return null; this.future.push(current); this.lastKey = ""; return p; }
  redo(current: T): T | null { const n = this.future.pop(); if (n === undefined) return null; this.past.push(current); this.lastKey = ""; return n; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  reset() { this.past = []; this.future = []; this.lastKey = ""; }
}
