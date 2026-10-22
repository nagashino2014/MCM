/*
 * 회사소개서 조직·사람 쪽 유형 — C12 조직도 · C13 임원진 · C14 기술인력 현황 · C15 명단(기술인력·자문위원) · A03 수행인력 상세 이력.
 * 명단·상세 이력은 흐름 쪽(paginate)이라 사람이 늘면 쪽이 늘어난다. 표는 머리 행을 반복하고 '(계속)'을 붙인다.
 */
import type { CatalogRenderData, LeaderCard, RenderCtx } from "../types";
import { Bars, Donut, HBars, OrgChart } from "./infographics";
import { Foot, Head, Kpi, M, Notes, Sheet, TitleBlock, asOfNote, fmt, mval } from "./parts";

// ── C12 조직 ──
export function OrgPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const units = data.orgChart.nodes[0]?.children.filter((c) => !c.badge && c.children.length > 0).length ?? 0;
  const advisors = mval(data, "advisors.total") ?? 0;
  return (
    <Sheet ctx={ctx} anchors={["sec-04", "c12"]} section="04 조직과 사람" outline="조직">
      <Head ctx={ctx} num="04" name="조직과 사람" sub="조직" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
        <TitleBlock eyebrow="조직" title={units ? `${units}개 본부와 연구소·지사로 일합니다` : "조직"} />
        <div className="kc-stats" style={{ gap: 20, flex: "none" }}>
          {(
            [
              ["staff.total", "임직원"],
              ["staff.technical", "기술인력"],
              ["advisors.total", "자문위원"],
            ] as const
          ).map(([id, label]) => (
            <div className="kc-stat" key={id}>
              <span className="kc-stat__fig" style={{ fontSize: 24, lineHeight: "28px" }} data-metric={id}>
                {fmt(mval(data, id))}
                <small>명</small>
              </span>
              <span className="kc-ig__desc">{label}</span>
            </div>
          ))}
        </div>
      </div>
      <OrgChart doc={data.orgChart} advisorsLabel={advisors > 0 ? `매체별 ${fmt(advisors)}명` : undefined} />
      <Foot items={[`* ${asOfNote(data)}. 인원은 사용자관리 등록 재직자 기준입니다.`]} />
      <Notes items={["* 조직은 회사소개서 > 조직도의 최신 확정판(없으면 MCM 조직 마스터 기본안)으로 그립니다. 본부 위 색 띠는 그 본부가 주로 맡는 사업 분야 색입니다."]} />
    </Sheet>
  );
}

