// 원고 작성 도구 — 공통 원고(content/*.ts)를 짧게 쓰기 위한 블록 생성 함수.
// 개조식 줄 머리: "- " 2단, "· " 3단, "※ " 참고, "⇒ " 결과, "✓ " 확인, 그 밖은 1단(○).
import type { BulletItem, CardItem, GanttTask, KpiItem, ProposalBlock, ProposalSection, TableStyle } from "../types";
import type { DiagramItem, DiagramSpec } from "../diagrams/types";
import type { InfoSpec } from "@/lib/catalog/render/infographic/types";

type B = ProposalBlock extends unknown ? (ProposalBlock extends infer T ? (T extends unknown ? Omit<T, "id"> : never) : never) : never;
export const H1 = (text: string): B => ({ kind: "heading", level: 1, text });
export const H2 = (text: string): B => ({ kind: "heading", level: 2, text });
export const H3 = (text: string): B => ({ kind: "heading", level: 3, text });
export const P = (text: string): B => ({ kind: "text", text });
export const LEAD = (text: string, label?: string): B => ({ kind: "lead", text, ...(label ? { label } : {}) });
export const NOTE = (text: string, title = "참고"): B => ({ kind: "callout", variant: "note", title, text });
export const POINT = (text: string, title = "POINT"): B => ({ kind: "callout", variant: "point", title, text });
export const STAGE = (label: string, text: string): B => ({ kind: "stage", label, text });
export function UL(...lines: string[]): B {
  const items = lines.map((l): BulletItem => {
    if (l.startsWith("- ")) return { level: 2, text: l.slice(2) };
    if (l.startsWith("· ")) return { level: 3, text: l.slice(2) };
    if (l.startsWith("※ ")) return { level: 1, mark: "note", text: l.slice(2) };
    if (l.startsWith("⇒ ")) return { level: 1, mark: "result", text: l.slice(2) };
    if (l.startsWith("✓ ")) return { level: 2, mark: "check", text: l.slice(2) };
    return { level: 1, text: l };
  });
  return { kind: "bullets", items };
}
const items = (list: Array<[string, string, boolean?]>): CardItem[] => list.map(([title, body, key]) => ({ title, body, ...(key ? { key: true } : {}) }));
export const CARDS = (columns: 2 | 3 | 4, list: Array<[string, string, boolean?]>, numbered = true): B => ({ kind: "cards", columns, numbered, items: items(list) });
export const STEPS = (list: Array<[string, string]>): B => ({ kind: "steps", items: items(list) });
export const KPIS = (list: Array<[string, string, string]>): B => ({ kind: "kpis", items: list.map(([value, unit, label]): KpiItem => ({ value, unit, label })) });
export function TABLE(title: string, columns: string[], rows: string[][], opts: { style?: TableStyle; widths?: number[]; firstCol?: boolean; note?: string } = {}): B {
  return { kind: "table", title, columns, rows, style: opts.style ?? "grid", ...(opts.widths ? { widths: opts.widths } : {}), ...(opts.firstCol ? { firstCol: true } : {}), ...(opts.note ? { note: opts.note } : {}) };
}
export const GANTT = (title: string, periods: string[], tasks: GanttTask[], note?: string): B => ({ kind: "gantt", title, periods, tasks, ...(note ? { note } : {}) });
export function DIA(title: string, spec: Omit<DiagramSpec, "items"> & { items: Array<Omit<DiagramItem, "id">> }, heightMm: number, widthMm = 174): B {
  return { kind: "diagram", title, widthMm, heightMm, spec: { ...spec, items: spec.items.map((it, i) => ({ id: `i${i + 1}`, ...it })) } };
}
export function INFO(title: string, type: InfoSpec["type"], list: Array<[string, string?]>, heightMm: number, variant?: string): B {
  return { kind: "figure", title, widthMm: 174, heightMm, spec: { type, variant, colorMode: "brand", content: { items: list.map(([label, desc], i) => ({ id: `i${i + 1}`, label, ...(desc ? { desc } : {}) })) } } };
}

/** 쪽 — pageId 를 블록 id 접두로 써서 문서 안에서 유일하게 만든다. */
export function page(pageId: string, chapter: string, crumb: string, title: string, summary: string | undefined, blocks: B[]): ProposalSection {
  return { id: pageId, pageId, chapter, crumb, title, ...(summary ? { summary } : {}), blocks: blocks.map((b, i) => ({ ...b, id: `${pageId}-b${i + 1}` }) as ProposalBlock) };
}
export const months = (n: number, prefix = "M") => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/** 다른 양식의 공통 쪽을 가져와 장·절·쪽 번호를 바꾼다(블록 id 도 새 쪽 번호로). */
export function reuse(from: ProposalSection, pageId: string, chapter: string, crumb: string, patch: Partial<ProposalSection> = {}): ProposalSection {
  return { ...structuredClone(from), id: pageId, pageId, chapter, crumb, ...patch, blocks: (patch.blocks ?? from.blocks).map((b, i) => ({ ...structuredClone(b), id: `${pageId}-b${i + 1}` })) };
}
