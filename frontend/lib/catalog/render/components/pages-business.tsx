/*
 * 회사소개서 사업·역량 쪽 유형 — C08 사업 분야 개관 · C09 사업 분야 상세(5분야 공용) · C09 응용소프트웨어 2쪽 · C10 핵심 역량 · C11 대표 성공 사례.
 * 마크업은 P2 쪽 유형 목업과 같다. 분야 상세의 히어로는 사진 없는 변형(분야 누적 실적 숫자)을 쓴다 — 분야 사진 자산이 아직 없다.
 */
import type { MetricId } from "@/lib/catalog/metrics";
import { REGION_GROUPS } from "@/lib/catalog/regions";
import {
  AREA_CONTENT,
  CASE_CONTENT,
  ORBIT_CENTER,
  PLATFORM_CONTENT,
  SOFTWARE_CONTENT,
  STRENGTHS_CONTENT,
  type AreaContent,
} from "../master-content";
import type { AreaInfo, CatalogRenderData, CustomAreaInfo, RenderCtx } from "../types";
import { barSpec, compareSpec, regionRows, stepsSpec } from "../infographic/adapt";
import { InfoSlot, InfoSource } from "../infographic/slot";
import type { InfoSpec } from "../infographic/types";
import { KoreaMap } from "./infographics";
import { AREA_ICON, AreaTag, Foot, Head, Icon, Kpi, M, Sheet, TitleBlock, asOfNote, cx, fmt, mval } from "./parts";

// ── C08 사업 분야 개관 ──
const ORBIT_POS = [
  { left: 0, top: 0, x2: 226, y2: 50 },
  { left: 520, top: 0, x2: 520, y2: 50 },
  { left: 0, top: 150, x2: 226, y2: 200 },
  { left: 520, top: 150, x2: 520, y2: 200 },
  { left: 0, top: 300, x2: 226, y2: 350 },
  { left: 520, top: 300, x2: 520, y2: 350 },
];

/** C08 원형 도식의 내용 — 스튜디오에서 유형을 바꾸거나 일러스트로 그릴 때 이 내용(분야명·누적 건수 지표·주요 서비스)이 그대로 간다 */
function businessMapSpec(data: CatalogRenderData): InfoSpec {
  return {
    type: "hub",
    content: {
      center: { label: ORBIT_CENTER[ORBIT_CENTER.length - 1], desc: ORBIT_CENTER.slice(0, -1).join(" ") },
      items: data.areas.map((a) => {
        const sw = a.index === 6;
        const bullets = sw ? SOFTWARE_CONTENT.products.map((p) => p.name) : AREA_CONTENT[a.category]?.overview ?? [];
        const products = sw && a.count === 0;
        // 서비스는 원래 카드처럼 한 줄에 하나
        return { id: `a${a.index}`, label: a.name, desc: bullets.join("\n"), metric: products ? "software.products" : `projects.area.${a.index}`, unit: products ? "종" : "건" };
      }),
    },
  };
}

/**
 * @param sectionStart 사업 분야 섹션의 첫 쪽(간지가 없는 brief 쪽 계획) — 섹션 북마크·목차 앵커를 이 쪽이 맡는다
 * @param linked 쪽이 있는 분야 번호(brief — 분야 1장 요약을 넣은 분야만 링크, 나머지 카드는 링크 없이)
 */