// ── C13 임원진 ──
function PersonCard({ ctx, p }: { ctx: RenderCtx; p: LeaderCard }) {
  return (
    <div className="kc-person" style={{ gridTemplateColumns: "74px minmax(0, 1fr)" }}>
      {p.photo ? (
        <div className="kc-photo kc-person__photo">
          <img src={ctx.url(p.photo)} alt={p.name} />
        </div>
      ) : (
        <div className="kc-person__initial">{p.initial}</div>
      )}
      <div style={{ minWidth: 0 }}>
        <p>
          <span className="kc-person__name">{p.name}</span>
          <span className="kc-person__role">{p.role}</span>
        </p>
        {p.manual ? (
          <span className="kc-badge kc-badge--line" style={{ margin: "3px 0 1px" }}>
            {ctx.opts.edition === "draft" ? "촉탁 · 직접 입력" : "촉탁"}
          </span>
        ) : null}
        <ul className="kc-person__meta">
          {p.edu ? (
            <li>
              <b>학력</b>
              {p.edu}
            </li>
          ) : null}
          {p.cert ? (
            <li>
              <b>자격</b>
              {p.cert}
            </li>
          ) : null}
          {p.career ? (
            <li>
              <b>경력</b>
              {p.career}
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

export function LeadersPage({ ctx, data, people, part, parts }: { ctx: RenderCtx; data: CatalogRenderData; people: LeaderCard[]; part: number; parts: number }) {
  const n = data.leaders.length;
  return (
    <Sheet ctx={ctx} anchors={["c13"]} outline={part === 0 ? "임원진" : undefined}>
      <Head ctx={ctx} num="04" name="조직과 사람" sub={parts > 1 ? `임원진 ${part + 1}/${parts}` : "임원진"} />
      <TitleBlock eyebrow="임원진" title={part === 0 ? `임원 ${fmt(n)}명${data.leaderAvgCareer != null ? `, 경력 평균 ${fmt(data.leaderAvgCareer)}년` : ""}` : "임원진(계속)"} />
      <div className="kc-people" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", flex: 1, minHeight: 0, alignContent: "start" }}>
        {people.map((p) => (
          <PersonCard key={p.key} ctx={ctx} p={p} />
        ))}
      </div>
      <Foot items={[`* ${asOfNote(data)}. 경력은 이전 직장 경력을 포함한 연수입니다.${ctx.opts.naming === "masked" ? " 이름 가운데 글자를 ○ 로 가렸습니다." : ""}`]} />
      <Notes items={["* 임원은 사용자관리에서 직급이 부장보다 높은 사람을 자동으로 넣고, 촉탁 임원은 인물 노출 관리에서 직접 입력합니다. 사진은 게재 동의자만 싣습니다."]} />
    </Sheet>
  );
}

// ── C14 기술인력 현황 ──
export function StaffPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const st = data.staffStats;
  const extraExec = (mval(data, "staff.exec") ?? 0) - data.leaders.filter((l) => !l.manual).length;
  const d = st.degrees;
  const degreeParts = [
    { label: "박사", value: d.doctor, cls: "kc-s1" },
    { label: "석사", value: d.master, cls: "kc-s2" },
    { label: "학사", value: d.bachelor, cls: "kc-s4" },
    ...(d.other ? [{ label: "기타", value: d.other, cls: "kc-s5" }] : []),
  ];
  return (
    <Sheet ctx={ctx} anchors={["c14"]} outline="기술인력 현황">
      <Head ctx={ctx} num="04" name="조직과 사람" sub="기술인력 현황" />
      <TitleBlock eyebrow="기술인력 현황" title={<>전문 자격을 갖춘 기술인력 <span data-metric="staff.technical">{fmt(st.technical)}</span>명</>} />
      <div className="kc-kpis" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        <Kpi
          label="임직원"
          value={<M data={data} id="staff.total" />}
          unit="명"
          note={
            <>
              임원 <span data-metric="staff.exec">{fmt(mval(data, "staff.exec"))}</span>
              {extraExec > 0 ? `(촉탁 ${extraExec})` : ""} · 직원 <span data-metric="staff.employee">{fmt(mval(data, "staff.employee"))}</span>
            </>
          }
        />
        <Kpi label="기술인력" value={<M data={data} id="staff.technical" />} unit="명" note={data.offices.map((o) => o.name).join(" · ")} />
        <Kpi label="기술사·박사" value={fmt(st.experts)} unit="명" note={st.expertNote || undefined} />
        <Kpi label="평균 경력" value={fmt(st.avgCareer)} unit="년" note="이전 직장 경력 포함" />
      </div>
      <div className="kc-grid" style={{ flex: 1, minHeight: 0 }}>
        <section className="kc-span-5 kc-ig">
          <p className="kc-blockhead">
            자격 보유 인원<span className="kc-blockhead__aside">단위: 명, 복수 자격은 각각 셈</span>
          </p>
          <HBars rows={st.certs} />
        </section>
        <section className="kc-span-4 kc-ig">
          <p className="kc-blockhead">
            학위 구성<span className="kc-blockhead__aside">{fmt(st.population)}명</span>
          </p>
          <Donut parts={degreeParts} centerValue={fmt(st.population)} centerUnit="명" />
        </section>
        <section className="kc-span-3 kc-ig">
          <p className="kc-blockhead">
            경력 분포<span className="kc-blockhead__aside">명</span>
          </p>
          <Bars
            cols={[
              { label: "20년+", value: st.careerBuckets[0] },
              { label: "10–19", value: st.careerBuckets[1] },
              { label: "5–9", value: st.careerBuckets[2] },
              { label: "1–4", value: st.careerBuckets[3] },
            ]}
          />
        </section>
      </div>
      <Foot items={[`* ${asOfNote(data)}. 사용자관리에 등록된 재직자(촉탁 제외)의 인사 기록(학력·자격·경력)을 자동 집계합니다. 기술인력 = 통합허가 대행업 기술인력 등급(고급·일반)이 있는 인원.`]} />
    </Sheet>
  );
}

// ── C15 명단(흐름 쪽) ──
export interface TableColumn {
  head: string;
  width?: number;
  cls?: string;
}

export function PeopleTablePage({
  ctx,
  anchor,
  sub,
  eyebrow,
  title,
  caption,
  columns,
  rows,
  footnote,
  note,
}: {
  ctx: RenderCtx;
  anchor: string;
  sub: string;
  eyebrow: string;
  title: string;
  caption?: string;
  columns: TableColumn[];
  rows: Array<Array<{ text: string; cls?: string; bold?: boolean }>>;
  footnote: string;
  note?: string;
}) {
  return (
    <Sheet ctx={ctx} flow anchors={[anchor]} outline={sub} style={{ gap: 14 }}>
      <Head ctx={ctx} num="04" name="조직과 사람" sub={sub} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24 }}>
        <TitleBlock eyebrow={eyebrow} title={title} />
        {caption ? (
          <p className="kc-caption" style={{ maxWidth: 300, textAlign: "right" }} data-first-only="">
            {caption}
          </p>
        ) : null}
      </div>
      <div className="pk-col">
        <div data-split="rows">
          <table className="kc-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.head} style={c.width ? { width: c.width } : undefined} className={c.cls}>
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
                      {cell.bold ? <b>{cell.text}</b> : cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Foot items={[footnote]} />
      <Notes items={[note ?? ""]} />
    </Sheet>
  );
}

export function StaffListPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const masked = ctx.opts.naming === "masked";
  return (
    <PeopleTablePage
      ctx={ctx}
      anchor="c15-staff"
      sub="기술인력 명단"
      eyebrow="기술인력 명단"
      title={`직원 기술인력 ${fmt(data.staffRows.length)}명`}
      caption="학력·자격·경력은 인사 기록에서 자동으로 채웁니다."
      columns={[
        { head: "성명", width: 50 },
        { head: "직급", width: 56 },
        { head: "소속", width: 140 },
        { head: "학력", width: 170 },
        { head: "자격증" },
        { head: "경력", width: 40, cls: "n" },
      ]}
      rows={data.staffRows.map((r) => [
        { text: r.name, cls: masked ? "kc-mask" : undefined },
        { text: r.position },
        { text: r.dept },
        { text: r.edu || "-" },
        { text: r.certs || "-" },
        { text: r.years != null ? `${r.years}년` : "-", cls: "n" },
      ])}
      footnote={`* ${asOfNote(data)}. 경력은 이전 직장 경력을 포함합니다.${masked ? " 이름 가운데 글자를 ○ 로 가렸습니다." : ""}`}
    />
  );
}

export function AdvisorsPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  const masked = ctx.opts.naming === "masked";
  return (
    <PeopleTablePage
      ctx={ctx}
      anchor="c15-advisors"
      sub="자문위원"
      eyebrow="자문위원"
      title={`매체별 자문위원 ${fmt(data.advisors.length)}명`}
      caption="대기·수질·폐기물·토양·소음진동 등 매체별 전문가가 허가조건 협의와 기술 검토를 자문합니다."
      columns={[
        { head: "성명", width: 58 },
        { head: "전문 분야", width: 96 },
        { head: "소속", width: 150 },
        { head: "직위", width: 70 },
        { head: "주요 경력" },
      ]}
      rows={data.advisors.map((a) => [
        { text: a.name, cls: masked ? "kc-mask" : undefined },
        { text: a.field, bold: true },
        { text: a.org },
        { text: a.title },
        { text: a.career },
      ])}
      footnote={`* 前 = 전 직위, 現 = 현 직위.${masked ? " 이름 가운데 글자를 ○ 로 가렸습니다." : ""}`}
    />
  );
}

