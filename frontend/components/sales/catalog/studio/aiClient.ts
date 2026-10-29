"use client";

// 스튜디오 AI 편집(P6) 화면 공용 — 쪽 넘침 검사(렌더 후 실측), 넘침 자동 축약(copy_fit 1–2회), [AI로 줄이기] 제안 만들기.
// 검사는 전체 쪽 검사와 같은 방법(정적 HTML → 숨은 틀 → paginate 넘침 경고)이라 PDF 와 같은 판정이다.
// 일러스트 자리의 제목 뒤 지표 칩(§7-5 G)은 축약 글자 수에 칩 폭을 넣고, {{metric:…}} 표식으로 넘겨 칩을 지우지 못하게 한다.

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildOutline,
  charLen,
  infoItemLines,
  readableText,
  replaceChangeText,
  validatePatch,
  type InfoBlock,
  type MetricBrief,
  type OutlineBlock,
  type PageOutline,
  type PatchOp,
  type ProposedChange,
} from "@/lib/catalog/ai/patch";
import { fittedItems, infoContentOf, infoFitItems, infoTypeOf, overflowTargets, type FitItem } from "@/lib/catalog/ai/fit";
import type { InfoContent, InfoType } from "@/lib/catalog/render/infographic/types";
import type { PagePlanItem } from "@/lib/catalog/render/components/plan";
import { findPath, type CNode } from "@/lib/catalog/studio/nodes";
import { renderNode, type TreeEnv } from "@/lib/catalog/studio/render-tree";
import { catalogFetch } from "../catalogFetch";
import { runFullCheck } from "./checks";
import { frameDocument, type StudioKit } from "./kit";

export { overflowTargets };

export interface ClientProposal {
  source: "ai" | "rule";
  fallback?: string;
  summary: string;
  notes: string[];
  changes: ProposedChange[];
  dropped: string[];
  understood?: string[];
  missed?: string[];
  candidates: Array<{ id: string; year: string; title: string; meta: string; featured: boolean }>;
  metrics: Record<string, MetricBrief>;
}

export interface Overflow {
  count: number;
  texts: string[];
  error?: string;
}

/** 쪽 하나 넘침 실측(렌더 후) */
export async function pageOverflow(kit: StudioKit, fontSet: string, env: TreeEnv, tree: CNode, key: string): Promise<Overflow> {
  const html = renderToStaticMarkup(renderNode(tree, env, { decorate: (n, props) => (n.id === tree.id ? { ...props, "data-studio-key": key } : props) }) as ReactElement);
  const res = await runFullCheck(frameDocument(kit, fontSet, { body: `<div class="pk-book">${html}</div>`, script: "paginate" }), 30000);
  if (res.error) return { count: -1, texts: [], error: res.error };
  const list = Object.values(res.byKey).flat();
  return { count: list.length, texts: list.map((w) => (w.text ?? "").trim()).filter(Boolean) };
}

export function metricValues(metrics: Record<string, MetricBrief>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, m] of Object.entries(metrics)) if (m.value != null) out[id] = m.value;
  return out;
}

interface FitResponse {
  source: "ai" | "rule";
  fallback?: string;
  items: Array<{ key: string; text: string; source: "ai" | "rule" }>;
}

async function fit(items: Array<{ key: string; text: string; maxChars: number }>, metrics: Record<string, MetricBrief>, subject: string): Promise<FitResponse> {
  return catalogFetch<FitResponse>("/api/catalog/ai/fit", { method: "POST", body: JSON.stringify({ items, metricValues: metricValues(metrics), subject }) });
}

const shrink = (text: string, metrics: Record<string, MetricBrief>, ratio: number, floor = 6) => Math.max(floor, Math.floor(charLen(text, metrics) * ratio));

