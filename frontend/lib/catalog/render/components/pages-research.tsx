/*
 * 연구소·ESG 제안형(research 템플릿) 쪽 — 사용자 제공 양식 "[한국환경안전연구원] 회사소개서_260928.pdf"(26쪽)의 쪽 구성·도식을 그대로 옮긴다.
 *   목차(로마 숫자 2단) → I 회사개요(일반현황·주요연혁 / 경영철학 클로버 / 등록증) → II 사업분야(4분면) → III 핵심역량(카드 4)
 *   → IV ESG 컨설팅 개요(C21: 개념·도입배경·기대효과) → V 국내외 동향(C22) → VI 작성 개요(C23: 절차·이중 중대성·프로세스·작성 항목)
 *   → VII 전문인력(임원 이력·참여인력 내부/외부·수행 조직) → VIII 수행실적(분야별 그룹·두 단 카드) → Thank you 뒤표지.
 * 숫자·사람·실적은 CatalogRenderData 에서, 양식에만 있는 ESG 설명 문안은 master-content RESEARCH_CONTENT 에서 가져온다.
 * 지면 CSS 는 디자인 시스템 bundle.css 의 research 블록(.kc-tpl--research .kc-rs-*). 쪽 머리 띠는 TP1 의 .kc-tpl--research .kc-head 를 쓴다.
 * 쪽 아래는 양식처럼 왼쪽 로고 + 오른쪽 사선 쪽 번호 탭(RsFoot) — 인쇄본 자동 로고(kc-edition--print::after)는 kc-nofoot 으로 끈다.
 */
import type { CSSProperties, ReactNode } from "react";
import { RESEARCH_CONTENT as RC, RESEARCH_SECTIONS, VISION_CONTENT } from "../master-content";
import type { AreaInfo, CatalogRenderData, HistoryYear, LeaderCard, PersonCv, RenderCtx } from "../types";
import { Foot, Head, Icon, Notes, Sheet, asOfNote, cx, fmt, mval } from "./parts";

const LOGO = "k/assets/kesi-signature-ko.png";
const LOGO_WHITE = "k/assets/kesi-en-horizontal-white.png";
const LOGO_MARK = "k/assets/kesi-horizontal-nosub.png";
const LOGO_ALT = "KESI ㈜한국환경안전연구원 Korean Environment Safety Institute Co. LTD";

/** 섹션 키(R1…) → 정의 */
export const rsSection = (key: string) => RESEARCH_SECTIONS.find((s) => s.key === key)!;

/** 쪽 아래 — 왼쪽 로고 + 오른쪽 사선 쪽 번호 탭(paginate 가 [data-folio] 를 채운다) */
function RsFoot({ ctx, folio = true }: { ctx: RenderCtx; folio?: boolean }) {
  return (
    <div className="kc-rs-foot" aria-hidden="true" data-overflow-ok="">
      <img className="kc-rs-foot__logo" src={ctx.url(LOGO)} alt="" />
      {folio ? (
        <span className="kc-rs-foot__folio" data-folio="">
          00
        </span>
      ) : null}
    </div>
  );
}