export function BusinessMapPage({ ctx, data, sectionStart, linked }: { ctx: RenderCtx; data: CatalogRenderData; sectionStart?: boolean; linked?: number[] }) {
  const consulting = data.areas.filter((a) => a.index <= 5).length;
  return (
    <Sheet ctx={ctx} anchors={sectionStart ? ["sec-02", "c08"] : ["c08"]} section={sectionStart ? "02 사업 분야" : undefined} outline="사업 분야 개관">
      <Head ctx={ctx} num="02" name="사업 분야" sub="사업 분야 개관" />
      <TitleBlock eyebrow="사업 분야 개관" title={`환경 컨설팅 ${consulting}분야와 응용소프트웨어로 사업장을 지원합니다`} />
      <InfoSource slot="c08.areas" spec={businessMapSpec(data)} box={{ w: 746, h: 400 }}>
      <div className="kc-ig kc-orbit" style={{ flex: 1, minHeight: 0 }}>
        <svg className="kc-orbit__svg" viewBox="0 0 746 420" preserveAspectRatio="none" aria-hidden="true">
          {ORBIT_POS.map((p, i) => (
            <line key={i} className="kc-orbit__spoke" x1="373" y1="205" x2={p.x2} y2={p.y2}></line>
          ))}
          <circle className="kc-orbit__track kc-orbit__track--dash" cx="373" cy="205" r="96"></circle>
        </svg>
        <div className="kc-orbit__center" style={{ left: 298, top: 130, width: 150, height: 150, background: "var(--field)", color: "var(--on-field)", fontSize: 12, lineHeight: "17px" }}>
          <span>
            {ORBIT_CENTER.map((l, i) => (
              <span key={i}>
                {i > 0 ? <br /> : null}
                {l}
              </span>
            ))}
          </span>
        </div>
        {data.areas.map((a, i) => {
          const pos = ORBIT_POS[i];
          const sw = a.index === 6;
          const bullets = sw ? SOFTWARE_CONTENT.products.map((p) => `${p.name}(${p.status === "개발 중" ? `${p.whenLabel} ${p.when}` : p.status})`) : AREA_CONTENT[a.category]?.overview ?? [];
          return (
            <a
              key={a.index}
              href="#"
              data-ref={!linked || linked.includes(a.index) ? `area-${a.index}` : undefined}
              className={`kc-orbit__card kc-area-${a.index}`}
              style={{ left: pos.left, top: pos.top, width: 226 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <AreaTag name={a.name} />
                <span className="kc-ig__fig" style={{ fontSize: 15 }}>
                  {sw && a.count === 0 ? (
                    <>
                      <M data={data} id="software.products" />
                      <small style={{ fontSize: 9 }}>종</small>
                    </>
                  ) : (
                    <>
                      <M data={data} id={`projects.area.${a.index}` as MetricId} />
                      <small style={{ fontSize: 9 }}>건</small>
                    </>
                  )}
                </span>
              </div>
              <ul className="kc-list">
                {bullets.map((b, j) => (
                  <li key={j}>{b}</li>
                ))}
              </ul>
            </a>
          );
        })}
      </div>
      </InfoSource>
      <Foot items={[`* ${asOfNote(data)}. 건수는 계약 관리 분류별 누적 계약 수(수행 중 포함, 기타 용역 포함)입니다. 응용소프트웨어는 제품 수이며, 공급 계약이 생기면 계약 건수로 셉니다.`]} />
    </Sheet>
  );
}

// ── C09 사업 분야 상세 ──
function regionBars(data: CatalogRenderData, category: string) {
  const sec = data.matrix.find((m) => m.category === category);
  const total = sec?.rows.find((r) => r.isTotal);
  if (!total) return [];
  return regionRows(total.byRegion);
}

/** 분야 KPI 4개 — 분야 상세(C09)와 분야 1장 요약(C20)이 같은 숫자를 쓴다 */
export function areaKpis(data: CatalogRenderData, area: AreaInfo) {
  const c: AreaContent = AREA_CONTENT[area.category];
  const isPermit = area.index === 1;
  const nowYear = Number(data.asOf.slice(0, 4));
  const share = mval(data, "market.permit.share");
  return isPermit
    ? [
        <Kpi key="a" label="최초허가" value={<M data={data} id="permit.initial.completed" />} unit="건" />,
        <Kpi key="b" label="변경허가·신고" value={<M data={data} id="permit.change.completed" />} unit="건" />,
        <Kpi key="c" label="수행 업종" value={<M data={data} id="permit.industries" />} unit="개" />,
        share != null ? (
          <Kpi key="d" label="허가 사업장 대비" value={<M data={data} id="market.permit.share" />} unit="%" />
        ) : (
          <Kpi key="d" label="통합허가 분야 수행" value={<M data={data} id="permit.contracts.total" />} unit="건" />
        ),
      ]
    : [
        <Kpi key="a" label="누적 수행" value={<M data={data} id={`projects.area.${area.index}` as MetricId} />} unit="건" />,
        <Kpi key="b" label="준공" value={fmt(area.completed)} unit="건" />,
        ...(c.extraKpis ?? []).slice(0, 2).map((k) => <Kpi key={k.label} label={k.label} value={k.value} unit={k.unit} />),
        ...(c.extraKpis?.length
          ? []
          : [
              <Kpi key="c" label={`최근 3년(${nowYear - 2}–)`} value={fmt(area.recent3)} unit="건" />,
              <Kpi key="d" label="수행 권역" value={fmt(area.regions)} unit={`/ ${REGION_GROUPS.length}`} />,
            ]),
      ];
}

/**
 * 분야 상세 변형(L2) — hero: figure(사진 없는 숫자, 기본) | photo(사진, photo = 이미지 키) | photo-wide(전폭 사진 띠, TP2) | none(사진 자리 없이 인포그래픽 확대, TP2).
 * photo·photo-wide 는 사진이 없으면 쪽 계획(resolveVariant)이 폴백 변형으로 바꿔 넘긴다. note = 폴백 안내
 */
export function AreaPage({ ctx, data, area, variant, note }: { ctx: RenderCtx; data: CatalogRenderData; area: AreaInfo; variant?: Record<string, string>; note?: string }) {
  const hero = variant?.hero ?? "figure";
  const heroPhoto = (hero === "photo" || hero === "photo-wide") && variant?.photo ? variant.photo : null;
  const heroCls = hero === "photo-wide" && heroPhoto ? "kc-bizhero kc-bizhero--photo-wide" : hero === "none" ? "kc-bizhero kc-bizhero--none" : "kc-bizhero";
  const c: AreaContent = AREA_CONTENT[area.category];
  const isPermit = area.index === 1;
  const isEsg = area.index === 4;
  const heroMetric: MetricId = isPermit ? "permit.contracts.total" : (`projects.area.${area.index}` as MetricId);
  const share = mval(data, "market.permit.share");
  const kpis = areaKpis(data, area);
  const regions = !isPermit && !isEsg ? regionBars(data, area.category) : [];
  return (
    <Sheet ctx={ctx} area={area.index} anchors={[`area-${area.index}`]} outline={area.name} note={note} style={{ gap: 16 }}>
      <Head ctx={ctx} num="02" name="사업 분야" sub={area.name} />
      <section className={heroCls}>
        <div className="kc-bizhero__text">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <p className="kc-eyebrow">사업 분야 {String(area.index).padStart(2, "0")}</p>
            {c.draft ? <span className="kc-draftmark">초안 · 현행 카탈로그 사업 목록으로 쓴 문안 — 검토 필요</span> : null}
          </div>
          <div className="kc-bizhero__title">
            <span className="kc-iconbox">
              <Icon name={c.icon} cls="kc-icon kc-icon--lg" />
            </span>
            <p className="kc-page-title">{area.name}</p>
          </div>
          <p className="kc-lead" style={{ fontSize: 12, lineHeight: "19px" }}>
            {c.lead}
          </p>
        </div>
        <div className="kc-bizhero__visual">
          {heroPhoto ? (
            <div className="kc-photo kc-photo--frame" style={{ position: "absolute", inset: 0 }}>
              <img src={ctx.url(heroPhoto)} alt={`${area.name} 사진`} />
            </div>
          ) : (
            <div className="kc-nophoto kc-photo--frame" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 14, padding: "0 22px" }}>
              <div style={{ display: "flex", flexDirection: "column", position: "relative", zIndex: 1 }}>
                {c.heroFigure ? (
                  <>
                    <span className="kc-caption" style={{ color: "var(--ink)" }}>
                      {c.heroCaption}
                    </span>
                    <span className="kc-ig__fig" style={{ fontSize: 40, lineHeight: "46px", letterSpacing: -1 }}>
                      {c.heroFigure.value}
                      <small style={{ fontSize: 14, marginLeft: 2 }}>{c.heroFigure.unit}</small>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="kc-ig__fig" style={{ fontSize: 52, lineHeight: "54px", letterSpacing: -1.5 }}>
                      <M data={data} id={heroMetric} />
                      <small style={{ fontSize: 16, marginLeft: 2 }}>건</small>
                    </span>
                    <span className="kc-caption" style={{ color: "var(--ink)" }}>
                      {c.heroCaption}
                      {area.firstYear ? `(${area.firstYear}–${data.asOf.slice(0, 4)}.${Number(data.asOf.slice(5, 7))})` : ""}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
      <div className="kc-grid" style={{ flex: 1, minHeight: 0, alignContent: "start" }}>
        <div className="kc-span-4" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <p className="kc-blockhead">주요 서비스</p>
            <ul className="kc-list">
              {c.services.map((sv, i) => (
                <li key={i}>{sv}</li>
              ))}
            </ul>
          </div>
          {isPermit && data.permitIndustries.length ? (
            <div>
              <p className="kc-blockhead">수행 업종</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }} data-widget="chips">
                {data.permitIndustries.slice(0, 12).map((l) => (
                  <span key={l} className="kc-badge kc-badge--soft">
                    {l}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {isEsg && c.compare ? (
            <div>
              <p className="kc-blockhead">
                {c.compare.title}
                <span className="kc-blockhead__aside">{c.compare.aside}</span>
              </p>
              <InfoSlot slot={`area-${area.index}.compare`} spec={compareSpec(c.compare.rows)} box={{ w: 233, h: 80 }} area={area.index} />
            </div>
          ) : null}
          {regions.length ? (
            <div className="kc-ig">
              <p className="kc-blockhead">
                권역별 수행<span className="kc-blockhead__aside">계약 수</span>
              </p>
              <InfoSlot slot={`area-${area.index}.regions`} spec={barSpec(regions)} box={{ w: 233, h: 110 }} area={area.index} />
            </div>
          ) : null}
        </div>
        <div className="kc-span-8" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <p className="kc-blockhead">{c.processTitle}</p>
            <InfoSlot slot={`area-${area.index}.process`} spec={stepsSpec(c.process)} box={{ w: 490, h: hero === "none" ? 120 : 90 }} area={area.index} />
          </div>
          <div className="kc-kpis" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            {kpis}
          </div>
          {area.featured.length ? (
            <div>
              <p className="kc-blockhead">
                대표 실적<span className="kc-blockhead__aside">{c.casesAside}</span>
              </p>
              <ul className="kc-cases" data-widget="cases">
                {area.featured.map((f, i) => (
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
      </div>
      <Foot
        items={[
          `* ${asOfNote(data)} 자동 집계(누적 계약 수, 수행 중 포함).${isPermit && share != null ? ` 허가 사업장 대비 비율 = 최초허가 ÷ 환경부 통합허가 완료 사업장 ${fmt(data.figures["permit.sites.total"])}개소.` : ""}${c.footnote ? " " + c.footnote : ""}`,
        ]}
      />
    </Sheet>
  );
}

/** 문안 속 {{metric:지표 id}} → 지표 값 칩(작업본 점선 밑줄) — 새 사업 분야 문안은 숫자를 지표로만 쓴다(블루프린트 §7-2) */
function MetricText({ data, text }: { data: CatalogRenderData; text: string }) {
  const parts = text.split(/\{\{metric:([a-z0-9.]{1,40})\}\}/);
  return <>{parts.map((p, i) => (i % 2 === 1 ? data.metrics[p as MetricId] ? <M key={i} data={data} id={p as MetricId} /> : null : p))}</>;
}

// ── C09 새 사업 분야(P6) — 분야 상세와 같은 틀, 문안은 catalog_business_areas.content ──
export function CustomAreaPage({ ctx, data, area }: { ctx: RenderCtx; data: CatalogRenderData; area: CustomAreaInfo }) {
  const c = area.content;
  const kpiIds = c.kpis.filter((id) => data.metrics[id as MetricId]) as MetricId[];
  const hero = kpiIds[0];
  return (
    <Sheet ctx={ctx} area={area.slot} anchors={[area.key]} outline={area.name} style={{ gap: 16 }}>
      <Head ctx={ctx} num="02" name="사업 분야" sub={area.name} />
      <section className="kc-bizhero">
        <div className="kc-bizhero__text">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <p className="kc-eyebrow">사업 분야</p>
            {c.draft ? <span className="kc-draftmark">초안 · 새 사업 분야 — 검토 필요</span> : null}
          </div>
          <div className="kc-bizhero__title">
            <span className="kc-iconbox">
              <Icon name={c.icon} cls="kc-icon kc-icon--lg" />
            </span>
            <p className="kc-page-title">{area.name}</p>
          </div>
          <p className="kc-lead" style={{ fontSize: 12, lineHeight: "19px" }}>
            <MetricText data={data} text={c.lead} />
          </p>
        </div>
        <div className="kc-bizhero__visual">
          <div className="kc-nophoto kc-photo--frame" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 14, padding: "0 22px" }}>
            <div style={{ display: "flex", flexDirection: "column", position: "relative", zIndex: 1 }}>
              {hero ? (
                <span className="kc-ig__fig" style={{ fontSize: 52, lineHeight: "54px", letterSpacing: -1.5 }}>
                  <M data={data} id={hero} />
                  <small style={{ fontSize: 16, marginLeft: 2 }}>{data.metrics[hero].unit}</small>
                </span>
              ) : null}
              <span className="kc-caption" style={{ color: "var(--ink)" }}>
                <MetricText data={data} text={c.heroCaption || (hero ? data.metrics[hero].label : area.name)} />
              </span>
            </div>
          </div>
        </div>
      </section>
      <div className="kc-grid" style={{ flex: 1, minHeight: 0, alignContent: "start" }}>
        <div className="kc-span-4" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <p className="kc-blockhead">주요 서비스</p>
            <ul className="kc-list">
              {c.services.map((sv, i) => (
                <li key={i}>
                  <MetricText data={data} text={sv} />
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="kc-span-8" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <p className="kc-blockhead">{c.processTitle}</p>
            <InfoSlot slot={`${area.key}.process`} spec={{ ...stepsSpec(c.process), type: c.infoType }} box={{ w: 490, h: 90 }} area={area.slot} />
          </div>
          {kpiIds.length ? (
            <div className="kc-kpis" style={{ gridTemplateColumns: `repeat(${Math.max(2, kpiIds.length)}, minmax(0, 1fr))`, gap: 10 }}>
              {kpiIds.map((id) => (
                <Kpi key={id} label={data.metrics[id].label} value={<M data={data} id={id} />} unit={data.metrics[id].unit} />
              ))}
            </div>
          ) : null}
          {area.featured.length ? (
            <div>
              <p className="kc-blockhead">
                대표 실적<span className="kc-blockhead__aside">{c.casesAside}</span>
              </p>
              <ul className="kc-cases" data-widget="cases">
                {area.featured.map((f, i) => (
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
      </div>
      <Foot items={[`* ${asOfNote(data)} 자동 집계. 지표 정의: ${kpiIds.map((id) => data.metrics[id].footnote).join(" ") || "—"}`]} />
    </Sheet>
  );
}

// ── C09 응용소프트웨어 ──
export function SoftwarePage({ ctx, data, area }: { ctx: RenderCtx; data: CatalogRenderData; area: AreaInfo }) {
  const c = SOFTWARE_CONTENT;
  return (
    <Sheet ctx={ctx} area={6} anchors={[`area-${area.index}`, "c09-software"]} outline={area.name}>
      <Head ctx={ctx} num="02" name="사업 분야" sub={area.name} />
      <TitleBlock eyebrow={c.eyebrow} title={c.title} lead={c.lead} />
      <div className="kc-sw">
        {c.products.map((p) => (
          <section key={p.name} className={cx("kc-sw__card", p.area ? `kc-area-${p.area}` : null)}>
            <div className="kc-sw__top">
              <span className="kc-iconbox">
                <Icon name={p.icon} />
              </span>
              <span className="kc-sw__name">{p.name}</span>
            </div>
            <span className="kc-badge kc-badge--soft" style={{ alignSelf: "flex-start" }}>
              {p.status}
            </span>
            <p className="kc-sw__pitch">{p.pitch}</p>
            <ul className="kc-sw__list">
              {p.points.map((pt, i) => (
                <li key={i}>{pt}</li>
              ))}
            </ul>
            <div className="kc-sw__when">
              <span>{p.whenLabel}</span>
              <b>{p.when}</b>
            </div>
          </section>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "150px minmax(0, 1fr)", gap: "var(--grid-gutter)", alignItems: "start" }}>
        <p className="kc-blockhead" style={{ margin: "14px 0 0", border: 0 }}>
          출시 일정<span className="kc-blockhead__aside">{c.milesAside}</span>
        </p>
        <ol className="kc-miles">
          {c.miles.map((m, i) => (
            <li key={i} className={m.area ? `kc-area-${m.area}` : undefined}>
              <b>{m.when}</b>
              {m.text}
            </li>
          ))}
        </ol>
      </div>
      <Foot items={[`* ${c.note} 제품 수 ${fmt(mval(data, "software.products"))}종(지표 software.products).`]} />
    </Sheet>
  );
}

/** C09 플랫폼 5단계 파이프라인의 내용(되돌이 포함) */
function platformSpec(): InfoSpec {
  const c = PLATFORM_CONTENT;
  return {
    type: "process",
    variant: "h",
    content: { title: c.loop, items: c.steps.map((st) => ({ id: `s${st.num}`, label: st.title, sub: st.num, desc: st.items.join("\n"), icon: st.icon, ...(st.core ? { key: true } : {}) })) },
  };
}

export function PlatformPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const c = PLATFORM_CONTENT;
  const caption = c.caption
    .replace("{industries}", fmt(mval(data, "permit.industries")))
    .replace("{initial}", fmt(mval(data, "permit.initial.completed")));
  return (
    <Sheet ctx={ctx} area={6} anchors={["c09-platform"]} outline="통합허가 계획서 플랫폼">
      <Head ctx={ctx} num="02" name="사업 분야" sub="통합허가 플랫폼" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
        <TitleBlock eyebrow={c.eyebrow} title={c.title} />
        <span className="kc-badge kc-badge--soft" style={{ flex: "none", marginBottom: 6 }}>
          {c.badge}
        </span>
      </div>
      <InfoSource slot="c09-platform.pipeline" spec={platformSpec()} box={{ w: 746, h: 150 }} area={6}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="kc-pipe">
          <div className="kc-pipe__src">
            <p>원천 자료</p>
            {c.sources.map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
          {c.steps.map((st) => (
            <div key={st.num} className={cx("kc-pipe__step", st.core && "kc-pipe__step--core")}>
              <div className="kc-pipe__head">
                <Icon name={st.icon} />
                <span className="kc-pipe__num">{st.num}</span>
              </div>
              <span className="kc-pipe__title">{st.title}</span>
              <ul>
                {st.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="kc-pipe__loop" aria-hidden="true">
          <svg viewBox="0 0 746 26" preserveAspectRatio="none">
            <path d="M680 0 V16 H263 V5"></path>
            <path className="kc-pipe__arrowhead" d="M259 6 L263 0 L267 6 Z"></path>
          </svg>
          <span style={{ left: 471 }}>{c.loop}</span>
        </div>
      </div>
      </InfoSource>
      <div className="kc-grid" style={{ flex: 1, minHeight: 0, rowGap: 0, alignItems: "start" }}>
        <section className="kc-span-7" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p className="kc-blockhead" style={{ margin: 0 }}>
            핵심 자동화<span className="kc-blockhead__aside">시간이 가장 많이 드는 작업부터</span>
          </p>
          <div className="kc-auto">
            {c.automation.map((a) => (
              <div key={a.title}>
                <span className="kc-iconbox">
                  <Icon name={a.icon} />
                </span>
                <b>{a.title}</b>
                <span>{a.desc}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="kc-span-5" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p className="kc-blockhead" style={{ margin: 0 }}>
            기대효과
          </p>
          <div className="kc-fx">
            {c.effects.map((e) => (
              <div key={e.title}>
                <b>{e.title}</b>
                <span>{e.desc}</span>
              </div>
            ))}
          </div>
          <p className="kc-blockhead" style={{ margin: "4px 0 0" }}>
            개발 일정
          </p>
          <ol className="kc-miles" style={{ paddingTop: 6 }}>
            {c.miles.map((m) => (
              <li key={m.when} className={m.done ? "is-done" : undefined}>
                <b>{m.when}</b>
                {m.text}
              </li>
            ))}
          </ol>
        </section>
      </div>
      <p className="kc-caption">{caption}</p>
    </Sheet>
  );
}

// ── C10 핵심 역량 ──
/** C10 ② 사람 — 큰 숫자 3개(공정전문가·임원 평균 경력·자문위원) */
function strengthsPeopleSpec(data: CatalogRenderData): InfoSpec {
  const c = STRENGTHS_CONTENT.people;
  return {
    type: "stats",
    variant: "row",
    content: {
      title: c.head,
      items: [
        { id: "process", label: c.process.label, desc: c.process.desc, value: Number(c.process.value), unit: c.process.unit, icon: "factory" },
        { id: "leaders", label: c.leaders.label, desc: c.leaders.desc, value: data.leaderAvgCareer ?? undefined, unit: "년", icon: "award" },
        { id: "advisors", label: c.advisors.label, desc: c.advisors.desc, value: mval(data, "advisors.total") ?? undefined, unit: "명", metric: "advisors.total", icon: "network" },
      ],
    },
  };
}

/** C10 ③ 방법 — 진단·협의·사후관리 3단계 + 되돌이 */
function strengthsMethodSpec(): InfoSpec {
  const c = STRENGTHS_CONTENT.method;
  return {
    type: "process",
    variant: "h",
    content: {
      title: c.loop,
      items: c.steps.map((st) => ({
        id: st.tag,
        label: st.title,
        sub: st.tag,
        desc: "checks" in st && st.checks ? st.checks.join("\n") : "desc" in st ? st.desc : "",
        icon: st.icon,
      })),
    },
  };
}

/** 핵심 역량 변형(TP2) — cards: compact(기본) | icon-large(아이콘 큰 변형). sectionStart = 간지 없는 brief 쪽 계획에서 섹션 첫 쪽 */
export function StrengthsPage({ ctx, data, variant, sectionStart }: { ctx: RenderCtx; data: CatalogRenderData; variant?: Record<string, string>; sectionStart?: boolean }) {
  const c = STRENGTHS_CONTENT;
  const industries = fmt(mval(data, "permit.industries"));
  return (
    <Sheet ctx={ctx} anchors={sectionStart ? ["sec-03", "c10"] : ["c10"]} section={sectionStart ? "03 핵심 역량" : undefined} outline="핵심 역량">
      <Head ctx={ctx} num="03" name="핵심 역량" />
      <TitleBlock eyebrow="핵심 역량" title={c.title} />
      <div className={variant?.cards === "icon-large" ? "kc-strengths kc-strengths--icon-large" : "kc-strengths"}>
        <section className="kc-strengths__hero">
          <p className="kc-strengths__tag">
            <b>01</b>실적
          </p>
          <p className="kc-strengths__head">{c.results.head.replace("{industries}", industries)}</p>
          <div className="kc-strengths__fig">
            <b data-metric="permit.initial.completed">
              {fmt(mval(data, "permit.initial.completed"))}
              <small>건</small>
            </b>
            <span>통합환경허가 최초허가</span>
          </div>
          <div className="kc-strengths__fig kc-strengths__fig--m">
            <b data-metric="permit.change.completed">
              {fmt(mval(data, "permit.change.completed"))}
              <small>건</small>
            </b>
            <span>변경허가·변경신고</span>
          </div>
          <div className="kc-strengths__chips">
            <p>{c.results.chipsLabel}</p>
            {data.permitIndustries.slice(0, 11).map((l) => (
              <span key={l}>{l}</span>
            ))}
          </div>
        </section>
        <section className="kc-strengths__people">
          <p className="kc-strengths__tag">
            <b>02</b>사람
          </p>
          <p className="kc-strengths__head">{c.people.head}</p>
          <InfoSource slot="c10.people" spec={strengthsPeopleSpec(data)} box={{ w: 360, h: 150 }}>
          <div className="kc-strengths__trio">
            <div className="kc-strengths__person">
              <span className="kc-strengths__num">
                {c.people.process.value}
                <small>{c.people.process.unit}</small>
              </span>
              <span className="kc-strengths__label">
                <Icon name="factory" />
                {c.people.process.label}
              </span>
              <p className="kc-strengths__desc">{c.people.process.desc}</p>
            </div>
            <div className="kc-strengths__person">
              <span className="kc-strengths__num">
                {fmt(data.leaderAvgCareer)}
                <small>년</small>
              </span>
              <span className="kc-strengths__label">
                <Icon name="award" />
                {c.people.leaders.label}
              </span>
              <p className="kc-strengths__desc">{c.people.leaders.desc}</p>
            </div>
            <div className="kc-strengths__person">
              <span className="kc-strengths__num" data-metric="advisors.total">
                {fmt(mval(data, "advisors.total"))}
                <small>명</small>
              </span>
              <span className="kc-strengths__label">
                <Icon name="network" />
                {c.people.advisors.label}
              </span>
              <p className="kc-strengths__desc">{c.people.advisors.desc}</p>
            </div>
          </div>
          </InfoSource>
        </section>
        <section className="kc-strengths__method">
          <p className="kc-strengths__tag">
            <b>03</b>
            {c.method.head}
          </p>
          <InfoSource slot="c10.method" spec={strengthsMethodSpec()} box={{ w: 460, h: 140 }}>
          <ol className="kc-strengths__flow">
            {c.method.steps.map((st) => (
              <li key={st.tag}>
                <div className="kc-strengths__step">
                  <span className="kc-iconbox">
                    <Icon name={st.icon} />
                  </span>
                  <small>{st.tag}</small>
                </div>
                <span className="kc-card__title">{st.title}</span>
                {"checks" in st && st.checks ? (
                  <ul className="kc-strengths__checks">
                    {st.checks.map((ck) => (
                      <li key={ck}>
                        <Icon name="check" />
                        {ck}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="kc-card__desc">{"desc" in st ? st.desc : ""}</p>
                )}
                {"proof" in st && st.proof ? <span className="kc-card__proof">{st.proof}</span> : null}
              </li>
            ))}
          </ol>
          </InfoSource>
          <div className="kc-strengths__loop" aria-hidden="true">
            <svg viewBox="0 0 458 18" preserveAspectRatio="none">
              <path d="M398 0 V10 H18 V5"></path>
              <path className="kc-strengths__arrowhead" d="M14 6 L18 0 L22 6 Z"></path>
            </svg>
            <span>{c.method.loop}</span>
          </div>
        </section>
      </div>
      <Foot
        items={[
          `* ${asOfNote(data)} 자동 집계. 임원 평균 경력은 임원진 쪽에 싣는 임원(촉탁 포함)의 경력 연수 평균, 업종은 통합환경허가 수행 업종 ${industries}개 중 계약이 많은 순입니다. 협의 성과는 수행 사례에서 확인된 항목만 싣습니다.`,
        ]}
      />
    </Sheet>
  );
}

// ── C11 대표 성공 사례 ──
export function CasePage({ ctx }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const c = CASE_CONTENT;
  const pins = c.list.filter((x) => x.lon != null && x.lat != null).map((x) => ({ lon: x.lon as number, lat: x.lat as number, num: x.num }));
  return (
    <Sheet ctx={ctx} area={1} anchors={["c11"]} outline="대표 성공 사례">
      <Head ctx={ctx} num="03" name="핵심 역량" sub="대표 성공 사례" />
      <div className="kc-grid" style={{ flex: 1, minHeight: 0 }}>
        <article className="kc-span-8" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="kc-case">
            <span className="kc-case__num">{c.num}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
              <p className="kc-eyebrow">{c.eyebrow}</p>
              <p className="kc-page-title" style={{ fontSize: 21, lineHeight: "28px" }}>
                {c.title}
              </p>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {c.badges.map((b) => (
                  <span key={b} className="kc-badge kc-badge--soft">
                    {b}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="kc-case__steps">
            {c.steps.map((st) => (
              <div className="kc-case__step" key={st.head}>
                <p className="kc-case__steph">{st.head}</p>
                <p>{st.text}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="kc-blockhead">
              {c.permitsTitle}
              <span className="kc-blockhead__aside">근거 법령</span>
            </p>
            <ul className="kc-icongrid kc-ig" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "6px 24px" }}>
              {c.permits.map((p) => (
                <li key={p.label} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="check" cls="kc-icon kc-icon--sm" style={{ color: "var(--area)" }} />
                  <span>
                    <span className="kc-ig__label">{p.label}</span> <span className="kc-ig__desc">{p.law}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="kc-kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: "auto" }}>
            {c.kpis.map((k) => (
              <Kpi key={k.label} label={k.label} value={k.value} unit={k.unit} />
            ))}
          </div>
        </article>
        <aside className="kc-span-4" style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 20, borderLeft: "var(--stroke-hair) solid var(--rule)" }}>
          <p className="kc-blockhead">
            대표 사례 {c.list.length}선<span className="kc-blockhead__aside">위치</span>
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            <KoreaMap mode="pins" area={1} pins={pins} zoom={0.72} frame={{ width: 120, height: 215 }} root={{ "data-widget": "map" }} />
            <p className="kc-caption" style={{ alignSelf: "flex-end" }}>
              번호는 아래 목록과 같습니다. 고객이 공개에 동의한 사례만 지명을 씁니다.
            </p>
          </div>
          <ol className="kc-cases" style={{ marginTop: 2 }}>
            {c.list.map((x) => (
              <li key={x.num} style={{ gridTemplateColumns: "20px minmax(0, 1fr)" }} className={x.area !== 1 ? `kc-area-${x.area}` : undefined}>
                <span className="kc-cases__year">{x.num}</span>
                <span>
                  <b>{x.title}</b>
                  <span className="kc-table__sub">{x.sub}</span>
                </span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </Sheet>
  );
}

export { AREA_ICON };