/** 인포그래픽·모양 바꿈의 라벨·설명 갈아 끼우기(검토 화면의 항목 줄만 새로, 유형·모양 줄은 그대로) */
function replaceInfoTexts(c: ProposedChange, updates: Map<string, string>, metrics: Record<string, MetricBrief>): ProposedChange {
  const base = infoContentOf(c);
  if (!base) return c;
  const content: InfoContent = { ...base, items: fittedItems(c.id, base, c.illust, updates) };
  const isItem = (l: string) => /^\d+\. /.test(l);
  const at = c.after.findIndex(isItem);
  const lines = infoItemLines(content, metrics).map((l) => readableText(l, metrics));
  const after = at < 0 ? [...c.after, ...lines] : [...c.after.slice(0, at), ...lines, ...c.after.slice(at).filter((l) => !isItem(l))];
  return { ...c, after, content, edit: { ...(c.edit ?? {}), info: { ...(c.edit?.info ?? {}), content } } };
}

/** 바꿈들을 줄인다(한 번) — 돌려주는 값: 새 바꿈 목록과 출처 */
export async function shrinkChanges(changes: ProposedChange[], targets: ProposedChange[], tree: CNode, metrics: Record<string, MetricBrief>, ratio: number, subject: string): Promise<{ changes: ProposedChange[]; source: "ai" | "rule"; fallback?: string }> {
  const items: FitItem[] = [];
  const ids = new Set(targets.map((t) => t.id));
  for (const c of targets) {
    const content = infoContentOf(c);
    if (c.kind === "text" && c.raw?.[0]) items.push({ key: c.id, text: c.raw[0], maxChars: shrink(c.raw[0], metrics, ratio, 12) });
    else if (c.kind === "list" && c.raw) c.raw.forEach((t, i) => items.push({ key: `${c.id}#${i}`, text: t, maxChars: shrink(t, metrics, ratio) }));
    else if ((c.kind === "info" || c.kind === "shape") && content) items.push(...infoFitItems(c.id, content, infoTypeOf(c), c.illust, metrics, { label: ratio, desc: ratio }));
  }
  if (items.length === 0) return { changes, source: "rule" };
  const res = await fit(items, metrics, subject);
  const got = new Map(res.items.map((x) => [x.key, x.text]));
  const next = changes.map((c) => {
    if (!ids.has(c.id)) return c;
    if (c.kind === "text") return replaceChangeText(c, [got.get(c.id) ?? c.raw?.[0] ?? ""], tree, metrics);
    if (c.kind === "list") return replaceChangeText(c, (c.raw ?? []).map((t, i) => got.get(`${c.id}#${i}`) ?? t), tree, metrics);
    if (c.kind === "info" || c.kind === "shape") return replaceInfoTexts(c, got, metrics);
    return c;
  });
  return { changes: next, source: res.source, fallback: res.fallback };
}

/** 고른 요소(넘친 요소)를 감싼 개요 자리 */
export function blockOfNode(outline: PageOutline, tree: CNode, nodeId: string): OutlineBlock | null {
  const path = findPath(tree, nodeId);
  if (!path) return null;
  for (let i = path.length - 1; i >= 0; i--) {
    const b = outline.blocks.find((x) => x.id === path[i].id && !(x.kind === "text" && x.readonly));
    if (b) return b;
  }
  return null;
}

/**
 * [AI로 줄이기] — 넘친 요소(또는 고른 인포그래픽)를 줄인 제안을 만든다. 결과는 [AI로 수정]과 같은 검토 화면으로 간다.
 * 글은 지금 길이의 80%, 인포그래픽은 유형의 라벨·설명 제한까지.
 */
