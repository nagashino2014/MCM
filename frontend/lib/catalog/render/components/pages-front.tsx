/*
 * 회사소개서 앞부분 쪽 유형 — C01 표지 · C02 목차 · C03 인사말 · C04 숫자로 보는 KESI · C05 회사 개요 · C06 연혁 · C07 간지.
 * 마크업은 P2 쪽 유형 목업(.dc.html)과 같다. 목업의 사진 자리 표시(kc-photo__label)는 발행본에 넣지 않고 사진 없는 변형을 쓴다.
 */
import type { CoverDesign } from "@/lib/catalog/document-theme";
import type { CSSProperties, ReactNode } from "react";
import { COVER_CONTENT, DIVIDER_CONTENT, VISION_CONTENT } from "../master-content";
import type { CatalogRenderData, HistoryYear, RenderCtx } from "../types";
import { Timeline } from "./infographics";
import { cardsSpec } from "../infographic/adapt";
import { InfoSlot, InfoSource } from "../infographic/slot";
import type { InfoItem, InfoSpec } from "../infographic/types";
import type { MetricId } from "@/lib/catalog/metrics";
import { AreaTag, Contour, DIVIDER_CONTOUR, Drop, Foot, Head, Icon, Kpi, M, Notes, Ring, Sheet, TitleBlock, asOfNote, fmt, mval, planOf, secNum, sectionsFor } from "./parts";

const LOGO = "k/assets/kesi-signature-ko.png";
/** 사진 위 판(E 전면 사진 표지)용 흰 로고 */
const LOGO_WHITE = "k/assets/kesi-en-horizontal-white.png";
const LOGO_ALT = "KESI ㈜한국환경안전연구원 Korean Environment Safety Institute Co. LTD";

export interface CoverChoice {
  /** 표지 안 — lib/catalog/document-theme.ts COVER_DESIGNS 와 같은 집합(G 연구소형 research 포함) */
  cover: CoverDesign;
  photo: string | null;
}

