/*
 * 쪽 계획 + 쪽 상태(순서·숨김·편집층) → 쪽 노드 트리. 서버(PDF·미리보기)와 스튜디오가 같은 함수를 쓴다. 클라이언트 안전.
 */
import { buildPagePlan, type PagePlanItem, type PageVariant } from "@/lib/catalog/render/components/plan";
import type { CoverChoice } from "@/lib/catalog/render/components/pages-front";
import type { CatalogRenderData, RenderCtx } from "@/lib/catalog/render/types";
import { elementToTree } from "./convert";
import { orderPlan, type StudioPageState } from "./doc";
import { applyEdits, orphanEdits, type ApplyOptions, type CasesEdit } from "./edits";
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

type CaseLine = CatalogRenderData["areas"][number]["featured"][number];

/** 대표 실적 직접 입력에서 그릴 행 — 연도·용역명·오른쪽 칸이 모두 빈 행은 뺀다 */
export function manualCaseLines(cases: CasesEdit): CaseLine[] {
  return cases.rows.map((r) => ({ year: r.year.trim(), title: r.title.trim(), meta: r.meta.trim() })).filter((r) => r.year || r.title || r.meta);
}

/** 쪽 키의 지금 자동 선별 대표 실적(직접 입력으로 바꿀 때 처음 행으로 쓴다). 사업 분야 쪽이 아니면 null */
export function autoCasesOf(data: CatalogRenderData, key: string): CaseLine[] | null {
  const m = key.match(/^area-(\d+)$/);
  const area = m ? data.areas.find((a) => a.index === Number(m[1]) && a.index <= 5) : undefined;
  if (area) return area.featured;
  const custom = (data.customAreas ?? []).find((a) => a.key === key);
  return custom ? custom.featured : null;
}

/**
 * 사업 분야 쪽(area-1~5·새 분야)의 대표 실적을 쪽 편집층의 직접 입력(PageEdits.cases)으로 바꾼 데이터.
 * 직접 입력이 없는 분야는 그대로(자동 선별 — 대표 실적 표시 계약, 없으면 금액 순).
 */
export function withCaseEdits(data: CatalogRenderData, pages: StudioPageState[]): CatalogRenderData {
  const manual = new Map<string, CaseLine[]>();
  for (const p of pages) if (p.edits.cases) manual.set(p.key, manualCaseLines(p.edits.cases));
  if (!manual.size) return data;
  return {
    ...data,
    areas: data.areas.map((a) => {
      const rows = a.index <= 5 ? manual.get(`area-${a.index}`) : undefined;
      return rows ? { ...a, featured: rows, featuredFallback: false } : a;
    }),
    ...(data.customAreas ? { customAreas: data.customAreas.map((a) => (manual.has(a.key) ? { ...a, featured: manual.get(a.key)! } : a)) } : {}),
  };
}

/** 순서대로 정렬한 쪽 계획(숨긴 쪽 포함) */
export function orderedPlan(ctx: RenderCtx, data: CatalogRenderData, cover: CoverChoice, pages: StudioPageState[]): PagePlanItem[] {
  return orderPlan(buildPagePlan(ctx, withCaseEdits(data, pages), cover, variantsOf(pages)), pages);
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
.kc-x-image { box-sizing: border-box; overflow: hidden; }
.kc-x-image > img { display: block; width: 100%; height: 100%; object-fit: cover; }
.kc-photo:has(> img), .kc-front__window:has(> img), .kc-front__band:has(> img) { background: transparent; }
`;