// ── A03 수행인력 상세 이력(실명판) ──
export function PeopleDetailPage({ ctx, data }: { ctx: RenderCtx; data: CatalogRenderData }) {
  return (
    <Sheet ctx={ctx} flow anchors={["a03"]} outline="부록 C 수행인력 상세 이력" style={{ gap: 14 }}>
      <Head ctx={ctx} num="부록 C" name="수행인력 상세 이력" sub="실명판 전용" />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <p className="kc-page-title" data-continued-title="" style={{ fontSize: 20, lineHeight: "28px" }}>
          수행인력 상세 이력
        </p>
        <span className="kc-draftmark">실명판(PQ·수의계약 제출)에만 싣습니다.</span>
      </div>
      <div className="pk-col" style={{ gap: 14 }}>
        {data.people.map((p) => (
          <article className="kc-cv" key={p.key} data-anchors={`cv-${p.key}`}>
            <div className="kc-cv__id">
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                {p.photo ? (
                  <div className="kc-photo kc-ratio-3x4" style={{ width: 66, flex: "none" }}>
                    <img src={ctx.url(p.photo)} alt={p.name} />
                  </div>
                ) : (
                  <div className="kc-person__initial" style={{ width: 66, flex: "none" }}>
                    {p.name.slice(0, 1)}
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span className="kc-person__name" style={{ fontSize: 15 }}>
                    {p.name}
                  </span>
                  <span className="kc-person__role" style={{ margin: 0 }}>
                    {p.role}
                  </span>
                  {p.years != null ? <span className="kc-caption">경력 {p.years}년</span> : null}
                </div>
              </div>
              {p.duty ? (
                <span className="kc-badge kc-badge--soft" style={{ alignSelf: "flex-start" }}>
                  {p.duty}
                </span>
              ) : null}
            </div>
            <div className="kc-cv__sections">
              <div>
                <p className="kc-blockhead">학력</p>
                <p className="kc-small">{p.edu || "-"}</p>
              </div>
              <div>
                <p className="kc-blockhead">자격</p>
                <p className="kc-small">{p.cert || "-"}</p>
              </div>
              <div>
                <p className="kc-blockhead">주요 경력</p>
                <p className="kc-small">{p.career || "-"}</p>
              </div>
              <div>
                <p className="kc-blockhead">
                  참여 용역<span className="kc-blockhead__aside">계약 관리 수행인력</span>
                </p>
                {p.projects.length ? (
                  <table className="kc-table kc-table--dense">
                    <tbody>
                      {p.projects.map((pr, i) => (
                        <tr key={i}>
                          <td className="n" style={{ width: 34 }}>
                            {pr.year}
                          </td>
                          <td>{pr.title}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="kc-small kc-muted">-</p>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      <Foot items={[`* ${asOfNote(data)}. 학력·자격·경력은 인사 기록, 참여 용역은 계약 관리의 수행인력 배정에서 자동으로 채웁니다.`]} />
    </Sheet>
  );
}