// ── C01 표지(7안: A 잎 창·B 세 기둥·C 중앙 정렬·D 사진 띠·E 전면 사진·F 그래픽·G 연구소형) ──
// E 전면 사진은 사진(인쇄 해상도 판정을 통과한 것)이 없으면 F 그래픽으로 그리고 쪽 검사에 안내를 남긴다(템플릿 폴백, 계획서 §3-3).
export function CoverPage({ ctx, data, choice }: { ctx: RenderCtx; data: CatalogRenderData; choice: CoverChoice }) {
  const areaList = (style: CSSProperties) => (
    <ul className="kc-front__areas" style={{ position: "absolute", ...style }}>
      {data.areas.map((a) => (
        <li key={a.index} className={`kc-area-${a.index}`}>
          {a.name}
        </li>
      ))}
    </ul>
  );
  const block = (style: CSSProperties, extra?: ReactNode) => (
    <div className="kc-front__block" style={{ position: "absolute", ...style }}>
      <span className="kc-front__eyebrow">{COVER_CONTENT.eyebrow}</span>
      <p className="kc-front__title">
        {COVER_CONTENT.title}{" "}
        <small>{COVER_CONTENT.titleEn}</small>
      </p>
      {extra}
      <p className="kc-front__company">{data.company.name}</p>
      <p className="kc-front__tagline">{COVER_CONTENT.tagline}</p>
    </div>
  );
  const meta = (style: CSSProperties) => (
    <div className="kc-front__meta" style={{ position: "absolute", ...style }}>
      <b>{data.asOfLabel}</b>
      {data.company.website ? <span>{data.company.website}</span> : null}
    </div>
  );
  const logo = (style: CSSProperties) => <img className="kc-front__logo" src={ctx.url(LOGO)} alt={LOGO_ALT} style={{ position: "absolute", ...style }} />;
  const photo = choice.photo ? ctx.url(choice.photo) : null;
  const caption = (style: CSSProperties) => (photo ? <span className="kc-caption" style={{ position: "absolute", ...style }}>{COVER_CONTENT.photoCaption}</span> : null);
  let body: ReactNode;
  // E 전면 사진인데 사진이 없으면 F 그래픽(포토 에디토리얼의 폴백 = 인포그래픽형 표지)
  const cover = choice.cover === "photo" && !photo ? "graphic" : choice.cover;
  const note = cover !== choice.cover ? "사진 없음 — E 전면 사진 대신 F 그래픽 표지로 그림" : undefined;
  const motif = ctx.motif ?? "drop";
  if (cover === "photo") {
    // E 전면 사진: 사진 전면 + 아래 반투명 판 위에 글·흰 로고(사진 위 배치 금지 — 판 위에만)
    body = (
      <>
        <div className="kc-front__full" style={{ position: "absolute" }}>
          <img src={photo!} alt={COVER_CONTENT.photoAlt} />
        </div>
        <div className="kc-front__plate" style={{ position: "absolute" }}></div>
        {block({ left: 56, top: 372, width: 520 })}
        {areaList({ left: 56, top: 506, width: 600 })}
        {meta({ left: 56, bottom: 40, width: 330 })}
        <img className="kc-front__logo" src={ctx.url(LOGO_WHITE)} alt={LOGO_ALT} style={{ position: "absolute", right: 56, bottom: 40, width: 150 }} />
      </>
    );
  } else if (cover === "graphic") {
    // F 그래픽(10-29 재설계): 왼쪽 글 단 + 오른쪽 모티프 궤도(링 = 두 색 호 + 동심 링, 물방울 = 큰 물방울 + 윤곽, 등고선 = 등고선 면) + 분야 6색 노드, 아래 주색 선
    body = (
      <>
        {logo({ left: 56, top: 46, width: 230 })}
        {block({ left: 56, top: 176, width: 340 })}
        {areaList({ left: 56, top: 420, width: 340 })}
        {meta({ left: 56, bottom: 40, width: 330 })}
        <div className="kc-front__orbit">
          {motif === "ring" ? (
            <>
              <Ring mods="kc-front__orbit-ring" />
              <Ring mods="kc-ring--concentric kc-front__orbit-inner" />
            </>
          ) : motif === "contour" ? (
            <span className="kc-contour-field kc-front__orbit-field" aria-hidden="true"></span>
          ) : (
            <>
              <Drop mods="kc-front__orbit-drop" />
              <Drop mods="kc-drop--line kc-drop--tl kc-front__orbit-drop kc-front__orbit-drop--line" />
            </>
          )}
          {data.areas.map((a) => (
            <span key={a.index} className={`kc-front__orbit-node kc-area-${a.index}`} aria-hidden="true"></span>
          ))}
        </div>
        <div className="kc-front__band-field" style={{ position: "absolute" }}></div>
      </>
    );
  } else if (cover === "strips") {
    const pillars = [
      { left: 434, top: 140, height: 400, pos: "-20px -84px", fill: "var(--brand-tint)" },
      { left: 558, top: 56, height: 440, pos: "-144px 0px", fill: "var(--field)", lead: true },
      { left: 682, top: 100, height: 454, pos: "-268px -44px", fill: "var(--area-1-tint)" },
    ];
    body = (
      <>
        {logo({ left: 56, top: 46, width: 230 })}
        {block({ left: 56, top: 176, width: 330 })}
        {areaList({ left: 56, top: 420, width: 330 })}
        {meta({ left: 56, bottom: 40, width: 330 })}
        {pillars.map((p, i) => (
          <div
            key={i}
            className={p.lead ? "kc-front__pillar kc-front__pillar--lead" : "kc-front__pillar"}
            style={{
              position: "absolute",
              left: p.left,
              top: p.top,
              width: 112,
              height: p.height,
              ...(photo ? { backgroundImage: `url(${photo})`, backgroundSize: "400px auto", backgroundPosition: p.pos } : { background: p.fill }),
            }}
          ></div>
        ))}
        <Drop mods="kc-drop--bl" style={{ position: "absolute", width: 40, left: 452, top: 86 }} />
        <Drop mods="kc-drop--blue" style={{ position: "absolute", width: 15, left: 500, top: 72 }} />
        {caption({ right: 48, top: 566 })}
      </>
    );
  } else if (cover === "center") {
    body = (
      <>
        <div className="kc-front__frame" style={{ position: "absolute" }}></div>
        {logo({ left: 311, top: 64, width: 220 })}
        {block({ left: 121, top: 168, width: 600 }, <Drop mods="kc-drop--bl" style={{ width: 14, margin: "6px 0 2px" }} />)}
        {areaList({ left: 96, top: 446, width: 650 })}
        {meta({ left: 271, bottom: 54, width: 300 })}
      </>
    );
  } else if (cover === "research") {
    // G 연구소형(연구소·ESG 제안형 양식): 왼쪽 연한 하늘빛 면 + 자간 넓은 제목·밑줄 + 부설연구소 부제, 오른쪽 사옥 사진(옅게)
    body = (
      <>
        <div className="kc-front__wash" style={{ position: "absolute" }}></div>
        <div className="kc-front__photo-half" style={{ position: "absolute" }}>
          {photo ? <img src={photo} alt={COVER_CONTENT.photoAlt} /> : null}
        </div>
        <span className="kc-front__eyebrow kc-front__eyebrow--en" style={{ position: "absolute", left: 48, top: 40 }}>
          {COVER_CONTENT.researchEyebrow}
        </span>
        <div className="kc-front__block" style={{ position: "absolute", left: 48, top: 214, width: 400 }}>
          <p className="kc-front__title">{COVER_CONTENT.title}</p>
          <span className="kc-front__rule"></span>
          <p className="kc-front__company">{data.company.name}</p>
          <p className="kc-front__sub">- {COVER_CONTENT.researchSub} -</p>
        </div>
        {meta({ left: 48, bottom: 100, width: 400 })}
        {logo({ right: 40, bottom: 28, width: 190 })}
      </>
    );
  } else if (cover === "band") {
    body = (
      <>
        <div className="kc-front__band" style={{ position: "absolute" }}>
          {photo ? (
            <img src={photo} alt={COVER_CONTENT.photoAlt} />
          ) : (
            <>
              <Drop mods="kc-drop--line kc-drop--tl" style={{ position: "absolute", width: 300, left: 520, top: 40, color: "var(--accent-2)" }} />
              <Drop mods="kc-drop--line kc-drop--tl" style={{ position: "absolute", width: 180, left: 580, top: 100, color: "var(--accent-2)" }} />
            </>
          )}
        </div>
        <Drop mods="kc-drop--bl" style={{ position: "absolute", width: 58, left: 56, top: 262 }} />
        <Drop mods="kc-drop--blue" style={{ position: "absolute", width: 20, left: 124, top: 252 }} />
        {caption({ right: 44, top: 278 })}
        {block({ left: 56, top: 324, width: 600 })}
        {areaList({ left: 56, top: 500, width: 600 })}
        {meta({ left: 56, bottom: 40, width: 330 })}
        {logo({ right: 56, bottom: 40, width: 210 })}
      </>
    );
  } else {
    body = (
      <>
        {logo({ left: 56, top: 46, width: 230 })}
        {block({ left: 56, top: 176, width: 330 })}
        {areaList({ left: 56, top: 420, width: 330 })}
        {meta({ left: 56, bottom: 40, width: 330 })}
        <div className="kc-front__window" style={{ position: "absolute", left: 430, top: 40, width: 368, height: 515 }}>
          {photo ? (
            <img src={photo} alt={COVER_CONTENT.photoAlt} />
          ) : (
            <>
              <Drop mods="kc-drop--line" style={{ position: "absolute", width: 150, left: 60, top: 120, color: "var(--on-field-muted)" }} />
              <Drop mods="kc-drop--line kc-drop--tl" style={{ position: "absolute", width: 230, left: 150, top: 250, color: "var(--on-field-muted)" }} />
              <Drop style={{ position: "absolute", width: 30, left: 96, top: 330, background: "var(--accent-2)" }} />
            </>
          )}
        </div>
        <Drop mods="kc-drop--bl" style={{ position: "absolute", width: 50, left: 372, top: 12 }} />
        <Drop mods="kc-drop--blue" style={{ position: "absolute", width: 18, left: 350, top: 6 }} />
        {caption({ right: 44, top: 563 })}
      </>
    );
  }
  return (
    <Sheet ctx={ctx} cls={`kc-front kc-front--${cover}`} anchors={["cover"]} section="회사소개서" note={note}>
      {body}
    </Sheet>
  );
}

