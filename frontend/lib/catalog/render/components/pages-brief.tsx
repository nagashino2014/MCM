/*
 * 회사소개서 C20 분야 1장 요약(요약·분야 브리프 템플릿, 계획서 §2 T4·§3-3) — AECOM 인허가 1장 방식.
 * 선택 분야(문서 설정 theme.areas)마다 한 장: 왼쪽 7열 = 핵심 서비스·강점, 오른쪽 5열 = 분야 KPI·대표 실적 3건·문의 연락처.
 * 숫자는 분야 상세(C09)와 같은 지표(areaKpis), 강점은 근거가 있는 집계 문장만(누적·최근 3년·권역·절차) — 근거 없는 최상급은 쓰지 않는다.
 * 마크업은 목업 C20Brief.dc.html 과 같다(.kc-brief, 쪽 루트 .kc-sheet--brief).
 */
import { cloneElement } from "react";
import type { MetricId } from "@/lib/catalog/metrics";
import { REGION_GROUPS } from "@/lib/catalog/regions";
import { AREA_CONTENT, SOFTWARE_CONTENT } from "../master-content";
import type { AreaInfo, CatalogRenderData, RenderCtx } from "../types";
import { areaKpis } from "./pages-business";
import { Foot, Head, Icon, Kpi, M, Sheet, asOfNote, fmt, mval } from "./parts";

/** 분야 1장 요약에 쓸 문안 — 상담 5분야는 분야 문안(AREA_CONTENT), 응용소프트웨어는 제품 목록 */
function briefContent(data: CatalogRenderData, area: AreaInfo) {
  const c = AREA_CONTENT[area.category];
  if (c) return { icon: c.icon, lead: c.lead, services: c.services.slice(0, 6), process: c.process.map((p) => p.label), processTitle: c.processTitle, casesAside: c.casesAside };
  const sw = SOFTWARE_CONTENT;
  return {
    icon: "layout-grid",
    lead: sw.lead,
    services: sw.products.map((p) => `${p.name} — ${p.pitch}`),
    process: [] as string[],
    processTitle: "",
    casesAside: "공급 계약",
  };
}

export function BriefPage({ ctx, data, area, seq }: { ctx: RenderCtx; data: CatalogRenderData; area: AreaInfo; seq: number }) {
  const c = briefContent(data, area);
  const sw = area.index === 6;
  const nowYear = Number(data.asOf.slice(0, 4));
  const hq = data.offices[0];
  const isPermit = area.index === 1;
  const strengths = [
    sw ? null : (
      <li key="total">
        {area.firstYear ? `${area.firstYear}년부터 ` : ""}누적 <b><M data={data} id={`projects.area.${area.index}` as MetricId} />건</b> 수행{area.completed ? `(준공 ${fmt(area.completed)}건)` : ""}
      </li>
    ),
    isPermit ? (
      <li key="ind">
        통합환경허가 수행 업종 <b><M data={data} id="permit.industries" />개</b> · 최초허가 <b><M data={data} id="permit.initial.completed" />건</b>
      </li>
    ) : sw ? (
      <li key="sw">
        자체 개발·공급 제품 <b><M data={data} id="software.products" />종</b> — KESI 실제 업무로 먼저 검증
      </li>
    ) : (
      <li key="recent">
        최근 3년({nowYear - 2}–) <b>{fmt(area.recent3)}건</b> · 수행 권역 {fmt(area.regions)}/{REGION_GROUPS.length}
      </li>
    ),
    c.process.length ? (
      <li key="proc">
        {c.processTitle}: {c.process.join(" → ")}
      </li>
    ) : null,
  ].filter(Boolean);
  const kpis = sw
    ? [
        <Kpi key="a" size="" label="제품" value={<M data={data} id="software.products" />} unit="종" />,
        <Kpi key="b" size="" label="공급 계약" value={fmt(area.count)} unit="건" />,
      ]
    : // 오른쪽 5열 2×2 — 분야 상세보다 한 단계 작은 숫자(오른쪽 단이 대표 실적·문의까지 담도록)
      areaKpis(data, area).map((k) => cloneElement(k, { size: "" }));
  return (
    <Sheet ctx={ctx} cls="kc-sheet--brief" area={area.index} anchors={[`area-${area.index}`, `brief-${area.index}`]} outline={`${area.name} 분야 요약`}>
      <Head ctx={ctx} num="02" name="사업 분야" sub={`${area.name} · 분야 요약`} />
      <div className="kc-titleblock">
        <p className="kc-eyebrow">분야 요약 {String(seq).padStart(2, "0")}</p>
        <div className="kc-bizhero__title">
          <span className="kc-iconbox">
            <Icon name={c.icon} cls="kc-icon kc-icon--lg" />
          </span>
          <p className="kc-page-title">{area.name}</p>
        </div>
        <p className="kc-lead">{c.lead}</p>
      </div>
      <div className="kc-brief">
        <div className="kc-brief__services">
          <p className="kc-blockhead">핵심 서비스</p>
          <ul className="kc-list" style={{ display: "grid", gridTemplateColumns: sw ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))", columnGap: 16 }}>
            {c.services.map((sv, i) => (
              <li key={i}>{sv}</li>
            ))}
          </ul>
        </div>
        <div className="kc-brief__kpis">{kpis}</div>
        {/* 왼쪽 7열 아래 — 강점과 문의를 한 단에(오른쪽 단은 숫자·대표 실적이 높아 문의까지 두면 쪽을 넘는다) */}
        <div style={{ gridColumn: "1 / span 7", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div className="kc-brief__strengths">
            <p className="kc-blockhead">강점</p>
            <ul className="kc-list">{strengths}</ul>
          </div>
          <div className="kc-brief__contact">
            <b>문의</b>
            <p>
              {data.company.name}
              {hq?.phone ? (
                <>
                  {" "}
                  · T <span className="kc-num">{hq.phone}</span>
                </>
              ) : null}
              {data.company.email ? ` · ${data.company.email}` : ""}
              {hq?.address ? (
                <>
                  <br />
                  {hq.name} {hq.address}
                </>
              ) : null}
            </p>
          </div>
        </div>
        {area.featured.length ? (
          <div className="kc-brief__cases">
            <p className="kc-blockhead">
              대표 실적<span className="kc-blockhead__aside">{c.casesAside}</span>
            </p>
            <ul className="kc-cases" data-widget="cases">
              {area.featured.slice(0, 3).map((f, i) => (
                <li key={i}>
                  <span className="kc-cases__year">{f.year}</span>
                  <span>{f.title}</span>
                  <span className="kc-cases__meta">{f.meta}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <Foot
        items={[
          `* ${asOfNote(data)} 자동 집계(누적 계약 수, 수행 중 포함). 대표 실적은 '대표 실적' 표시 계약 중 최근 3건입니다.${isPermit && mval(data, "market.permit.share") != null ? ` 허가 사업장 대비 비율 = 최초허가 ÷ 환경부 통합허가 완료 사업장 ${fmt(data.figures["permit.sites.total"])}개소.` : ""}`,
        ]}
      />
    </Sheet>
  );
}
