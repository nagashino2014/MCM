"use client";

// 조직도 편집 미리보기 — 스튜디오와 같은 지면(C12 조직 쪽)을 같은 CSS·서체·편집층으로 그리고 조직도만 지금 편집 중인 판으로 바꾼다(사용자 지시 2026-11-25).
// 데이터·편집층은 스튜디오가 여는 마스터본(/api/catalog/studio)을 한 번 받아 쓴다 — 통계(임직원·자문위원 수)와 쪽 꾸밈이 스튜디오 화면과 같다.

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import type { OrgChartDoc } from "@/lib/catalog/content-types";
import type { RenderCtx } from "@/lib/catalog/render/types";
import { usableFontSet } from "@/lib/catalog/fonts";
import { withAreaNames } from "@/lib/catalog/areas";
import { composePage, orderedPlan } from "@/lib/catalog/studio/compose";
import { pageState } from "@/lib/catalog/studio/doc";
import { registerIllustrations } from "@/lib/catalog/render/infographic/illustration";
import { catalogFetch } from "./catalogFetch";
import { loadStudioKit, type StudioKit } from "./studio/kit";
import { StaticFrame } from "./studio/Frames";
import { staticHtml } from "./studio/StudioThumbs";
import { previewUrl, type StudioPayload } from "./studio/useStudio";

/** 마스터본 문서 id(lib/catalog/projects MASTER_DOC_ID — 서버 모듈이라 값만 쓴다) */
const MASTER_DOC = "master";

export function CatalogOrgPreview({ draft }: { draft: OrgChartDoc }) {
  const [payload, setPayload] = useState<StudioPayload | null>(null);
  const [kit, setKit] = useState<StudioKit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [large, setLarge] = useState(false);

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ doc: MASTER_DOC, edition: "print", naming: "masked" });
    Promise.all([loadStudioKit(), catalogFetch<StudioPayload>(`/api/catalog/studio?${q}`)])
      .then(([k, p]) => {
        if (!alive) return;
        registerIllustrations(p.illustrations ?? []);
        setKit({ ...k, fontSets: p.fontSets ?? [] });
        setPayload(p);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const fontSet = payload ? usableFontSet(payload.doc.theme.fontSet, payload.fontSets).id : "";
  const html = useMemo(() => {
    if (!payload) return null;
    const theme = payload.doc.theme;
    const ctx: RenderCtx = { url: previewUrl, opts: payload.opts, docLabel: payload.data.docLabel, fontSet, concept: theme.concept, template: theme.template, motif: theme.motif };
    const data = withAreaNames({ ...payload.data, theme, orgChart: draft });
    const item = orderedPlan(ctx, data, payload.cover, payload.doc.pages).find((p) => p.key === "c12");
    if (!item) return null;
    const { tree } = composePage(item, pageState(payload.doc.pages, item.key), { metrics: data.metrics });
    return staticHtml(tree, { url: previewUrl, data });
  }, [payload, draft, fontSet]);

  if (error) return <p className="text-sm cd-error-text py-4 text-center">미리보기를 그리지 못했습니다: {error}</p>;
  if (!kit || !payload) return <p className="text-sm cd-text-faint py-6 text-center">미리보기를 불러오는 중…</p>;
  if (!html) return <p className="text-sm cd-text-faint py-6 text-center">이 소개서에는 조직 쪽이 없습니다.</p>;
  return (
    <>
      <div className="flex justify-end mb-1.5">
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setLarge(true)}>
          <Maximize2 className="w-3.5 h-3.5" /> 크게 보기
        </button>
      </div>
      <FitFrame kit={kit} fontSet={fontSet} html={html} title="조직 쪽 미리보기" />
      <CdModal open={large} onClose={() => setLarge(false)} title="조직 쪽 미리보기 — 스튜디오·PDF 와 같은 조판" size="xl" maxHeightClass="max-h-[92vh]">
        <div className="p-4 overflow-auto">
          <FitFrame kit={kit} fontSet={fontSet} html={html} title="조직 쪽 크게 보기" />
        </div>
      </CdModal>
    </>
  );
}

/** 칸 폭에 맞춘 A4 가로 지면(842×595pt) — 폭이 바뀌면 다시 잰다 */
function FitFrame({ kit, fontSet, html, title }: { kit: StudioKit; fontSet: string; html: string; title: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={boxRef} className="rounded-lg border cd-border-c overflow-hidden">
      {width > 2 ? <StaticFrame kit={kit} fontSet={fontSet} html={html} width={width - 2} title={title} /> : null}
    </div>
  );
}