// ── C02 목차 ──
export function ContentsPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  return (
    <Sheet ctx={ctx} anchors={["toc"]} section="목차">
      <Head ctx={ctx} name="목차" />
      <div className="kc-grid" style={{ flex: 1, minHeight: 0, alignItems: "stretch" }}>
        <div className="kc-span-7" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <p className="kc-page-title">목차</p>
          <ol className="kc-toc">
            {sectionsFor(ctx).map((sec) => (
              <li key={sec.key} data-hide-empty="">
                <span className="kc-toc__num">{sec.num}</span>
                <span className="kc-toc__name">
                  {sec.name}
                  <span className="kc-toc__desc">
                    {sec.anchor === "sec-app" && ctx.opts.naming === "masked" ? (planOf(ctx) === "formal" ? "B 분야별 수행실적 목록" : "A 수행실적 총괄 · B 분야별 수행실적 목록") : sec.desc}
                  </span>
                </span>
                <a className="kc-toc__folio" href="#" data-ref={sec.anchor} data-ref-fmt="folio" data-ref-missing="hide">
                  00
                </a>
              </li>
            ))}
          </ol>
        </div>
        <aside
          className="kc-span-5"
          style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 16, padding: "22px 24px", background: "var(--canvas)", overflow: "hidden" }}
        >
          <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            <p className="kc-section-title">사업 분야 바로 가기</p>
            <p className="kc-small kc-muted">환경 컨설팅 5분야(계약 관리 분류)와 응용소프트웨어입니다. 분야를 누르면 해당 쪽으로 이동합니다.</p>
            <ol className="kc-toc" style={{ borderTopWidth: 0.5, borderTopColor: "var(--rule)" }}>
              {data.areas.map((a) => (
                <li key={a.index} className={`kc-area-${a.index}`}>
                  <AreaTag name={a.name} style={{ gridColumn: "1 / 3", fontSize: 10.5 }} />
                  <a className="kc-toc__folio" href="#" data-ref={`area-${a.index}`} data-ref-fmt="folio">
                    00
                  </a>
                </li>
              ))}
            </ol>
          </div>
          <Notes items={["쪽 번호를 누르면 해당 쪽으로 이동합니다. PDF 에는 섹션 → 쪽 2단 북마크가 함께 들어갑니다."]} />
        </aside>
      </div>
    </Sheet>
  );
}

