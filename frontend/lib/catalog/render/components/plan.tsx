/*
 * 회사소개서 쪽 구성(쪽 계획) — 데이터에서 쪽 목록을 만든다(블루프린트 §3-1 목차 순서).
 * 쪽마다 문서 안에서 고유한 키를 준다: 데이터가 바뀌어도(계약 추가 등) 같은 쪽은 같은 키라서
 * 스튜디오 편집층(catalog_pages, 키 = 쪽 키)이 그 쪽에 다시 붙는다.
 * 데이터가 없는 쪽(인사말 확정판 없음, 자문위원 0명, 고객사 0곳 등)은 빠지고, 흐름 쪽(명단·부록)은 paginate 가 쪽을 늘린다.
 */
import type { ReactElement } from "react";
import type { CatalogRenderData, HistoryYear, LeaderCard, RenderCtx } from "../types";
import { DIVIDER_CONTENT, SECTIONS } from "../master-content";
import { BusinessMapPage, AreaPage, CasePage, CustomAreaPage, PlatformPage, SoftwarePage, StrengthsPage } from "./pages-business";
import { ContentsPage, CoverPage, DividerPage, FiguresPage, HistoryPage, MessagePage, OverviewPage, type CoverChoice } from "./pages-front";
import { AdvisorsPage, LeadersPage, OrgPage, PeopleDetailPage, StaffListPage, StaffPage } from "./pages-people";
import { BackCoverPage, ClientsPage, ContactPage, CredentialsPage } from "./pages-trust";
import { ProjectListPage, SummaryPage } from "./pages-appendix";

/** 쪽 변형(L2) — 쪽 키별 저장값. 예: 분야 상세 { hero: "photo", photo: "a/cas_…" } */
export type PageVariant = Record<string, string>;

export interface PagePlanItem {
  /** 쪽 키(문서 안에서 고유·안정) */
  key: string;
  /** 쪽 유형(블루프린트 §3-2) */
  type: string;
  /** 쪽 이름(썸네일·북마크) */
  label: string;
  /** 섹션 키(SECTIONS.key, 표지·뒤표지는 "") */
  section: string;
  /** 편집 수준 상한 — 3 자유 배치까지, 2 구조까지, 1 글만(흐름·자동 분쪽 쪽) */
  maxLevel: 1 | 2 | 3;
  /** 흐름 쪽(paginate 가 쪽을 나눔) */
  flow: boolean;
  element: ReactElement;
}

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

