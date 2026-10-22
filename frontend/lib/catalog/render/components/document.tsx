/*
 * 회사소개서 마스터본 쪽 구성 — 데이터에서 쪽을 조립한다(블루프린트 §3-1 목차 순서).
 * 데이터가 없는 쪽(인사말 확정판 없음, 자문위원 0명, 고객사 0곳 등)은 빼고, 흐름 쪽(명단·부록)은 paginate 가 쪽을 늘린다.
 */
import type { CatalogRenderData, HistoryYear, LeaderCard, RenderCtx } from "../types";
import { DIVIDER_CONTENT, SECTIONS } from "../master-content";
import { BusinessMapPage, AreaPage, CasePage, PlatformPage, SoftwarePage, StrengthsPage } from "./pages-business";
import { ContentsPage, CoverPage, DividerPage, FiguresPage, HistoryPage, MessagePage, OverviewPage, type CoverChoice } from "./pages-front";
import { AdvisorsPage, LeadersPage, OrgPage, PeopleDetailPage, StaffListPage, StaffPage } from "./pages-people";
import { BackCoverPage, ClientsPage, ContactPage, CredentialsPage } from "./pages-trust";
import { ProjectListPage, SummaryPage } from "./pages-appendix";

/** 연혁 쪽 나누기 — 한 쪽에 연도 8개·항목 18줄까지(가로 연대표가 좁아지거나 넘치지 않게) */
function chunkHistory(years: HistoryYear[]): HistoryYear[][] {
  const out: HistoryYear[][] = [];
  let cur: HistoryYear[] = [];
  let items = 0;
  for (const y of years) {
    if (cur.length && (cur.length >= 8 || items + y.items.length > 18)) {
      out.push(cur);
      cur = [];
      items = 0;
    }
    cur.push(y);
    items += y.items.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function CatalogDocument({ ctx, data, cover }: { ctx: RenderCtx; data: CatalogRenderData; cover: CoverChoice }) {
  const historyParts = chunkHistory(data.history);
  const leaderParts: LeaderCard[][] = chunk(data.leaders, 6);
  const consulting = data.areas.filter((a) => a.index <= 5);
  const software = data.areas.find((a) => a.index === 6)!;
  const appendixSections = data.appendix.sections
    .map((sec) => ({ sec, area: data.areas.find((a) => a.category === sec.category)! }))
    .filter((x) => x.sec.shownRows > 0);
  const sec03 = SECTIONS.find((s) => s.key === "03")!;
  return (
    <>
      <CoverPage ctx={ctx} data={data} choice={cover} />
      <ContentsPage ctx={ctx} data={data} />
      {data.ceoMessage ? <MessagePage ctx={ctx} data={data} /> : null}
      {/* 인사말이 없으면 숫자로 보는 KESI 가 01 섹션의 첫 쪽 */}
      <FiguresPage ctx={ctx} data={data} sectionStart={!data.ceoMessage} />
      <OverviewPage ctx={ctx} data={data} />
      {historyParts.map((years, i) => (
        <HistoryPage key={i} ctx={ctx} data={data} years={years} part={i} parts={historyParts.length} />
      ))}
      <DividerPage
        ctx={ctx}
        num="02"
        title="사업 분야"
        lead={DIVIDER_CONTENT["02"].lead}
        anchor="sec-02"
        items={data.areas.map((a) => ({ label: a.name, area: a.index, ref: `area-${a.index}` }))}
      />
      <BusinessMapPage ctx={ctx} data={data} />
      {consulting.map((a) => (
        <AreaPage key={a.index} ctx={ctx} data={data} area={a} />
      ))}
      <SoftwarePage ctx={ctx} data={data} area={software} />
      <PlatformPage ctx={ctx} data={data} />
      <DividerPage
        ctx={ctx}
        num="03"
        title={sec03.name}
        lead={DIVIDER_CONTENT["03"].lead}
        anchor="sec-03"
        items={[
          { label: "핵심 역량", ref: "c10" },
          { label: "대표 성공 사례", ref: "c11" },
        ]}
      />
      <StrengthsPage ctx={ctx} data={data} />
      <CasePage ctx={ctx} data={data} />
      <OrgPage ctx={ctx} data={data} />
      {leaderParts.map((people, i) => (
        <LeadersPage key={i} ctx={ctx} data={data} people={people} part={i} parts={leaderParts.length} />
      ))}
      <StaffPage ctx={ctx} data={data} />
      {data.staffRows.length ? <StaffListPage ctx={ctx} data={data} /> : null}
      {data.advisors.length ? <AdvisorsPage ctx={ctx} data={data} /> : null}
      {data.credentials.length ? <CredentialsPage ctx={ctx} data={data} /> : null}
      {data.clients.length ? <ClientsPage ctx={ctx} data={data} /> : null}
      <ContactPage ctx={ctx} data={data} />
      <SummaryPage ctx={ctx} data={data} />
      {appendixSections.map(({ sec, area }) => (
        <ProjectListPage key={sec.category} ctx={ctx} data={data} area={area} sec={sec} />
      ))}
      {ctx.opts.naming === "real" && data.people.length ? <PeopleDetailPage ctx={ctx} data={data} /> : null}
      <BackCoverPage ctx={ctx} data={data} />
    </>
  );
}