export async function proposeShrink(item: PagePlanItem, tree: CNode, nodeIds: string[], metrics: Record<string, MetricBrief>, docId: string): Promise<ClientProposal> {
  const outline = buildOutline(tree, item, {});
  let blocks = [...new Map(nodeIds.map((id) => blockOfNode(outline, tree, id)).filter((b): b is OutlineBlock => b != null && b.kind !== "cases" && b.kind !== "added" && !(b.kind === "info" && b.added)).map((b) => [b.id, b])).values()];
  if (blocks.length === 0) {
    // 넘친 곳이 데이터 영역(대표 실적 등)이면 위의 글이 밀어낸 것 — 사람이 고친 글, 그다음 긴 리드·본문을 줄인다
    const pinned = new Set<string>();
    const walk = (n: CNode) => {
      if (n.pinned) pinned.add(n.id);
      n.children?.forEach(walk);
    };
    walk(tree);
    const texts = outline.blocks.filter((b): b is Extract<OutlineBlock, { kind: "text" }> => b.kind === "text" && !b.readonly && (b.role === "lead" || b.role === "body"));
    blocks = texts
      .slice()
      .sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || charLen(b.text, metrics) - charLen(a.text, metrics))
      .slice(0, 2);
  }
  if (blocks.length === 0) throw new Error("줄일 수 있는 글을 찾지 못했습니다(숫자 칸·데이터 영역은 데이터 화면에서 고칩니다).");
  const items: Array<{ key: string; text: string; maxChars: number }> = [];
  for (const b of blocks) {
    if (b.kind === "text") items.push({ key: b.id, text: b.text, maxChars: shrink(b.text, metrics, 0.8, 12) });
    else if (b.kind === "list") b.items.forEach((t, i) => items.push({ key: `${b.id}#${i}`, text: t, maxChars: shrink(t, metrics, 0.8) }));
    else if (b.kind === "info") items.push(...infoFitItems(b.id, b.content, b.type, b.illust?.asset, metrics, { label: 0.85, desc: 0.8 }));
  }
  const res = await fit(items, metrics, `${docId}:${item.key}`);
  const got = new Map(res.items.map((x) => [x.key, x.text]));
  const ops: PatchOp[] = blocks.map((b): PatchOp => {
    if (b.kind === "text") return { op: "text", id: b.id, text: got.get(b.id) ?? b.text };
    if (b.kind === "list") return { op: "list", id: b.id, items: b.items.map((t, i) => got.get(`${b.id}#${i}`) ?? t) };
    const ib = b as InfoBlock;
    return {
      op: "info",
      id: ib.id,
      items: fittedItems(ib.id, ib.content, ib.illust?.asset, got).map((it) => ({
        label: it.label,
        ...(it.desc ? { desc: it.desc } : {}),
        ...(it.when ? { when: it.when } : {}),
        ...(it.icon ? { icon: it.icon } : {}),
        ...(it.metric ? { metric: it.metric } : {}),
        ...(it.sub ? { sub: it.sub } : {}),
      })),
    };
  });
  const { changes, dropped } = validatePatch({ outline, tree, ops, metrics, source: res.source });
  return {
    source: res.source,
    fallback: res.fallback,
    summary: changes.length ? "넘친 글을 줄였습니다." : "더 줄일 글이 없습니다.",
    notes: [],
    changes,
    dropped,
    candidates: [],
    metrics,
  };
}

const RANK_CACHE = new Map<string, Promise<RankResponse>>();

export interface RankResponse {
  source: "ai" | "rule";
  fallback?: string;
  ranking: Array<{ type: InfoType; reason: string; source: "ai" | "rule" }>;
}

/** 인포그래픽 유형 LLM 순위(같은 내용·자리는 한 번만 묻는다) */
export function fetchRank(body: { content: InfoContent; box: { w: number; h: number }; current: InfoType; sectionTypes: InfoType[]; pref?: InfoType; slot: string }): Promise<RankResponse> {
  const key = JSON.stringify(body);
  let p = RANK_CACHE.get(key);
  if (!p) {
    p = catalogFetch<RankResponse>("/api/catalog/ai/rank", { method: "POST", body: JSON.stringify(body) });
    p.catch(() => RANK_CACHE.delete(key));
    RANK_CACHE.set(key, p);
  }
  return p;
}
