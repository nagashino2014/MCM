/*
 * 회사소개서 마스터본 쪽 구성 — 쪽 계획(plan.tsx)을 차례로 그린다(편집층 없는 기본본).
 * 스튜디오 편집본은 같은 쪽 계획을 노드 트리로 바꿔 편집층을 얹은 뒤 그린다(lib/catalog/studio/compose.ts).
 */
import { Fragment } from "react";
import type { CatalogRenderData, RenderCtx } from "../types";
import type { CoverChoice } from "./pages-front";
import { buildPagePlan } from "./plan";

export function CatalogDocument({ ctx, data, cover }: { ctx: RenderCtx; data: CatalogRenderData; cover: CoverChoice }) {
  return (
    <>
      {buildPagePlan(ctx, data, cover).map((p) => (
        <Fragment key={p.key}>{p.element}</Fragment>
      ))}
    </>
  );
}