// ── C03 대표이사 인사말 ──
export function MessagePage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const msg = data.ceoMessage!;
  const ceo = data.ceo;
  const long = msg.paragraphs.join("").length > 700;
  return (
    <Sheet ctx={ctx} anchors={["sec-01", "c03"]} section="01 회사 소개" outline="대표이사 인사말">
      <Head ctx={ctx} num="01" name="회사 소개" sub="대표이사 인사말" />
      <div className="kc-message">
        <div className="kc-message__person">
          <div style={{ position: "relative" }}>
            {ceo?.photo ? (
              <div className="kc-photo kc-photo--frame kc-ratio-3x4">
                <img src={ctx.url(ceo.photo)} alt={`${msg.signTitle} ${msg.signName}`} />
              </div>
            ) : (
              <div className="kc-nophoto kc-photo--frame kc-ratio-3x4" style={{ display: "grid", placeItems: "center", background: "var(--brand-tint)" }}>
                <span style={{ fontFamily: "var(--kc-font-display)", fontSize: 64, lineHeight: 1, fontWeight: 700, color: "var(--brand)" }}>{ceo?.initial ?? msg.signName.slice(0, 1)}</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            <p className="kc-section-title" style={{ fontSize: 14 }}>
              {msg.signTitle} {msg.signName}
            </p>
            {ceo ? (
              <>
                {[ceo.edu, ceo.cert].filter(Boolean).length ? (
                  <p className="kc-caption" style={{ color: "var(--ink)" }}>
                    {[ceo.edu, ceo.cert].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {ceo.career ? <p className="kc-caption">경력 {ceo.career}</p> : null}
              </>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <p className="kc-eyebrow">{msg.title}</p>
          </div>
          {msg.quote ? <p className="kc-message__quote">{msg.quote}</p> : null}
          <div className={long ? "kc-message__body" : "kc-message__body kc-message__body--one"}>
            {msg.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <div className="kc-message__sign" style={{ marginTop: "auto" }}>
            <span className="kc-muted">
              {data.asOf.slice(0, 4)}년 {Number(data.asOf.slice(5, 7))}월
            </span>
            <b>
              {msg.signTitle} {msg.signName}
            </b>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

// ── C04 숫자로 보는 KESI ──
/** C04 큰 숫자 8개의 내용 — 스튜디오에서 유형을 바꾸거나 일러스트로 그릴 때 라벨·지표·단위가 그대로 간다 */
function figuresSpec(data: CatalogRenderData): InfoSpec {
  const area = (i: number) => data.areas[i - 1];
  const sw = data.areas[5];
  const hasAdv = (mval(data, "advisors.total") ?? 0) > 0;
  const items: InfoItem[] = [
    { id: "initial", label: "통합환경허가 최초허가", metric: "permit.initial.completed", unit: "건", icon: "factory" },
    { id: "change", label: "변경허가·변경신고", metric: "permit.change.completed", unit: "건", icon: "file-check" },
    { id: "haps", label: "HAPs 신고·점검보고", metric: "projects.area.3", unit: "건", icon: "wind" },
    { id: "chem", label: "화학사고 예방·영업허가 등", metric: "projects.area.2", unit: "건", icon: "flask-conical" },
    { id: "esg", label: "ESG·탄소중립 용역", metric: "projects.area.4", unit: "건", icon: "leaf" },
    { id: "other", label: area(5).name, metric: "projects.area.5", unit: "건", icon: "graduation-cap" },
    { id: "staff", label: "임직원", metric: "staff.total", unit: "명", icon: "users" },
    hasAdv ? { id: "advisors", label: "매체별 자문위원", metric: "advisors.total", unit: "명", icon: "network" } : { id: "software", label: sw.name, metric: "software.products", unit: "종", icon: "layout-grid" },
  ];
  return { type: "stats", variant: "row", content: { title: "숫자로 보는 KESI", items: items.map((it) => ({ ...it, value: mval(data, it.metric as MetricId) ?? undefined })) } };
}

/** 숫자 쪽 변형(TP2) — layout: grid(기본) | band(사진 배경 띠, photo = 이미지 키) | cards8(아이콘 + 큰 숫자 카드 8). note = 사진 폴백 안내 */
export function FiguresPage({
  ctx,
  data,
  sectionStart,
  variant,
  note,
}: {
  ctx: RenderCtx;
  data: CatalogRenderData;
  sectionStart?: boolean;
  variant?: Record<string, string>;
  note?: string;
}) {
  const layout = variant?.layout === "band" && variant.photo ? "band" : variant?.layout === "cards8" ? "cards8" : "grid";
  const share = mval(data, "market.permit.share");
  const denom = data.figures["permit.sites.total"];
  const area = (i: number) => data.areas[i - 1];
  const sw = data.areas[5];
  const initial = mval(data, "permit.initial.completed");
  return (
    <Sheet ctx={ctx} anchors={sectionStart ? ["sec-01", "c04"] : ["c04"]} section={sectionStart ? "01 회사 소개" : undefined} outline="숫자로 보는 KESI" note={note}>
      <Head ctx={ctx} num="01" name="회사 소개" sub="숫자로 보는 KESI" />
      <div className="kc-titleblock" style={{ gap: 8 }}>
        <p className="kc-eyebrow">숫자로 보는 KESI</p>
        <p className="kc-statement">
          통합환경허가 최초허가{" "}
          <em data-metric="permit.initial.completed">{fmt(initial)}건</em>,
          <br />
          <span data-metric="permit.industries">{fmt(mval(data, "permit.industries"))}</span>개 업종의 사업장과 함께했습니다.
        </p>
      </div>
      <InfoSource slot="c04.figures" spec={figuresSpec(data)} box={{ w: 746, h: 380 }}>
      <div
        className={layout === "grid" ? "kc-kpis" : `kc-kpis kc-kpis--${layout}`}
        style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gridTemplateRows: "repeat(2, minmax(0, 1fr))", flex: 1, minHeight: 0, marginTop: 6 }}
      >
        {layout === "band" ? (
          <div className="kc-kpis__bg">
            <img src={ctx.url(variant!.photo)} alt="" />
          </div>
        ) : null}
        <Kpi size="xl" area={1} icon="factory" label="통합환경허가 최초허가" value={fmt(initial)} unit="건" metric="permit.initial.completed"
          note={share != null && denom ? `허가 사업장 ${fmt(denom)}개소 중 ${fmt(share)}%` : undefined} />
        <Kpi size="xl" area={1} icon="file-check" label="변경허가·변경신고" value={<M data={data} id="permit.change.completed" />} unit="건"
          note={`통합환경허가 분야 누적 ${fmt(mval(data, "permit.contracts.total"))}건`} />
        <Kpi size="xl" area={3} icon="wind" label="HAPs 신고·점검보고" value={<M data={data} id="projects.area.3" />} unit="건" note={area(3).firstYear ? `${area(3).firstYear}년부터 누적` : undefined} />
        <Kpi size="xl" area={2} icon="flask-conical" label="화학사고 예방·영업허가 등" value={<M data={data} id="projects.area.2" />} unit="건" note="예방관리계획서·영업허가·설치·정기검사" />
        <Kpi size="" area={4} icon="leaf" label="ESG·탄소중립 용역" value={<M data={data} id="projects.area.4" />} unit="건" note="ESG 경영보고서·탄소중립 연구" />
        <Kpi size="" area={5} icon="graduation-cap" label={area(5).name} value={<M data={data} id="projects.area.5" />} unit="건" note="개별 인허가·대기총량·R&D·교육" />
        <Kpi size="" icon="users" label="임직원" value={<M data={data} id="staff.total" />} unit="명"
          note={<>사용자관리 기준 · 기술인력 <span data-metric="staff.technical">{fmt(mval(data, "staff.technical"))}</span>명</>} />
        {(mval(data, "advisors.total") ?? 0) > 0 ? (
          <Kpi size="" icon="network" label="매체별 자문위원" value={<M data={data} id="advisors.total" />} unit="명" note="대기·수질·폐기물·토양·소음진동·법률" />
        ) : (
          <Kpi size="" area={6} icon="layout-grid" label={sw.name} value={<M data={data} id="software.products" />} unit="종" note="그룹웨어 & ERP 등 자체 개발" />
        )}
      </div>
      </InfoSource>
      <Foot
        items={[
          `* ${asOfNote(data)}. 계약 관리(5분류 모두, 기타 용역 포함)·사용자관리·회사 프로필에서 자동 집계합니다. 최초허가는 완료한 사업장 수, 그 밖의 분야는 누적 계약 수(수행 중 포함)입니다.`,
          denom ? `* 허가 사업장 ${fmt(denom)}개소는 환경부 통합허가 완료 사업장 수(외부 수치)입니다.` : "",
        ]}
      />
    </Sheet>
  );
}

// ── C05 회사 개요·비전 ──
/** 회사 개요 변형(L2) — visual: logo(로고 판, 기본) | photo(사진, photo = 이미지 키) */
export function OverviewPage({ ctx, data, variant }: { ctx: RenderCtx; data: CatalogRenderData; variant?: Record<string, string> }) {
  const visualPhoto = variant?.visual === "photo" && variant.photo ? variant.photo : null;
  const c = data.company;
  const hq = data.offices[0];
  const facts: Array<[string, ReactNode]> = [
    ["회사명", `${c.name}(${c.nameShort})`],
    ["대표이사", c.ceoName],
    ["설립", c.foundedYear ? <><span className="kc-num">{c.foundedYear}</span>년{c.foundedMonth ? <> <span className="kc-num">{c.foundedMonth}</span>월</> : null}</> : "-"],
    ["본사", hq.address || "-"],
    ...data.offices.slice(1).map((o) => [o.name, o.address] as [string, ReactNode]),
    ["연구소", VISION_CONTENT.research],
    ["임직원", <><span className="kc-num" data-metric="staff.total">{fmt(mval(data, "staff.total"))}</span>명(기술인력 <span className="kc-num" data-metric="staff.technical">{fmt(mval(data, "staff.technical"))}</span>명)</>],
  ];
  if (c.revenue) facts.push(["매출액", <><span className="kc-num">{fmt(c.revenue.millionWon, 0)}</span>백만 원({c.revenue.year}년)</>]);
  if (c.credit) facts.push(["신용등급", `${c.credit.grade}(${[c.credit.agency, c.credit.ratedAt.replace(/-/g, ".")].filter(Boolean).join(", ")})`]);
  if (c.registrations.length) facts.push(["주요 등록", c.registrations.slice(0, 3).join(" · ")]);
  facts.push(["연락처", <><span className="kc-num">{c.phone}</span>{c.website ? ` · ${c.website}` : ""}</>]);
  const statement = c.vision ? c.vision.split(/\n/) : VISION_CONTENT.statement;
  return (
    <Sheet ctx={ctx} anchors={["c05"]} outline="회사 개요·비전">
      <Head ctx={ctx} num="01" name="회사 소개" sub="회사 개요·비전" />
      <div className="kc-grid" style={{ flex: 1, minHeight: 0 }}>
        <div className="kc-span-7" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="kc-titleblock" style={{ gap: 8 }}>
            <p className="kc-eyebrow">비전</p>
            <p className="kc-statement" style={{ fontSize: 32, lineHeight: "42px" }}>
              {statement.map((line, i) => (
                <span key={i}>
                  {i > 0 ? <br /> : null}
                  {line}
                </span>
              ))}
            </p>
            <p className="kc-lead">{VISION_CONTENT.lead}</p>
          </div>
          <div style={{ marginTop: "auto" }}>
            <p className="kc-blockhead">
              경영철학<span className="kc-blockhead__aside">네 가지 원칙</span>
            </p>
            <InfoSlot slot="c05.philosophy" spec={cardsSpec(VISION_CONTENT.philosophy)} box={{ w: 425, h: 150 }} />
          </div>
        </div>
        <div className="kc-span-5" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <figure style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {visualPhoto ? (
              <div className="kc-photo kc-photo--frame kc-ratio-hero">
                <img src={ctx.url(visualPhoto)} alt={`${c.name} 사진`} />
              </div>
            ) : (
              <div className="kc-photo--frame kc-ratio-hero" style={{ position: "relative", display: "grid", placeItems: "center", overflow: "hidden", background: "var(--paper)", boxShadow: "inset 0 0 0 1px var(--rule)" }}>
                <img src={ctx.url("k/assets/kesi-ko-horizontal-gradient.png")} alt="KESI ㈜한국환경안전연구원 국문 좌우조합(그라데이션)" style={{ display: "block", width: "70%", height: "auto" }} />
              </div>
            )}
          </figure>
          <dl className="kc-facts">
            {facts.map(([k, v]) => (
              <Fact key={k} k={k} v={v} />
            ))}
          </dl>
        </div>
      </div>
    </Sheet>
  );
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

// ── C06 연혁 ──
/** 연혁 변형(TP2) — axis: columns(기본) | horizontal(한 줄 축) | columns4(연대별 4단) */
export function HistoryPage({
  ctx,
  data,
  years,
  part,
  parts,
  variant,
}: {
  ctx: RenderCtx;
  data: CatalogRenderData;
  years: HistoryYear[];
  part: number;
  parts: number;
  variant?: Record<string, string>;
}) {
  const first = data.history[0]?.year;
  return (
    <Sheet ctx={ctx} anchors={["c06"]} outline={part === 0 ? "연혁" : undefined}>
      <Head ctx={ctx} num="01" name="회사 소개" sub={parts > 1 ? `연혁 ${part + 1}/${parts}` : "연혁"} />
      <TitleBlock
        eyebrow="연혁"
        title={part === 0 ? `${first ?? ""}년 설립 이후 등록·인증과 함께 사업 영역을 넓혀 왔습니다` : `${years[0]?.year}–${years[years.length - 1]?.year} 연혁`}
      />
      <Timeline years={years} axis={variant?.axis} style={{ flex: 1, minHeight: 0, marginTop: 6 }} />
      {part === parts - 1 ? <HistoryFigures data={data} /> : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24, paddingTop: 8, borderTop: "var(--stroke-hair) solid var(--rule)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Foot items={[`* ${asOfNote(data)}. 등록·인증·특허·수상은 회사 프로필에 등록한 내용입니다.`]} />
          <Notes items={["* 등록·인증·특허·수상은 회사 프로필에 등록되면 연혁에 자동으로 반영됩니다. 연혁이 늘어나면 연대별로 자동 분쪽합니다."]} />
        </div>
      </div>
    </Sheet>
  );
}

/** 연혁 아래 숫자 띠(사진 없는 변형) — 업력·등록·인증·특허·수상 수 */
function HistoryFigures({ data }: { data: CatalogRenderData }) {
  const count = (kinds: string[]) => data.credentials.filter((c) => kinds.includes(c.kind)).length;
  const items = [
    { label: "업력", value: <M data={data} id="company.years" />, unit: "년", note: data.company.foundedYear ? `${data.company.foundedYear}년 설립` : undefined },
    { label: "등록", value: fmt(count(["등록"])), unit: "건", note: "대행업·컨설팅업·엔지니어링 등" },
    { label: "인증", value: fmt(count(["인증"])), unit: "건", note: "벤처기업·기술혁신형 중소기업 등" },
    { label: "특허·수상", value: fmt(count(["특허", "수상"])), unit: "건", note: undefined },
  ];
  return (
    <div className="kc-kpis" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
      {items.map((k) => (
        <Kpi key={k.label} label={k.label} value={k.value} unit={k.unit} note={k.note} />
      ))}
    </div>
  );
}

// ── C07 섹션 간지 ──
/** 간지 변형(TP2) — style: leaf(잎 창, 기본) | photo-full(전면 사진 + 판, photo = 이미지 키) | color-pattern(주색 면 + 모티프 패턴) | plain(단색·겹선) */
export function DividerPage({
  ctx,
  num,
  title,
  lead,
  items,
  anchor,
  variant,
  note,
}: {
  ctx: RenderCtx;
  num: string;
  title: string;
  lead: string;
  items: Array<{ label: string; area?: number; ref: string }>;
  anchor: string;
  variant?: Record<string, string>;
  note?: string;
}) {
  const style = variant?.style === "photo-full" && variant.photo ? "photo-full" : variant?.style === "color-pattern" || variant?.style === "plain" ? variant.style : "leaf";
  const motif = ctx.motif ?? "drop";
  return (
    <Sheet ctx={ctx} cls={style === "leaf" ? "kc-divider" : `kc-divider kc-divider--${style}`} anchors={[anchor]} section={`${num} ${title}`} note={note}>
      <div className="kc-divider__main">
        <div>
          <p className="kc-divider__num">{secNum(ctx, num)}</p>
          <p className="kc-divider__title">{title}</p>
          <p className="kc-divider__lead">{lead}</p>
        </div>
        <ol className="kc-divider__list">
          {items.map((it) => (
            <li key={it.ref} className={it.area ? `kc-area-${it.area}` : undefined}>
              {it.area ? <AreaTag name={it.label} style={{ fontSize: 10.5 }} /> : <span className="kc-areatag" style={{ fontSize: 10.5 }}>{it.label}</span>}
              <a className="kc-toc__folio" href="#" data-ref={it.ref} data-ref-fmt="folio">
                00
              </a>
            </li>
          ))}
        </ol>
      </div>
      {style === "photo-full" ? (
        <div className="kc-divider__full">
          <img src={ctx.url(variant!.photo)} alt={`${title} 간지 사진`} />
        </div>
      ) : null}
      {style === "leaf" ? (
        <div className="kc-divider__art">
          <div className="kc-motif-layer">
            <div style={{ left: 34, top: 92, width: 262, height: 350, borderRadius: "0 131px 131px 131px", background: "var(--field)", overflow: "hidden" }}>
              <Drop mods="kc-drop--line" style={{ position: "absolute", width: 132, left: 24, top: 30, color: "var(--on-field-muted)" }} />
            </div>
            <Drop mods="kc-drop--bl" style={{ width: 56, left: 256, top: 40 }} />
          </div>
        </div>
      ) : style === "color-pattern" ? (
        <div className="kc-divider__art">
          <div className="kc-pattern">
            {motif === "drop" ? (
              <>
                <Drop mods="kc-drop--line" style={{ width: 170, left: 60, top: 60, color: "var(--pattern-ink)" }} />
                <Drop mods="kc-drop--line kc-drop--tl" style={{ width: 110, left: 190, top: 300, color: "var(--pattern-ink)" }} />
                <Drop mods="kc-drop--line kc-drop--bl" style={{ width: 60, left: 40, top: 420, color: "var(--pattern-ink)" }} />
              </>
            ) : motif === "contour" ? (
              <Contour mods="kc-contour--on-field kc-divider__contour" viewBox="0 0 330 595" rings={DIVIDER_CONTOUR} style={{ position: "absolute" }} />
            ) : null}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

export { DIVIDER_CONTENT, Icon };
