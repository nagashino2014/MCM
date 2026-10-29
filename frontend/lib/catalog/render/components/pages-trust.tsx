/*
 * 회사소개서 신뢰 근거·연락 쪽 유형 — C16 인증·등록·특허 · C17 고객사·협력 기관 · C18 오시는 길 · C19 뒤표지.
 */
import { VISION_CONTENT } from "../master-content";
import type { CatalogRenderData, RenderCtx } from "../types";
import { KoreaMap } from "./infographics";
import { Drop, Foot, Head, Icon, Notes, Sheet, TitleBlock, asOfNote } from "./parts";

const LOGO = "k/assets/kesi-signature-ko.png";
const LOGO_ALT = "KESI ㈜한국환경안전연구원 Korean Environment Safety Institute Co. LTD";

// ── C16 인증·등록·특허 ──
/** 인증 보기 변형(TP2) — view: gallery(증서 썸네일 5열, 기본) | table(목록형 행, 격조 — 8건이 넘으면 2단) */
export function CredentialsPage({ ctx, data, variant }: { ctx: RenderCtx; data: CatalogRenderData; variant?: Record<string, string> }) {
  const counts = new Map<string, number>();
  for (const c of data.credentials) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  const title = ["등록", "인증", "특허", "수상"].filter((k) => counts.get(k)).map((k) => `${k} ${counts.get(k)}`).join(" · ");
  const table = variant?.view === "table";
  const grid = table
    ? { gridTemplateColumns: data.credentials.length > 8 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)", columnGap: 24, rowGap: 0 }
    : { gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "18px 16px" };
  return (
    <Sheet ctx={ctx} anchors={["sec-05", "c16"]} section="05 신뢰 근거" outline="인증·등록·특허">
      <Head ctx={ctx} num="05" name="신뢰 근거" sub="인증·등록·특허" />
      <TitleBlock eyebrow="인증·등록·특허" title={title || "인증·등록·특허"} />
      <div className={table ? "kc-creds kc-creds--table" : "kc-creds"} style={{ ...grid, flex: 1, minHeight: 0, alignContent: "start" }} data-widget="credentials">
        {data.credentials.map((c) => (
          <div className={table ? "kc-cred kc-cred--table" : "kc-cred"} key={c.key}>
            <div className="kc-cred__thumb">
              {c.image ? (
                <img src={ctx.url(c.image)} alt={c.name} style={{ display: "block", maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
              ) : (
                <Icon name="award" cls="kc-icon kc-icon--lg" />
              )}
            </div>
            <span className="kc-cred__kind">{c.kind}</span>
            <span className="kc-cred__name">{c.name}</span>
            {c.meta ? <span className="kc-cred__meta">{c.meta}</span> : null}
          </div>
        ))}
      </div>
      <Foot items={[`* ${asOfNote(data)}. 회사 프로필에 공개로 등록한 면허·인증·특허·수상입니다.`]} />
    </Sheet>
  );
}

// ── C17 주요 고객사·협력 기관 ──
/** @param sectionStart 신뢰 근거 섹션의 첫 쪽(인증 쪽이 없을 때 — 섹션 북마크·목차 앵커를 맡는다) */
export function ClientsPage({ ctx, data, sectionStart }: { ctx: RenderCtx; data: CatalogRenderData; sectionStart?: boolean }) {
  return (
    <Sheet ctx={ctx} anchors={sectionStart ? ["sec-05", "c17"] : ["c17"]} section={sectionStart ? "05 신뢰 근거" : undefined} outline="주요 고객사·협력 기관">
      <Head ctx={ctx} num="05" name="신뢰 근거" sub="주요 고객사·협력 기관" />
      <TitleBlock eyebrow="주요 고객사·협력 기관" title="공공기관과 발전·철강·화학·전자 사업장이 함께합니다" />
      <div className="kc-logowall" style={{ flex: 1, minHeight: 0, alignContent: "start" }} data-widget="logos">
        {data.clients.map((g) => (
          <div className="kc-logowall__group" key={g.label}>
            <p className="kc-logowall__label">
              {g.label}
              <span>{g.sub}</span>
            </p>
            <div className="kc-logowall__tiles">
              {g.items.map((it) => (
                <span className="kc-logo-tile" key={it.name}>
                  {it.logo ? <img src={ctx.url(it.logo)} alt={it.name} style={{ display: "block", maxWidth: "88%", maxHeight: "70%", objectFit: "contain" }} /> : it.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Foot items={["* 공개에 동의한 고객사·협력 기관만 싣습니다. 로고가 없는 곳은 이름으로 적습니다."]} />
    </Sheet>
  );
}

// ── C18 오시는 길 ──
export function ContactPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const pins = data.offices.map((o, i) => ({ lon: o.lon, lat: o.lat, label: o.name, left: i % 2 === 1 }));
  return (
    <Sheet ctx={ctx} anchors={["sec-06", "c18"]} section="06 오시는 길" outline="서울 본사 · 지사">
      <Head ctx={ctx} num="06" name="오시는 길" />
      <div className="kc-grid" style={{ flex: 1, minHeight: 0 }}>
        <div className="kc-span-4" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <TitleBlock eyebrow="오시는 길" title={data.offices.map((o) => o.name).join(" · ")} />
          <KoreaMap mode="pins" area={1} pins={pins} zoom={1.25} frame={{ width: 208, height: 373 }} root={{ "data-widget": "map" }} />
        </div>
        <div className="kc-span-8" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 24, alignContent: "start", paddingTop: 6 }}>
          {data.offices.map((o) => (
            <section className="kc-office" key={o.key}>
              <p className="kc-office__name">
                {o.name}
              </p>
              {o.photo ? (
                <figure style={{ display: "flex", flexDirection: "column", gap: 3, margin: 0 }}>
                  <div className="kc-photo kc-photo--soft kc-ratio-4x3">
                    <img src={ctx.url(o.photo)} alt={`${o.name} 사옥`} style={{ objectPosition: "50% 30%" }} />
                  </div>
                </figure>
              ) : null}
              <dl>
                <dt>주소</dt>
                <dd>{o.address}</dd>
                {o.transit.map((t) => (
                  <Transit key={t.label} label={t.label} text={t.text} />
                ))}
                {o.phone ? (
                  <>
                    <dt>전화</dt>
                    <dd className="kc-num">{o.phone}</dd>
                  </>
                ) : null}
              </dl>
            </section>
          ))}
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 24, paddingTop: 10, borderTop: "var(--stroke-hair) solid var(--rule)", fontSize: 9.5 }}>
            {data.company.website ? (
              <span>
                <b>홈페이지</b> {data.company.website}
              </span>
            ) : null}
            {data.company.email ? (
              <span>
                <b>대표 메일</b> {data.company.email}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <Notes items={["* 본사 주소·전화는 회사 프로필에서 자동으로 채웁니다. 지사 주소는 마스터본 콘텐츠에 있습니다."]} />
    </Sheet>
  );
}

function Transit({ label, text }: { label: string; text: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{text}</dd>
    </>
  );
}

// ── C19 뒤표지 ──
export function BackCoverPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const statement = data.company.vision ? data.company.vision.split(/\n/) : VISION_CONTENT.statement;
  return (
    <Sheet ctx={ctx} cls="kc-backc kc-nofoot" anchors={["back"]}>
      <Drop style={{ position: "absolute", width: 430, right: -150, top: -170, background: "var(--brand-tint)" }} />
      <Drop mods="kc-drop--line" style={{ position: "absolute", width: 250, right: -60, top: -80, color: "var(--paper)" }} />
      <div style={{ position: "absolute", left: 48, top: 128, width: 470, display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="kc-backc__eyebrow">Vision</span>
        <p className="kc-backc__statement">
          {statement.map((line, i) => (
            <span key={i}>
              {i > 0 ? <br /> : null}
              {line}
            </span>
          ))}
        </p>
        <p className="kc-backc__sub">
          {VISION_CONTENT.backSub[0]}
          <br />
          {VISION_CONTENT.backSub[1]}
        </p>
      </div>
      <div className="kc-backc__rule" style={{ position: "absolute", left: 48, right: 48, top: 420 }}></div>
      <div className="kc-backc__info" style={{ position: "absolute", left: 48, right: 48, top: 446 }}>
        <div className="kc-backc__col">
          <img src={ctx.url(LOGO)} alt={LOGO_ALT} style={{ display: "block", width: 168, height: "auto" }} />
        </div>
        {data.offices.map((o) => (
          <div className="kc-backc__col" key={o.key}>
            <span className="kc-backc__label">
              <b>{o.name}</b>
              {o.nameEn}
            </span>
            <p>
              {o.addressLines.map((l, i) => (
                <span key={i}>
                  {l}
                  <br />
                </span>
              ))}
              {o.phone ? (
                <>
                  T <span className="kc-num">{o.phone}</span>
                </>
              ) : null}
            </p>
          </div>
        ))}
        {data.company.website ? (
          <div className="kc-backc__col">
            <span className="kc-backc__label">
              <b>웹사이트</b>WEB
            </span>
            <p>{data.company.website}</p>
          </div>
        ) : null}
      </div>
      <div className="kc-backc__foot" style={{ position: "absolute", left: 48, right: 48, bottom: 26 }}>
        <span>
          {data.company.name} · {data.company.nameEn}
        </span>
        <span>회사소개서 {data.asOfLabel}</span>
      </div>
    </Sheet>
  );
}