export function buildPagePlan(ctx: RenderCtx, data: CatalogRenderData, cover: CoverChoice, variants: Record<string, PageVariant> = {}): PagePlanItem[] {
  const historyParts = chunkHistory(data.history);
  const leaderParts: LeaderCard[][] = chunk(data.leaders, 6);
  const consulting = data.areas.filter((a) => a.index <= 5);
  const software = data.areas.find((a) => a.index === 6)!;
  const appendixSections = data.appendix.sections
    .map((sec) => ({ sec, area: data.areas.find((a) => a.category === sec.category)! }))
    .filter((x) => x.sec.shownRows > 0);
  const sec03 = SECTIONS.find((s) => s.key === "03")!;
  const v = (key: string) => variants[key] ?? {};
  const out: PagePlanItem[] = [];
  const add = (key: string, type: string, label: string, section: string, element: ReactElement, opts: { maxLevel?: 1 | 2 | 3; flow?: boolean } = {}) =>
    out.push({ key, type, label, section, maxLevel: opts.maxLevel ?? 3, flow: opts.flow ?? false, element });

  add("c01", "C01", "표지", "", <CoverPage ctx={ctx} data={data} choice={cover} />);
  add("c02", "C02", "목차", "", <ContentsPage ctx={ctx} data={data} />, { maxLevel: 2 });
  if (data.ceoMessage) add("c03", "C03", "대표이사 인사말", "01", <MessagePage ctx={ctx} data={data} />);
  // 인사말이 없으면 숫자로 보는 KESI 가 01 섹션의 첫 쪽
  add("c04", "C04", "숫자로 보는 KESI", "01", <FiguresPage ctx={ctx} data={data} sectionStart={!data.ceoMessage} />);
  add("c05", "C05", "회사 개요·비전", "01", <OverviewPage ctx={ctx} data={data} variant={v("c05")} />);
  historyParts.forEach((years, i) =>
    add(`c06-${i + 1}`, "C06", historyParts.length > 1 ? `연혁 ${i + 1}/${historyParts.length}` : "연혁", "01", <HistoryPage ctx={ctx} data={data} years={years} part={i} parts={historyParts.length} />, {
      maxLevel: 2,
    })
  );
  add(
    "c07-02",
    "C07",
    "간지 · 사업 분야",
    "02",
    <DividerPage
      ctx={ctx}
      num="02"
      title="사업 분야"
      lead={DIVIDER_CONTENT["02"].lead}
      anchor="sec-02"
      items={[
        ...data.areas.map((a) => ({ label: a.name, area: a.index, ref: `area-${a.index}` })),
        ...(data.customAreas ?? []).map((a) => ({ label: a.name, area: a.slot, ref: a.key })),
      ]}
    />
  );
  add("c08", "C08", "사업 분야 개관", "02", <BusinessMapPage ctx={ctx} data={data} />);
  consulting.forEach((a) => add(`area-${a.index}`, "C09", a.name, "02", <AreaPage ctx={ctx} data={data} area={a} variant={v(`area-${a.index}`)} />));
  (data.customAreas ?? []).forEach((a) => add(a.key, "C09", a.name, "02", <CustomAreaPage ctx={ctx} data={data} area={a} />));
  add("c09-software", "C09", software.name, "02", <SoftwarePage ctx={ctx} data={data} area={software} />);
  add("c09-platform", "C09", "통합허가 플랫폼", "02", <PlatformPage ctx={ctx} data={data} />);
  add(
    "c07-03",
    "C07",
    `간지 · ${sec03.name}`,
    "03",
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
  );
  add("c10", "C10", "핵심 역량", "03", <StrengthsPage ctx={ctx} data={data} />);
  add("c11", "C11", "대표 성공 사례", "03", <CasePage ctx={ctx} data={data} />);
  add("c12", "C12", "조직", "04", <OrgPage ctx={ctx} data={data} />, { maxLevel: 2 });
  leaderParts.forEach((people, i) =>
    add(`c13-${i + 1}`, "C13", leaderParts.length > 1 ? `임원진 ${i + 1}/${leaderParts.length}` : "임원진", "04", <LeadersPage ctx={ctx} data={data} people={people} part={i} parts={leaderParts.length} />, {
      maxLevel: 2,
    })
  );
  add("c14", "C14", "기술인력 현황", "04", <StaffPage ctx={ctx} data={data} />, { maxLevel: 2 });
  if (data.staffRows.length) add("c15-staff", "C15", "기술인력 명단", "04", <StaffListPage ctx={ctx} data={data} />, { maxLevel: 2, flow: true });
  if (data.advisors.length) add("c15-advisors", "C15", "자문위원", "04", <AdvisorsPage ctx={ctx} data={data} />, { maxLevel: 2, flow: true });
  if (data.credentials.length) add("c16", "C16", "인증·등록·특허", "05", <CredentialsPage ctx={ctx} data={data} />, { maxLevel: 2 });
  if (data.clients.length) add("c17", "C17", "주요 고객사·협력 기관", "05", <ClientsPage ctx={ctx} data={data} />, { maxLevel: 2 });
  add("c18", "C18", "오시는 길", "06", <ContactPage ctx={ctx} data={data} />);
  // 요약본(P7 판 옵션)은 부록을 통째로 뺀다 — 목차의 부록 줄은 쪽을 못 찾으면 숨는다(data-ref-missing="hide")
  if (ctx.opts.scope !== "summary") {
    add("a01", "A01", "부록 A 수행실적 총괄", "부록", <SummaryPage ctx={ctx} data={data} />, { maxLevel: 1 });
    appendixSections.forEach(({ sec, area }) =>
      add(`a02-${area.index}`, "A02", `부록 B ${area.name}`, "부록", <ProjectListPage ctx={ctx} data={data} area={area} sec={sec} />, { maxLevel: 1, flow: true })
    );
    if (ctx.opts.naming === "real" && data.people.length) add("a03", "A03", "부록 C 수행인력 상세 이력", "부록", <PeopleDetailPage ctx={ctx} data={data} />, { maxLevel: 1, flow: true });
  }
  add("c19", "C19", "뒤표지", "", <BackCoverPage ctx={ctx} data={data} />);
  return out;
}
