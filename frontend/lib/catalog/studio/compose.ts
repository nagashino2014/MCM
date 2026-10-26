/*
 * 쪽 계획 + 쪽 상태(순서·숨김·편집층) → 쪽 노드 트리. 서버(PDF·미리보기)와 스튜디오가 같은 함수를 쓴다. 클라이언트 안전.
 */
import { buildPagePlan, type PagePlanItem, type PageVariant } from "@/lib/catalog/render/components/plan";
import type { CoverChoice } from "@/lib/catalog/render/components/pages-front";
import type { CatalogRenderData, RenderCtx } from "@/lib/catalog/render/types";
import { elementToTree } from "./convert";
import { orderPlan, type StudioPageState } from "./doc";
import { applyEdits, orphanEdits, type ApplyOptions } from "./edits";
import type { CNode } from "./nodes";

export interface ComposedPage {
  item: PagePlanItem;
  state: StudioPageState | null;
  hidden: boolean;
  base: CNode;
  tree: CNode;
  /** 붙을 노드를 잃은 편집(데이터 구조가 바뀜) */
  orphans: string[];
}

export function variantsOf(pages: StudioPageState[]): Record<string, PageVariant> {
  const out: Record<string, PageVariant> = {};
  for (const p of pages) if (p.edits.variant) out[p.key] = p.edits.variant;
  return out;
}

/** 순서대로 정렬한 쪽 계획(숨긴 쪽 포함) */
export function orderedPlan(ctx: RenderCtx, data: CatalogRenderData, cover: CoverChoice, pages: StudioPageState[]): PagePlanItem[] {
  return orderPlan(buildPagePlan(ctx, data, cover, variantsOf(pages)), pages);
}

export function composePage(item: PagePlanItem, state: StudioPageState | null, opts: ApplyOptions = {}): ComposedPage {
  const base = elementToTree(item.element, item.key);
  const tree = applyEdits(base, state?.edits, opts);
  return { item, state, hidden: state?.hidden ?? false, base, tree, orphans: orphanEdits(base, state?.edits) };
}

/** 문서 전체 — includeHidden 이 아니면 숨긴 쪽은 뺀다 */
export function composeDocument(
  ctx: RenderCtx,
  data: CatalogRenderData,
  cover: CoverChoice,
  pages: StudioPageState[],
  opts: ApplyOptions & { includeHidden?: boolean } = {}
): ComposedPage[] {
  const byKey = new Map(pages.map((p) => [p.key, p]));
  return orderedPlan(ctx, data, cover, pages)
    .filter((it) => opts.includeHidden || !byKey.get(it.key)?.hidden)
    .map((it) => composePage(it, byKey.get(it.key) ?? null, { metrics: data.metrics, ...opts }));
}

/** 스튜디오가 만든 요소(글상자·도형·이미지)의 지면 CSS — PDF·미리보기·캔버스 공용(디자인 시스템 토큰만) */
export const STUDIO_PRINT_CSS = `
.kc-x-text { box-sizing: border-box; color: var(--ink); font-family: var(--kc-font-body); font-size: 10.5px; line-height: 17px; word-break: keep-all; overflow-wrap: break-word; }
.kc-x-text p { margin: 0; }
.kc-x-shape { box-sizing: border-box; background: var(--brand-tint); }
.kc-x-shape--round { border-radius: var(--radius-sm); }
.kc-x-shape--circle { border-radius: 50%; }
.kc-x-shape--line { background: var(--rule-strong); }
.kc-x-image { box-sizing: border-box; overflow: hidden; background: var(--photo-fill); }
.kc-x-image > img { display: block; width: 100%; height: 100%; object-fit: cover; }
`;