/** research 쪽 공용 틀 — 쪽 머리(섹션 번호·이름·부제) + 본문 + 쪽 아래 */
function RsSheet({
  ctx,
  sec,
  sub,
  anchors,
  first,
  outline,
  flow,
  cls,
  style,
  children,
}: {
  ctx: RenderCtx;
  /** 섹션 키 R1…R8 */
  sec: string;
  sub?: string;
  anchors: string[];
  /** 섹션 첫 쪽(1단 북마크 + 섹션 앵커) */
  first?: boolean;
  outline?: string;
  flow?: boolean;
  cls?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const s = rsSection(sec);
  return (
    <Sheet
      ctx={ctx}
      cls={cx("kc-nofoot kc-rs-page", cls)}
      flow={flow}
      anchors={first ? [s.anchor, ...anchors] : anchors}
      section={first ? `${s.num} ${s.name}` : undefined}
      outline={outline ?? sub}
      style={style}
    >
      <Head ctx={ctx} num={s.num} name={s.name} sub={sub} />
      {children}
      <RsFoot ctx={ctx} />
    </Sheet>
  );
}

/** 소제목(▌ 막대 + 앞말 회청 · 뒷말 포인트 블루) — 양식의 "제안사 일반현황"(앞말만 있으면 전부 회청: "ESG 개념") */
function RsTitle({ lead, em, aside, style }: { lead?: string; em?: string; aside?: ReactNode; style?: CSSProperties }) {
  return (
    <p className="kc-eyebrow kc-rs-title" style={style}>
      {lead ? <span>{lead}</span> : null}
      {em ? <em>{em}</em> : null}
      {aside ? <span className="kc-rs-title__aside">{aside}</span> : null}
    </p>
  );
}

/** 작은 머리(세 점 표식 + 글 + 밑줄) — 양식의 "보고서 발간 프로세스"·"대표이사" */
function RsMini({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <p className="kc-rs-mini" style={style}>
      <span className="kc-rs-dots" aria-hidden="true">
        <i></i>
        <i></i>
        <i></i>
      </span>
      {children}
    </p>
  );
}

// ── C02 목차(로마 숫자 2단) ──
export function ResearchContentsPage({ ctx }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const half = Math.ceil(RESEARCH_SECTIONS.length / 2);
  const col = (list: readonly (typeof RESEARCH_SECTIONS)[number][]) => (
    <ol className="kc-rs-toc__col">
      {list.map((s) => (
        <li key={s.key} className="kc-rs-toc__item">
          <span className="kc-rs-toc__num">{s.roman}</span>
          <span className="kc-rs-toc__body">
            <a className="kc-rs-toc__name" href="#" data-ref={s.anchor}>
              {s.name}
            </a>
            <span className="kc-rs-toc__desc">{s.desc}</span>
          </span>
        </li>
      ))}
    </ol>
  );
  return (
    <Sheet ctx={ctx} cls="kc-nofoot kc-rs-tocpage" anchors={["toc"]} section="목차">
      <div className="kc-rs-tocpage__tri" aria-hidden="true"></div>
      <p className="kc-rs-tocpage__title">목차</p>
      <div className="kc-rs-toc">
        {col(RESEARCH_SECTIONS.slice(0, half))}
        {col(RESEARCH_SECTIONS.slice(half))}
      </div>
      <RsFoot ctx={ctx} folio={false} />
    </Sheet>
  );
}

// ── C05 일반현황 및 주요연혁 ──
/** 주요연혁 칸 — 최근 순, 칸 높이에 맞춰 최대 14줄. 넘치면 가운데(오래된 쪽)를 줄이고 설립 줄은 남긴다 */
export const RS_HISTORY_MAX = 14;
export function historyRows(history: HistoryYear[], max = RS_HISTORY_MAX) {
  const all = history.flatMap((y) => y.items.map((it) => ({ ym: `${y.year}. ${it.month ? it.month.padStart(2, "0") : ""}`.trim(), content: it.content, highlight: it.highlight })));
  const desc = [...all].reverse();
  if (desc.length <= max) return desc;
  return [...desc.slice(0, max - 1), desc[desc.length - 1]];
}

export function ResearchProfilePage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const c = data.company;
  const hq = data.offices[0];
  const rows: Array<[string, ReactNode]> = [
    ["주소", hq?.address || "-"],
    ["전화번호", <span className="kc-num">{c.phone || "-"}</span>],
    ["설립년도", c.foundedYear ? <><span className="kc-num">{c.foundedYear}</span>년{c.foundedMonth ? <> <span className="kc-num">{c.foundedMonth}</span>월</> : null}</> : "-"],
    ["종업원수", <><span className="kc-num" data-metric="staff.total">{fmt(mval(data, "staff.total"))}</span>명</>],
  ];
  if (c.revenue) rows.push(["매출액", <><span className="kc-num">{fmt(c.revenue.millionWon, 0)}</span> 백만원({c.revenue.year}년)</>]);
  if (c.credit) rows.push(["신용등급", `${c.credit.grade}(${[c.credit.agency, c.credit.ratedAt.replace(/-/g, ".")].filter(Boolean).join(" ")})`]);
  const history = historyRows(data.history);
  return (
    <RsSheet ctx={ctx} sec="R1" sub="일반현황 및 주요연혁" anchors={["c05"]} first>
      <div className="kc-rs-profile">
        <section className="kc-rs-profile__facts">
          <RsTitle lead="제안사" em="일반현황" />
          <table className="kc-rs-facts">
            <tbody>
              <tr>
                <th>
                  회사명<small>(본사)</small>
                </th>
                <td>{c.name}</td>
                <th className="kc-rs-facts__th2">대표자</th>
                <td className="kc-rs-facts__ceo">{c.ceoName}</td>
              </tr>
              <tr className="kc-rs-facts__biz">
                <th>사업분야</th>
                <td colSpan={3}>
                  <ul className="kc-rs-facts__list">
                    {RC.businessLines.map((b) => (
                      <li key={b.text} className={b.strong ? "is-strong" : undefined}>
                        {b.text}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td colSpan={3}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="kc-rs-profile__history">
          <RsTitle lead="제안사" em="주요연혁" />
          <ol className="kc-rs-tl">
            {history.map((h, i) => (
              <li key={i} className={h.highlight ? "is-highlight" : undefined}>
                <span className="kc-rs-tl__ym kc-num">{h.ym}</span>
                <span className="kc-rs-tl__text">{h.content}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <Notes items={[data.history.reduce((a, y) => a + y.items.length, 0) > RS_HISTORY_MAX ? `* 연혁이 ${RS_HISTORY_MAX}줄을 넘어 최근 순으로 줄이고 설립 줄을 남겼습니다.` : ""]} />
    </RsSheet>
  );
}

// ── C05 경영철학 및 비전(VISION 띠 + 4잎 클로버) ──
export function ResearchVisionPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const statement = (data.company.vision ? data.company.vision.split(/\n/) : VISION_CONTENT.statement).join(" ");
  const [p1, p2, p3, p4] = VISION_CONTENT.philosophy;
  // 양식 배치: 01 신뢰(왼쪽 위) · 02 혁신(오른쪽 위) · 03 소통(오른쪽 아래) · 04 노력(왼쪽 아래)
  const principle = (p: (typeof VISION_CONTENT.philosophy)[number], pos: string) => (
    <div className={`kc-rs-principle kc-rs-principle--${pos}`}>
      <p className="kc-rs-principle__title">
        {p.title}({p.en})
      </p>
      <p className="kc-rs-principle__desc">{p.desc}</p>
    </div>
  );
  return (
    <RsSheet ctx={ctx} sec="R1" sub="경영철학 및 비전" anchors={["c05-vision"]}>
      <div className="kc-rs-visionpage">
        <div className="kc-rs-vision">
          <span className="kc-rs-vision__label">VISION</span>
          <span className="kc-rs-vision__text">{statement}</span>
        </div>
        <span className="kc-rs-vision__arrow" aria-hidden="true"></span>
        <div className="kc-rs-philo">
          {principle(p1, "tl")}
          {principle(p2, "tr")}
          <div className="kc-rs-clover" aria-label="경영철학 네 원칙">
            <span className="kc-rs-clover__petal kc-rs-clover__petal--1">01</span>
            <span className="kc-rs-clover__petal kc-rs-clover__petal--2">02</span>
            <span className="kc-rs-clover__petal kc-rs-clover__petal--4">04</span>
            <span className="kc-rs-clover__petal kc-rs-clover__petal--3">03</span>
            <span className="kc-rs-clover__center">경영철학</span>
          </div>
          {principle(p4, "bl")}
          {principle(p3, "br")}
        </div>
      </div>
    </RsSheet>
  );
}

// ── C16 등록증 보유현황(파란 테 증서 격자) ──
export function ResearchCredentialsPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const list = data.credentials;
  const n = list.length;
  const rows = n <= 4 ? 1 : n <= 10 ? 2 : 3;
  const perRow = Math.ceil(n / rows);
  // 본문 폭 746·높이 약 430 안에서 A4 세로 비(1:1.414) 증서 크기
  const w = Math.floor(Math.min(168, (746 - (perRow - 1) * 16) / perRow, ((430 - (rows - 1) * 16) / rows) / 1.414));
  return (
    <RsSheet ctx={ctx} sec="R1" sub="등록증 보유현황" anchors={["c16"]}>
      <div className="kc-rs-certs">
        {list.map((cr) => (
          <figure key={cr.key} className="kc-rs-cert" style={{ width: w, height: Math.round(w * 1.414) }}>
            {cr.image ? (
              <img src={ctx.url(cr.image)} alt={`${cr.name} ${cr.kind}증`} />
            ) : (
              <div className="kc-rs-cert__paper">
                <span className="kc-rs-cert__kind">{cr.kind}</span>
                <span className="kc-rs-cert__emblem">
                  <Icon name="award" />
                </span>
                <span className="kc-rs-cert__name">{cr.name}</span>
                {cr.meta ? <span className="kc-rs-cert__meta">{cr.meta}</span> : null}
                <span className="kc-rs-cert__rule"></span>
                <span className="kc-rs-cert__holder">{data.company.name}</span>
              </div>
            )}
          </figure>
        ))}
      </div>
      <Notes items={[list.some((c) => !c.image) ? "* 증서 사진이 없는 항목은 이름·번호로 증서 모양을 그렸습니다. 회사 프로필 > 등록·인증에 증서 사진을 올리면 사진으로 바뀝니다." : ""]} />
    </RsSheet>
  );
}

// ── C08 사업분야(4분면 조각 + 가운데 원) ──
export function ResearchBusinessPage({ ctx }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const pos = ["tl", "tr", "bl", "br"];
  return (
    <RsSheet ctx={ctx} sec="R2" anchors={["c08"]} outline="사업분야" first>
      <div className="kc-rs-biz">
        {RC.business.map((g, i) => (
          <section key={g.title} className={`kc-rs-biz__group kc-rs-biz__group--${pos[i]} kc-area-${g.area}`}>
            <p className="kc-rs-biz__title">{g.title}</p>
            <ul className="kc-rs-biz__list">
              {g.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        ))}
        <div className="kc-rs-biz__wheel" aria-hidden="true">
          {RC.business.map((g, i) => (
            <span key={g.title} className={`kc-rs-biz__piece kc-rs-biz__piece--${pos[i]} kc-area-${g.area}`}>
              <Icon name={g.icon} />
            </span>
          ))}
        </div>
        <p className="kc-rs-biz__center">
          {RC.businessCenter.map((l, i) => (
            <span key={i}>
              {i > 0 ? <br /> : null}
              {l}
            </span>
          ))}
        </p>
      </div>
    </RsSheet>
  );
}

// ── C10 핵심역량(특장점) ──
/** 카드 문구의 {자리}를 데이터로 채운다 — 값이 없는 줄은 뺀다 */
export function strengthLines(items: string[], data: CatalogRenderData): string[] {
  const leaderMax = Math.max(0, ...data.leaders.map((l) => l.careerYears ?? 0));
  const patent = data.credentials.filter((c) => c.kind === "특허").map((c) => c.name);
  const vals: Record<string, string | null> = {
    leaderMax: leaderMax ? String(leaderMax) : null,
    advisors: data.advisors.length ? fmt(data.advisors.length) : null,
    patent: patent.length ? `${patent[patent.length - 1]} 특허` : null,
  };
  return items.flatMap((t) => {
    let ok = true;
    const out = t.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = vals[k];
      if (v == null) ok = false;
      return v ?? "";
    });
    return ok ? [out] : [];
  });
}

export function ResearchStrengthsPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const slogan = data.company.slogan || RC.slogan;
  return (
    <RsSheet ctx={ctx} sec="R3" anchors={["c10"]} outline="핵심역량(특장점)" first>
      <div className="kc-rs-panel kc-rs-strengths">
        <img className="kc-rs-strengths__logo" src={ctx.url(LOGO_MARK)} alt="KESI" />
        <p className="kc-rs-strengths__slogan">“{slogan}”</p>
        <div className="kc-rs-strengths__cards">
          {RC.strengths.map((s) => (
            <article key={s.title} className="kc-rs-strengths__card">
              <span className="kc-rs-strengths__icon">
                <Icon name={s.icon} />
              </span>
              <p className="kc-rs-strengths__name">{s.title}</p>
              <ul className="kc-rs-strengths__list">
                {strengthLines(s.items, data).map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </RsSheet>
  );
}

// ── C21 주제 개관 1 — ESG 개념(E·S·G 3단) ──
export function EsgConceptPage({ ctx }: { ctx: RenderCtx; data: CatalogRenderData }) {
  return (
    <RsSheet ctx={ctx} sec="R4" anchors={["c21-1"]} outline={RC.concept.title} first>
      <RsTitle lead={RC.concept.title} />
      <div className="kc-topic">
        <p className="kc-topic__lead">{RC.concept.lead}</p>
        {RC.concept.cols.map((c) => (
          <div key={c.name} className={`kc-topic__col kc-area-${c.area}`}>
            <span className="kc-topic__icon">
              <span>
                <Icon name={c.icon} />
                <small>{c.en}</small>
                <small>{c.name}</small>
              </span>
            </span>
            <span className="kc-topic__dots"></span>
            <p className="kc-topic__desc">{c.desc}</p>
            <p className="kc-topic__detail">
              <b>세부요소</b>
              <span>{c.detail}</span>
            </p>
          </div>
        ))}
      </div>
    </RsSheet>
  );
}

// ── C21 주제 개관 2 — 도입배경 및 중요성 ──
export function EsgBackgroundPage({ ctx }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const B = RC.background;
  return (
    <RsSheet ctx={ctx} sec="R4" anchors={["c21-2"]} outline={B.title}>
      <RsTitle lead={B.title} />
      <div className="kc-rs-panel kc-rs-why">
        <p className="kc-rs-why__lead">{B.lead}</p>
        <div className="kc-rs-why__diagram">
          <div className="kc-rs-why__fin">
            <span className="kc-rs-why__fin-icon">
              <Icon name="presentation" />
            </span>
            <p className="kc-rs-why__fin-title">{B.financial.title}</p>
            <ul>
              {B.financial.items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <span className="kc-rs-why__arrow" aria-hidden="true"></span>
          <div className="kc-rs-why__non">
            <p className="kc-rs-why__non-title">{B.nonFinancial.title}</p>
            <div className="kc-rs-why__trio">
              {B.nonFinancial.items.map((it, i) => (
                <span key={it.label} className={`kc-rs-why__dot kc-rs-why__dot--${i + 1}`}>
                  <Icon name={it.icon} />
                  <small>{it.label}</small>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="kc-rs-why__strategy">
          <p className="kc-rs-why__strategy-title">➢ {B.strategyTitle}</p>
          <ul className="kc-rs-bullets">
            {B.strategy.map((s) => (
              <li key={s.b}>
                <b>{s.b}:</b> {s.t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </RsSheet>
  );
}

// ── C21 주제 개관 3 — ESG 경영보고서 기대효과(반원 도식) ──
/** 반원 고리 조각 경로(가운데 cx·cy, 바깥 r1·안 r0, 각도 a0→a1 도, 0도 = 오른쪽, 위가 +) */
function arcPath(cx0: number, cy0: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${(cx0 + r * Math.cos((a * Math.PI) / 180)).toFixed(1)} ${(cy0 - r * Math.sin((a * Math.PI) / 180)).toFixed(1)}`;
  return `M ${p(r1, a0)} A ${r1} ${r1} 0 0 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`;
}

export function EsgEffectsPage({ ctx }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const E = RC.effects;
  const n = E.items.length;
  const seg = 180 / n;
  // 양식의 주황 → 보라 단계(분야 2·3 색 사이)
  const fills = [
    "var(--area-2-mid)",
    "color-mix(in srgb, var(--area-2-mid) 60%, var(--area-3))",
    "color-mix(in srgb, var(--area-2) 45%, var(--area-3-mid))",
    "color-mix(in srgb, var(--area-3-mid) 70%, var(--area-2-mid))",
    "var(--area-3-mid)",
  ];
  return (
    <RsSheet ctx={ctx} sec="R4" anchors={["c21-3"]} outline={E.title}>
      <RsTitle lead="ESG 경영보고서" em="기대효과" />
      <div className="kc-rs-panel kc-rs-effects">
        <svg className="kc-rs-effects__arc" viewBox="0 0 300 160" aria-hidden="true">
          {E.items.map((_, i) => {
            const a0 = 180 - i * seg;
            const a1 = a0 - seg + 1.2;
            const mid = (a0 + a1) / 2;
            const tip = (r: number, a: number) => [150 + r * Math.cos((a * Math.PI) / 180), 150 - r * Math.sin((a * Math.PI) / 180)];
            const [tx, ty] = tip(118, mid);
            const [lx, ly] = tip(104, mid - 6);
            const [rx, ry] = tip(104, mid + 6);
            return (
              <g key={i}>
                <path d={arcPath(150, 150, 76, 132, a0, a1)} style={{ fill: fills[i % fills.length] }}></path>
                <path d={`M ${tx.toFixed(1)} ${ty.toFixed(1)} L ${lx.toFixed(1)} ${ly.toFixed(1)} L ${rx.toFixed(1)} ${ry.toFixed(1)} Z`} className="kc-rs-effects__tick"></path>
              </g>
            );
          })}
        </svg>
        <p className="kc-rs-effects__center">
          {E.center[0]}
          <br />
          {E.center[1]}
        </p>
        {E.items.map((it, i) => (
          <div key={it.title} className={`kc-rs-effects__item kc-rs-effects__item--${i + 1}`}>
            <span className="kc-rs-effects__icon" style={{ color: fills[i % fills.length] }}>
              <Icon name={it.icon} />
            </span>
            <p className="kc-rs-effects__title">{it.title}</p>
            <p className="kc-rs-effects__desc">
              {it.desc}
              {it.em ? (
                <>
                  {" "}
                  <em>{it.em}</em>
                </>
              ) : null}
            </p>
          </div>
        ))}
      </div>
    </RsSheet>
  );
}

// ── C22 동향 1 — 국내(번호 목록 + 지표체계·공시 최종안 표) ──
export function EsgDomesticPage({ ctx }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const D = RC.domestic;
  return (
    <RsSheet ctx={ctx} sec="R5" anchors={["c22-1"]} outline={D.title} first>
      <RsTitle lead={D.title} />
      <div className="kc-rs-panel kc-rs-trend">
        <ol className="kc-rs-trend__items">
          {D.items.map((it) => (
            <li key={it.title}>
              <p className="kc-rs-trend__title">{it.title}</p>
              <ul className="kc-rs-bullets">
                {it.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              {it.note ? <p className="kc-rs-trend__note">▶ {it.note}</p> : null}
            </li>
          ))}
        </ol>
        <div className="kc-rs-trend__tables">
          <div className="kc-rs-mt">
            <p className="kc-rs-mt__title">{D.kesg.title}</p>
            <table className="kc-rs-mt__table">
              <thead>
                <tr>
                  <th>{D.kesg.head[0]}</th>
                  <th>{D.kesg.head[1]}</th>
                </tr>
              </thead>
              <tbody>
                {D.kesg.rows.map((r) => (
                  <tr key={r.label}>
                    <th>
                      <Icon name={r.icon} />
                      {r.label}
                    </th>
                    <td>{r.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="kc-rs-mt kc-rs-mt--final">
            <p className="kc-rs-mt__title">{D.final.title}</p>
            <table className="kc-rs-mt__table">
              <thead>
                <tr>
                  <th colSpan={2}>{D.final.head}</th>
                </tr>
              </thead>
              <tbody>
                {D.final.rows.map((r) => (
                  <tr key={r.label}>
                    <th>
                      <Icon name={r.icon} />
                      {r.label}
                    </th>
                    <td>
                      {r.text.map((t, i) => (
                        <span key={t} className="kc-rs-mt__step">
                          {i > 0 ? <i aria-hidden="true">▼</i> : null}
                          {t}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="kc-rs-source">{D.source}</p>
        </div>
      </div>
      <Notes items={[`* 동향 문안은 양식 기준(${RC.asOf})입니다. 발행 전에 최신 제도 변화를 확인하세요.`]} />
    </RsSheet>
  );
}

// ── C22 동향 2 — EU 규제 · 국외 공시 제도화 ──
export function EsgGlobalPage({ ctx }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const G = RC.global;
  return (
    <RsSheet ctx={ctx} sec="R5" anchors={["c22-2"]} outline={G.euTitle}>
      <div className="kc-rs-global">
        <section>
          <RsTitle lead={G.euTitle} />
          <div className="kc-rs-panel kc-rs-global__eu">
            <p className="kc-rs-global__lead">{G.euLead}</p>
            <ul className="kc-rs-global__laws">
              {G.eu.map((e) => (
                <li key={e.title}>
                  <p className="kc-rs-global__law">{e.title}</p>
                  <p>{e.text}</p>
                  {e.sub.map((s) => (
                    <p key={s} className="kc-rs-global__sub">
                      - {s}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section>
          <RsTitle lead={G.abroadTitle} />
          <div className="kc-rs-panel kc-rs-global__abroad">
            <ul className="kc-rs-bullets">
              {G.abroad.map((a) => (
                <li key={a.b}>
                  <b>{a.b}:</b> {a.t}
                </li>
              ))}
            </ul>
            <p className="kc-rs-mt__title">{G.tableTitle}</p>
            <div className="kc-rs-global__grid">
              {G.table.map((r) => (
                <div key={r.label} className="kc-rs-global__cell">
                  <span className="kc-rs-global__flag">
                    <b>{r.label}</b>
                    <Icon name={r.icon} />
                  </span>
                  <span>{r.text}</span>
                </div>
              ))}
            </div>
            <p className="kc-rs-source">{G.source}</p>
          </div>
        </section>
      </div>
      <Notes items={[`* 동향 문안은 양식 기준(${RC.asOf})입니다. 발행 전에 최신 제도 변화를 확인하세요.`]} />
    </RsSheet>
  );
}

// ── C23 수행 절차 1 — 보고서 발간 프로세스(4단계 띠 + 기간 + 세부 + 번호 목록) ──
export function ReportProcessPage({ ctx }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const P = RC.process;
  return (
    <RsSheet ctx={ctx} sec="R6" anchors={["c23-1"]} outline={P.title} first>
      <RsTitle lead={P.title} />
      <div className="kc-rs-panel kc-rs-process">
        <div className="kc-rs-process__left">
          <RsMini>{P.subTitle}</RsMini>
          <div className="kc-rs-process__card">
            <div className="kc-phases">
              {P.phases.map((ph) => (
                <span key={ph.label} className="kc-phases__step">
                  {ph.label}
                </span>
              ))}
              {P.phases.map((ph) => (
                <span key={ph.label} className="kc-phases__when">
                  {ph.when}
                </span>
              ))}
              {P.phases.map((ph) => (
                <ul key={ph.label} className="kc-phases__list">
                  {ph.items.map((it) => (
                    <li key={it.t} className={it.kind ? `is-${it.kind}` : undefined}>
                      {it.t}
                    </li>
                  ))}
                </ul>
              ))}
            </div>
            <ul className="kc-rs-legend">
              <li className="is-internal">{P.legend.internal}</li>
              <li className="is-external">{P.legend.external}</li>
            </ul>
          </div>
        </div>
        <ol className="kc-rs-numbered">
          {P.steps.map((s) => (
            <li key={s.b}>
              <b>{s.b}</b>
              {s.t ? `: ${s.t}` : null}
            </li>
          ))}
        </ol>
      </div>
    </RsSheet>
  );
}

// ── C23 수행 절차 2 — 이중 중대성 평가 개념·필요성 ──
export function MaterialityPage({ ctx }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const M = RC.materiality;
  const box = (b: { title: string; items: string[] }, cls: string) => (
    <div className={`kc-rs-dma__box ${cls}`}>
      <p className="kc-rs-dma__box-title">{b.title}</p>
      <ul>
        {b.items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
  return (
    <RsSheet ctx={ctx} sec="R6" anchors={["c23-2"]} outline={M.title}>
      <RsTitle lead={M.title} />
      <div className="kc-rs-panel kc-rs-dma">
        <section className="kc-rs-dma__concept">
          <RsMini>{M.conceptTitle}</RsMini>
          <p className="kc-rs-dma__text">
            {M.concept.map((c, i) => (c.b ? <b key={i}>{c.t}</b> : <span key={i}>{c.t}</span>))}
          </p>
          <div className="kc-rs-dma__diagram">
            <span className="kc-rs-dma__side kc-rs-dma__side--out">
              <Icon name={M.outside.icon} />
              <b>{M.outside.label}</b>
              <small>{M.outside.en}</small>
            </span>
            {box(M.financial, "kc-rs-dma__box--fin")}
            {box(M.impact, "kc-rs-dma__box--imp")}
            <span className="kc-rs-dma__side kc-rs-dma__side--in">
              <Icon name={M.company.icon} />
              <b>{M.company.label}</b>
            </span>
          </div>
        </section>
        <section className="kc-rs-dma__needs">
          <RsMini>{M.needTitle}</RsMini>
          <ol className="kc-rs-needs">
            {M.needs.map((nd, i) => (
              <li key={nd.title}>
                <span className="kc-rs-needs__head">
                  <b className="kc-num">{String(i + 1).padStart(2, "0")}</b>
                  {nd.title}
                </span>
                <ul className="kc-rs-bullets">
                  {nd.items.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </RsSheet>
  );
}

// ── C23 수행 절차 3 — 이중 중대성 평가 프로세스(STEP 1~5) ──
export function MaterialityStepsPage({ ctx }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const S = RC.materialitySteps;
  return (
    <RsSheet ctx={ctx} sec="R6" anchors={["c23-3"]} outline={S.title}>
      <RsTitle lead={RC.materiality.title} />
      <div className="kc-rs-panel kc-rs-stepspage">
        <RsMini>{S.title}</RsMini>
        <ol className="kc-rs-steps">
          {S.steps.map((st, i) => (
            <li key={st.title} className="kc-rs-steps__col">
              <span className="kc-rs-steps__head">
                <span className="kc-rs-steps__no">
                  STEP<b className="kc-num">{i + 1}</b>
                </span>
                <span className="kc-rs-steps__title">{st.title}</span>
              </span>
              {st.subs ? (
                <span className="kc-rs-steps__subs">
                  {st.subs.map((sb) => (
                    <span key={sb.title} className="kc-rs-steps__sub">
                      <b>{sb.title}</b>
                      <span>{sb.text}</span>
                    </span>
                  ))}
                </span>
              ) : (
                <ul className="kc-rs-bullets kc-rs-steps__body">
                  {st.items.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </div>
    </RsSheet>
  );
}

// ── C23 수행 절차 4 — ESG 경영보고서 작성(작성 틀 + P·E·S·G 작성 항목 + 원스톱 띠) ──
export function ReportWritingPage({ ctx }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const R = RC.report;
  return (
    <RsSheet ctx={ctx} sec="R6" anchors={["c23-4"]} outline={R.title}>
      <RsTitle lead={R.title} />
      <div className="kc-rs-panel kc-rs-report">
        <div className="kc-rs-report__top">
          <div className="kc-rs-report__lead">
            <p className="kc-rs-report__headline">
              {R.headline[0]}
              <br />
              {R.headline[1]}
            </p>
            <table className="kc-rs-report__frame">
              <tbody>
                {R.frame.map((f) => (
                  <tr key={f.en}>
                    <th>{f.en}</th>
                    <td className="kc-rs-report__ko">{f.ko}</td>
                    <td>{f.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="kc-rs-report__mix" aria-label={`${R.pesgAside} 구성`}>
            <p className="kc-rs-report__mix-title">
              작성 항목 구성 <b className="kc-num">{R.pesg.reduce((a, p) => a + p.count, 0)}</b>개
            </p>
            <div className="kc-rs-report__bar">
              {R.pesg.map((p) => (
                <span key={p.key} className={`kc-area-${p.area}`} style={{ flexGrow: p.count }}>
                  {p.key}
                </span>
              ))}
            </div>
            <ul className="kc-rs-report__legend">
              {R.pesg.map((p) => (
                <li key={p.key} className={`kc-area-${p.area}`}>
                  <b>{p.key}</b> {p.name} <span className="kc-num">{p.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="kc-rs-report__pesg-title">
          {R.pesgTitle} <small>({R.pesgAside})</small>
        </p>
        <div className="kc-rs-pesg">
          {R.pesg.map((p) => (
            <div key={p.key} className={`kc-rs-pesg__card kc-area-${p.area}`}>
              <p className="kc-rs-pesg__head">
                <b>{p.key}</b>
                {p.name} <small>{p.en}</small> <span className="kc-num">({p.count}개)</span>
              </p>
              <ul>
                {p.items.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="kc-rs-onestop">
          <b>{R.oneStop.label}</b>
          <span>{R.oneStop.steps.join(" → ")}</span>
        </p>
      </div>
    </RsSheet>
  );
}

// ── C13 임원 이력 현황(한 쪽 2명 — 기본 정보 표 + 주요 경력 + 참여 용역) ──
export const RS_LEADERS_PER_PAGE = 2;

/** 경력 요약 → 줄 목록("38년 · 前 환경부 부이사관, 원주청 기획국장" → ["환경부 부이사관", "원주청 기획국장"]) */
export function careerItems(career: string): string[] {
  return career
    .replace(/^\s*\d+\s*년\s*·\s*/, "")
    .split(/\s*·\s*|,\s*/)
    .map((t) => t.replace(/^(前|現)\s*/, "").trim())
    .filter((t) => t && !/^(경력\s*)?\d+\s*년$/.test(t));
}

/** 두 개씩 묶기(주요 경력 2열 표) */
const pairs = <T,>(list: T[]): Array<[T, T | undefined]> => {
  const out: Array<[T, T | undefined]> = [];
  for (let i = 0; i < list.length; i += 2) out.push([list[i], list[i + 1]]);
  return out;
};

export function ResearchCvPage({
  ctx,
  data,
  people,
  part,
  parts,
}: {
  ctx: RenderCtx;
  data: CatalogRenderData;
  people: LeaderCard[];
  part: number;
  parts: number;
}) {
  const masked = ctx.opts.naming === "masked";
  const cvOf = (key: string): PersonCv | undefined => data.people.find((p) => p.key === key);
  return (
    <RsSheet ctx={ctx} sec="R7" anchors={[`c13-${part + 1}`]} outline={part === 0 ? "임원 이력 현황" : undefined} first={part === 0}>
      <RsTitle lead="임원 이력 현황" aside={parts > 1 ? `${part + 1}/${parts}` : undefined} />
      <div className="kc-rs-panel kc-rs-cvs">
        {people.map((p) => {
          const cv = cvOf(p.key);
          const careers = careerItems(p.career).slice(0, 6);
          const projects = cv?.projects ?? [];
          return (
            <article key={p.key} className={cx("kc-rs-cv", !projects.length && "kc-rs-cv--solo")}>
              <RsMini>{p.role}</RsMini>
              <div className="kc-rs-cv__grid">
                <div className="kc-rs-cv__info">
                  <table className="kc-rs-cvt">
                    <tbody>
                      <tr>
                        <th>성명</th>
                        <td className={masked ? "kc-mask" : undefined}>{p.name}</td>
                        <th>소속</th>
                        <td>{data.company.name}</td>
                        <th>직책</th>
                        <td>{p.role}</td>
                      </tr>
                      <tr>
                        <th>학력</th>
                        <td colSpan={5}>{p.edu || "-"}</td>
                      </tr>
                      <tr>
                        <th>
                          해당분야
                          <br />
                          근무경력
                        </th>
                        <td className="kc-num">{p.careerYears != null ? `${p.careerYears}년` : "-"}</td>
                        <th>자격증</th>
                        <td colSpan={3}>{p.cert || "-"}</td>
                      </tr>
                    </tbody>
                  </table>
                  <table className="kc-rs-cvt kc-rs-cvt--list">
                    <thead>
                      <tr>
                        <th colSpan={2}>주요 경력</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pairs(careers.length ? careers : ["-"]).map(([x, y], i) => (
                        <tr key={i}>
                          <td>{x}</td>
                          <td>{y ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {projects.length ? (
                  <table className="kc-rs-cvt kc-rs-cvt--projects">
                    <thead>
                      <tr>
                        <th colSpan={2}>경력(참여 용역)</th>
                      </tr>
                      <tr>
                        <th>연도</th>
                        <th>사업명 — 담당</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projects.map((pr, i) => (
                        <tr key={i}>
                          <td className="kc-num">{pr.year}</td>
                          <td>{pr.title}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {part === parts - 1 ? (
        <Foot items={[`* ${asOfNote(data)}. 근무경력은 이전 직장 경력을 포함합니다.${masked ? " 이름 가운데 글자를 ○ 로 가렸고, 참여 용역은 실명판에만 싣습니다." : ""}`]} />
      ) : null}
    </RsSheet>
  );
}

// ── C15 분야별 참여인력 현황 — 내부(흐름 표) ──
function RsTablePage({
  ctx,
  anchor,
  head,
  columns,
  rows,
  footnote,
  first,
}: {
  ctx: RenderCtx;
  first?: boolean;
  anchor: string;
  head: string;
  columns: Array<{ head: string; width?: number }>;
  rows: Array<Array<{ text: string; cls?: string }>>;
  footnote: string;
}) {
  return (
    <RsSheet ctx={ctx} sec="R7" anchors={[anchor]} outline={head} flow first={first}>
      <RsTitle lead="분야별 참여인력 현황" />
      <p className="kc-rs-dia" data-continued-title="">
        ❖ {head}
      </p>
      <div className="pk-col" data-widget="table">
        <div data-split="rows">
          <table className="kc-table kc-rs-ptable">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.head} style={c.width ? { width: c.width } : undefined}>
                    {c.head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody data-split-box="">
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j} className={cell.cls}>
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Foot items={[footnote]} />
    </RsSheet>
  );
}

export function ResearchStaffPage({ ctx, data, first }: { ctx: RenderCtx; data: CatalogRenderData; first?: boolean }) {
  const masked = ctx.opts.naming === "masked";
  const rows = [
    ...data.leaders.map((l) => [l.role, l.name, l.edu || "-", l.careerYears != null ? `${l.careerYears}년` : "-", l.dept || "-"]),
    ...data.staffRows.map((r) => [r.position, r.name, r.edu || "-", r.years != null ? `${r.years}년` : "-", r.dept || "-"]),
  ].map(([role, name, edu, years, dept]) => [{ text: role }, { text: name, cls: masked ? "kc-mask" : undefined }, { text: edu }, { text: years, cls: "n" }, { text: dept }]);
  return (
    <RsTablePage
      ctx={ctx}
      anchor="c15-staff"
      first={first}
      head={`수행 인력(내부): 총 ${fmt(rows.length)}명`}
      columns={[{ head: "참여직위", width: 120 }, { head: "성명", width: 64 }, { head: "학력", width: 210 }, { head: "해당분야 근무경력", width: 96 }, { head: "본사업 담당(소속)" }]}
      rows={rows}
      footnote={`* ${asOfNote(data)}. 임원과 기술인력(회사소개서 인력 설정에서 고른 사람)입니다. 근무경력은 이전 직장 경력을 포함합니다.${masked ? " 이름 가운데 글자를 ○ 로 가렸습니다." : ""}`}
    />
  );
}

// ── C15 분야별 참여인력 현황 — 외부(자문위원, 흐름 표) ──
export function ResearchAdvisorsPage({ ctx, data, first }: { ctx: RenderCtx; data: CatalogRenderData; first?: boolean }) {
  const masked = ctx.opts.naming === "masked";
  return (
    <RsTablePage
      ctx={ctx}
      anchor="c15-advisors"
      first={first}
      head={`수행 인력(외부): 총 ${fmt(data.advisors.length)}명`}
      columns={[{ head: "분야", width: 110 }, { head: "성명", width: 64 }, { head: "소속", width: 170 }, { head: "직위", width: 80 }, { head: "주요 경력" }]}
      rows={data.advisors.map((a) => [{ text: a.field }, { text: a.name, cls: masked ? "kc-mask" : undefined }, { text: a.org }, { text: a.title }, { text: a.career }])}
      footnote={`* 분야별 자문위원입니다. 前 = 전 직위, 現 = 현 직위.${masked ? " 이름 가운데 글자를 ○ 로 가렸습니다." : ""}`}
    />
  );
}

// ── C12 사업 수행 조직(역할 조직도) ──
export function ResearchTeamPage({ ctx, first }: { ctx: RenderCtx; data: CatalogRenderData; first?: boolean }) {
  const T = RC.team;
  return (
    <RsSheet ctx={ctx} sec="R7" anchors={["c12"]} outline={T.title} first={first}>
      <RsTitle lead={T.title} />
      <div className="kc-rs-panel kc-rs-team">
        <div className="kc-rs-team__lead">
          <b>{T.lead}</b>
        </div>
        <div className="kc-rs-team__support">
          <b>{T.support.title}</b>
          <ul>
            {T.support.items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div className="kc-rs-team__core">{T.core}</div>
        <div className="kc-rs-team__units">
          {T.units.map((u) => (
            <div key={u.key} className={`kc-rs-team__unit kc-area-${u.area}`}>
              <b>{u.label}</b>
              <ul>
                {u.items.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="kc-rs-team__base">{T.base}</div>
      </div>
    </RsSheet>
  );
}

// ── A02 용역 수행실적 1 — 분야별 그룹(왼쪽 판 + 그룹 행) ──
/** 수행실적 그룹 순서 — ESG(4) → 통합환경허가(1) → 환경 인허가·연구·교육(5) → 장외·화관법(2) → HAPs(3). 응용소프트웨어(6)는 계약 실적이 따로 없어 뺀다 */
export const RS_RECORD_ORDER = [4, 1, 5, 2, 3];

export function ResearchRecordsPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const groups = RS_RECORD_ORDER.map((i) => data.areas.find((a) => a.index === i)).filter((a): a is AreaInfo => Boolean(a && (a.featured.length || a.count)));
  return (
    <RsSheet ctx={ctx} sec="R8" anchors={["a02-r"]} outline="용역 수행실적" first>
      <div className="kc-rs-records">
        <div className="kc-rs-records__panel">
          <span className="kc-rs-records__mark" aria-hidden="true">
            <Icon name="award" />
          </span>
          <p>
            {data.company.name}
            <br />
            {RC.recordsPanel}
          </p>
          <img src={ctx.url(LOGO_WHITE)} alt="" />
        </div>
        <div className="kc-rs-records__groups">
          {groups.map((a) => (
            <section key={a.index} className={`kc-rs-records__group kc-area-${a.index}`}>
              <p className="kc-rs-records__label">
                {a.name}
                <small>
                  누적 <span className="kc-num" data-metric={`projects.area.${a.index}`}>{fmt(a.count)}</span>건
                </small>
              </p>
              <ul className="kc-rs-records__list">
                {a.featured.map((f, i) => (
                  <li key={i} className={i === 0 && a.index === 4 ? "is-strong" : undefined}>
                    {f.title}
                    {f.meta ? <span className="kc-rs-records__meta">({f.meta})</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
      <Foot items={[`* ${asOfNote(data)}. 분야별 대표 실적(계약 관리에서 대표 실적으로 표시한 계약, 없으면 금액 순)과 누적 계약 수입니다.`]} />
    </RsSheet>
  );
}

// ── A02 용역 수행실적 2 — ESG 경영 컨설팅 · 기타 연구용역(두 단 카드) ──
/** 두 단 카드 한 단의 최대 건수 */
export const RS_CASES_PER_COL = 5;

/** 분야의 수행실적 카드 — 부록 B 실적 행(대표 실적 먼저, 최근 순). 부록 행이 없으면 분야 대표 실적 */
export function caseCards(data: CatalogRenderData, area: AreaInfo | undefined, max = RS_CASES_PER_COL) {
  if (!area) return [];
  const sec = data.appendix.sections.find((s) => s.category === area.category);
  const rows = (sec?.years ?? []).flatMap((y) => y.rows);
  if (!rows.length) return area.featured.slice(0, max).map((f) => ({ title: f.title, period: f.meta || f.year, meta: "", ongoing: false }));
  return [...rows]
    .sort((a, b) => Number(b.featured) - Number(a.featured) || b.year.localeCompare(a.year))
    .slice(0, max)
    .map((r) => ({ title: r.title, period: r.period || r.year, meta: [r.detail, r.region, r.industry].filter(Boolean).join(" · "), ongoing: r.status === "ongoing" }));
}

export function ResearchCasesPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const col = (title: string, area: AreaInfo | undefined) => (
    <section className="kc-rs-cases__col">
      <RsTitle lead={title.replace(/ 수행 실적$/, "")} em="수행 실적" />
      <div className={`kc-rs-cases__cards kc-area-${area?.index ?? 4}`}>
        {caseCards(data, area).map((c, i) => (
          <article key={i} className="kc-rs-case">
            <p className="kc-rs-case__title">
              {c.title}
              {c.period ? <span className="kc-num">({c.period})</span> : null}
            </p>
            {c.meta || c.ongoing ? (
              <p className="kc-rs-case__meta">
                {c.ongoing ? <b>수행 중</b> : null}
                {c.meta}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
  return (
    <RsSheet ctx={ctx} sec="R8" anchors={["a02-cases"]} outline={RC.recordsEsgTitle}>
      <div className="kc-rs-cases">
        {col(RC.recordsEsgTitle, data.areas.find((a) => a.index === 4))}
        {col(RC.recordsOtherTitle, data.areas.find((a) => a.index === 5))}
      </div>
      <Foot items={[`* ${asOfNote(data)}. 분야별 수행실적 목록(부록 B 규칙)에서 대표 실적을 먼저, 최근 순으로 ${RS_CASES_PER_COL}건씩 실었습니다.`]} />
    </RsSheet>
  );
}

// ── C19 뒤표지 Thank you ──
export function ResearchBackPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const lines: Array<{ icon: string; text: ReactNode }> = [];
  if (data.company.email) lines.push({ icon: "mail", text: data.company.email });
  if (data.company.website) lines.push({ icon: "globe", text: data.company.website });
  if (data.company.phone) lines.push({ icon: "phone", text: <span className="kc-num">{data.company.phone.replace(/-/g, ".")}</span> });
  const offices = data.offices.map((o) => `${o.name}: ${o.address}`);
  return (
    <Sheet ctx={ctx} cls="kc-backc kc-backc--thanks kc-nofoot" anchors={["back"]}>
      <p className="kc-backc__thanks">{RC.thanks}</p>
      <div className="kc-backc__foot-band"></div>
      <ul className="kc-rs-contact">
        {lines.map((l, i) => (
          <li key={i}>
            <Icon name={l.icon} />
            {l.text}
          </li>
        ))}
        <li>
          <Icon name="house" />
          <span>
            {offices.map((o, i) => (
              <span key={i}>
                {i > 0 ? <br /> : null}
                {o}
              </span>
            ))}
          </span>
        </li>
      </ul>
      <img className="kc-rs-contact__logo" src={ctx.url(LOGO_WHITE)} alt={LOGO_ALT} />
    </Sheet>
  );
}
