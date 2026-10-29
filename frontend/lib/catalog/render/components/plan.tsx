/*
 * 회사소개서 쪽 구성(쪽 계획) — 데이터에서 쪽 목록을 만든다(블루프린트 §3-1 목차 순서).
 * 쪽마다 문서 안에서 고유한 키를 준다: 데이터가 바뀌어도(계약 추가 등) 같은 쪽은 같은 키라서
 * 스튜디오 편집층(catalog_pages, 키 = 쪽 키)이 그 쪽에 다시 붙는다.
 * 데이터가 없는 쪽(인사말 확정판 없음, 자문위원 0명, 고객사 0곳 등)은 빠지고, 흐름 쪽(명단·부록)은 paginate 가 쪽을 늘린다.
 *
 * 템플릿(TP2, 계획서 docs/catalog-templates-plan.md §3-2·§3-3): 쪽 키·유형·섹션 정의는 공유하고 template.plan 으로 순서·포함 쪽을 바꾼다.
 *   full·research — 지금 목차(research 의 주제 쪽 C21~C23 은 다음 단계)
 *   formal — 신뢰 근거(인증·고객사 + 부록 A 수행실적 총괄)를 사업 분야 앞으로, 부록은 B·C 만
 *   brief  — 표지 → 숫자 → 사업 분야 개관 → C20 분야 1장 요약 × 선택 분야(theme.areas) → 핵심 역량 → 인증 → 연락처 → 뒤표지(목차·부록 없음)
 * 쪽 변형은 resolveVariant({...템플릿[쪽 유형], ...템플릿[쪽 키], ...PageEdits.variant}) — 사진이 필요한 값에 사진이 없으면 템플릿 fallback 으로 바꾸고 note 를 남긴다.
 * 섹션 번호(쪽 머리·목차·북마크)는 쪽 컴포넌트가 원래 번호를 쓰고 parts.secNum 이 쪽 계획 종류에 맞춰 바꾼다. 목차·북마크·쪽 번호는 자동 경로 그대로.
 */
import type { ReactElement } from "react";
import { fallbackNote, resolveVariant, templateOf, type CatalogTemplate } from "@/lib/catalog/templates";
import type { CatalogRenderData, HistoryYear, LeaderCard, RenderCtx } from "../types";
import { DIVIDER_CONTENT, SECTIONS } from "../master-content";
import { BusinessMapPage, AreaPage, CasePage, CustomAreaPage, PlatformPage, SoftwarePage, StrengthsPage } from "./pages-business";
import { BriefPage } from "./pages-brief";
import { ContentsPage, CoverPage, DividerPage, FiguresPage, HistoryPage, MessagePage, OverviewPage, type CoverChoice } from "./pages-front";
import { AdvisorsPage, LEADERS_PER_PAGE, LeadersPage, OrgPage, PeopleDetailPage, StaffListPage, StaffPage, type LeaderCardStyle } from "./pages-people";
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
  /** 이 쪽에 그린 변형(템플릿 기본 + 저장값, 폴백 반영) — 스튜디오 디자인 탭 칩의 현재 값 */
  variant?: PageVariant;
  /** 확인할 내용(사진 폴백 등) — 발행 notices·스튜디오 쪽 검사가 같은 문구를 쓴다 */
  note?: string;
  element: ReactElement;
}

/** 연혁 한 쪽에 들어가는가 — 연혁 축(변형)마다 자리 모양이 달라 기준이 다르다 */
function historyFits(chunk: HistoryYear[], axis: string | undefined, rowsLayout: boolean): boolean {
  const items = (ys: HistoryYear[]) => ys.reduce((a, y) => a + y.items.length, 0);
  const maxItems = (ys: HistoryYear[]) => Math.max(0, ...ys.map((y) => y.items.length));
  // 연구소형 4단은 루트 CSS 가 연도 한 줄씩(왼쪽 연도·오른쪽 내용)으로 다시 그린다 — 연도 행 여백 + 항목 줄(행 18pt)이 쪽 높이 안에
  if (axis === "columns4" && rowsLayout) return chunk.length + items(chunk) <= 18;
  // 연대별 4단 — 줄마다 가장 긴 연도가 줄 높이를 정한다
  if (axis === "columns4") {
    let rows = 0;
    for (let i = 0; i < chunk.length; i += 4) rows += maxItems(chunk.slice(i, i + 4));
    return chunk.length <= 8 && rows <= 6;
  }
  // 한 줄 축 — 위·아래 칸이 쪽 높이를 반씩 나눠 쓴다. 연도가 4개 이하면 칸이 넓어 항목이 한 줄에 들어가 칸마다 4개까지
  if (axis === "horizontal") {
    const top = maxItems(chunk.filter((_, i) => i % 2 === 1));
    const bottom = maxItems(chunk.filter((_, i) => i % 2 === 0));
    const cap = chunk.length <= 4 ? 4 : 3;
    return chunk.length <= 5 && top <= cap && bottom <= cap;
  }
  return chunk.length <= 8 && items(chunk) <= 18;
}

/**
 * 연혁 쪽 나누기 — 연혁 축마다 한 쪽 기준(historyFits)으로 앞에서부터 채운 뒤, 쪽이 둘 이상이면 연도 수를 고르게 다시 나눈다
 * (마지막 쪽에 한 해만 남지 않게). 한 해가 혼자서도 넘치면 그 해만 한 쪽에 둔다. 기본(연도 열)은 예전과 같다(연도 8개·항목 18줄).
 */
function chunkHistory(years: HistoryYear[], axis?: string, rowsLayout = false): HistoryYear[][] {
  const greedy: HistoryYear[][] = [];
  let cur: HistoryYear[] = [];
  for (const y of years) {
    if (cur.length && !historyFits([...cur, y], axis, rowsLayout)) {
      greedy.push(cur);
      cur = [];
    }
    cur.push(y);
  }
  if (cur.length) greedy.push(cur);
  if (!axis || axis === "columns" || greedy.length < 2) return greedy;
  // 고르게 다시 나누기 — 같은 쪽 수로 나눠 모두 들어가면 그것을 쓴다
  const k = greedy.length;
  const even: HistoryYear[][] = [];
  let at = 0;
  for (let i = 0; i < k; i++) {
    const n = Math.ceil((years.length - at) / (k - i));
    even.push(years.slice(at, at + n));
    at += n;
  }
  return even.every((c) => c.length === 1 || historyFits(c, axis, rowsLayout)) ? even : greedy;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** brief 쪽 계획에서 선택 분야가 비었을 때 기본 — 상담 분야 앞 3개(결정 T-6: 1~3개) */
export const DEFAULT_BRIEF_AREAS = [1, 2, 3];

/**
 * @param variants 쪽 키별 저장 변형(PageEdits.variant) — 템플릿 기본 변형 위에 얹는다
 * @param template 문서 템플릿(없으면 ctx.template → standard)
 */
export function buildPagePlan(
  ctx: RenderCtx,
  data: CatalogRenderData,
  cover: CoverChoice,
  variants: Record<string, PageVariant> = {},
  template: CatalogTemplate = templateOf(ctx.template)
): PagePlanItem[] {
  const kind = template.plan;
  const consulting = data.areas.filter((a) => a.index <= 5);
  const software = data.areas.find((a) => a.index === 6)!;
  const appendixSections = data.appendix.sections
    .map((sec) => ({ sec, area: data.areas.find((a) => a.category === sec.category)! }))
    .filter((x) => x.sec.shownRows > 0);
  const sec03 = SECTIONS.find((s) => s.key === "03")!;
  const rv = (key: string, type: string, hasPhoto?: (field: string, variant: PageVariant) => boolean) => {
    const r = resolveVariant(template, key, type, variants[key], hasPhoto);
    return { variant: r.variant, note: fallbackNote(type, r.fallbacks) };
  };
  const v = (key: string, type: string): PageVariant => rv(key, type).variant;
  // 연혁 축은 첫 쪽(c06-1) 값으로 문서 전체를 정한다(축에 따라 한 쪽 연도 수가 달라 쪽 나누기가 바뀜)
  const c06 = rv("c06-1", "C06");
  const historyParts = chunkHistory(data.history, c06.variant.axis, template.id === "research");
  // 임원진 카드 변형은 첫 쪽(c13-1) 값으로 문서 전체를 정한다(카드 모양에 따라 한 쪽 인원이 달라 쪽 나누기가 바뀜)
  const leaderPhotos = data.leaders.some((l) => l.photo);
  const c13 = rv("c13-1", "C13", () => leaderPhotos);
  const card: LeaderCardStyle = c13.variant.card === "portrait-large" || c13.variant.card === "list" ? c13.variant.card : "square";
  const leaderParts: LeaderCard[][] = chunk(data.leaders, LEADERS_PER_PAGE[card]);
  const out: PagePlanItem[] = [];
  const add = (
    key: string,
    type: string,
    label: string,
    section: string,
    element: ReactElement,
    opts: { maxLevel?: 1 | 2 | 3; flow?: boolean; variant?: PageVariant; note?: string } = {}
  ) =>
    out.push({
      key,
      type,
      label,
      section,
      maxLevel: opts.maxLevel ?? 3,
      flow: opts.flow ?? false,
      ...(opts.variant && Object.keys(opts.variant).length ? { variant: opts.variant } : {}),
      ...(opts.note ? { note: opts.note } : {}),
      element,
    });

  // ── 쪽 묶음(쪽 계획 종류마다 순서만 바꿔 쓴다) ──
  const coverPage = () => {
    const note = cover.cover === "photo" && !cover.photo ? "사진 없음 — E 전면 사진 대신 F 그래픽 표지로 그림" : undefined;
    add("c01", "C01", "표지", "", <CoverPage ctx={ctx} data={data} choice={cover} />, { note });
  };
  const contents = () => add("c02", "C02", "목차", "", <ContentsPage ctx={ctx} data={data} />, { maxLevel: 2 });
  const figures = (sectionStart: boolean) => {
    const r = rv("c04", "C04");
    add("c04", "C04", "숫자로 보는 KESI", "01", <FiguresPage ctx={ctx} data={data} sectionStart={sectionStart} variant={r.variant} note={r.note} />, r);
  };
  const intro = () => {
    if (data.ceoMessage) add("c03", "C03", "대표이사 인사말", "01", <MessagePage ctx={ctx} data={data} />);
    // 인사말이 없으면 숫자로 보는 KESI 가 01 섹션의 첫 쪽
    figures(!data.ceoMessage);
    add("c05", "C05", "회사 개요·비전", "01", <OverviewPage ctx={ctx} data={data} variant={v("c05", "C05")} />);
    historyParts.forEach((years, i) =>
      add(
        `c06-${i + 1}`,
        "C06",
        historyParts.length > 1 ? `연혁 ${i + 1}/${historyParts.length}` : "연혁",
        "01",
        <HistoryPage ctx={ctx} data={data} years={years} part={i} parts={historyParts.length} variant={c06.variant} />,
        { maxLevel: 2, variant: c06.variant }
      )
    );
  };
  const divider02 = () => {
    const r = rv("c07-02", "C07");
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
        variant={r.variant}
        note={r.note}
        items={[
          ...data.areas.map((a) => ({ label: a.name, area: a.index, ref: `area-${a.index}` })),
          ...(data.customAreas ?? []).map((a) => ({ label: a.name, area: a.slot, ref: a.key })),
        ]}
      />,
      r
    );
  };
  const business = () => {
    add("c08", "C08", "사업 분야 개관", "02", <BusinessMapPage ctx={ctx} data={data} />);
    consulting.forEach((a) => {
      const key = `area-${a.index}`;
      const r = rv(key, "C09");
      add(key, "C09", a.name, "02", <AreaPage ctx={ctx} data={data} area={a} variant={r.variant} note={r.note} />, r);
    });
    (data.customAreas ?? []).forEach((a) => add(a.key, "C09", a.name, "02", <CustomAreaPage ctx={ctx} data={data} area={a} />));
    add("c09-software", "C09", software.name, "02", <SoftwarePage ctx={ctx} data={data} area={software} />);
    add("c09-platform", "C09", "통합허가 플랫폼", "02", <PlatformPage ctx={ctx} data={data} />);
  };
  const divider03 = () => {
    const r = rv("c07-03", "C07");
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
        variant={r.variant}
        note={r.note}
        items={[
          { label: "핵심 역량", ref: "c10" },
          { label: "대표 성공 사례", ref: "c11" },
        ]}
      />,
      r
    );
  };
  const strengths = (sectionStart = false) => {
    const r = rv("c10", "C10");
    add("c10", "C10", "핵심 역량", "03", <StrengthsPage ctx={ctx} data={data} variant={r.variant} sectionStart={sectionStart} />, r);
  };
  const people = () => {
    add("c12", "C12", "조직", "04", <OrgPage ctx={ctx} data={data} />, { maxLevel: 2 });
    leaderParts.forEach((ps, i) =>
      add(
        `c13-${i + 1}`,
        "C13",
        leaderParts.length > 1 ? `임원진 ${i + 1}/${leaderParts.length}` : "임원진",
        "04",
        <LeadersPage ctx={ctx} data={data} people={ps} part={i} parts={leaderParts.length} variant={c13.variant} note={i === 0 ? c13.note : undefined} />,
        { maxLevel: 2, variant: c13.variant, note: i === 0 ? c13.note : undefined }
      )
    );
    add("c14", "C14", "기술인력 현황", "04", <StaffPage ctx={ctx} data={data} />, { maxLevel: 2 });
    if (data.staffRows.length) add("c15-staff", "C15", "기술인력 명단", "04", <StaffListPage ctx={ctx} data={data} />, { maxLevel: 2, flow: true });
    if (data.advisors.length) add("c15-advisors", "C15", "자문위원", "04", <AdvisorsPage ctx={ctx} data={data} />, { maxLevel: 2, flow: true });
  };
  const credentials = () => {
    if (!data.credentials.length) return;
    const r = rv("c16", "C16");
    add("c16", "C16", "인증·등록·특허", "05", <CredentialsPage ctx={ctx} data={data} variant={r.variant} />, { maxLevel: 2, variant: r.variant });
  };
  const trust = (withSummary: boolean) => {
    credentials();
    if (data.clients.length) add("c17", "C17", "주요 고객사·협력 기관", "05", <ClientsPage ctx={ctx} data={data} sectionStart={!data.credentials.length} />, { maxLevel: 2 });
    if (withSummary)
      add("a01", "A01", "수행실적 총괄", "05", <SummaryPage ctx={ctx} data={data} inBody sectionStart={!data.credentials.length && !data.clients.length} />, { maxLevel: 1 });
  };
  const contact = () => add("c18", "C18", "오시는 길", "06", <ContactPage ctx={ctx} data={data} />);
  const appendix = (withSummary: boolean) => {
    // 요약본(P7 판 옵션)은 부록을 통째로 뺀다 — 목차의 부록 줄은 쪽을 못 찾으면 숨는다(data-ref-missing="hide")
    if (ctx.opts.scope === "summary") return;
    if (withSummary) add("a01", "A01", "부록 A 수행실적 총괄", "부록", <SummaryPage ctx={ctx} data={data} />, { maxLevel: 1 });
    appendixSections.forEach(({ sec, area }, i) =>
      add(`a02-${area.index}`, "A02", `부록 B ${area.name}`, "부록", <ProjectListPage ctx={ctx} data={data} area={area} sec={sec} sectionStart={!withSummary && i === 0} />, {
        maxLevel: 1,
        flow: true,
      })
    );
    if (ctx.opts.naming === "real" && data.people.length)
      add("a03", "A03", "부록 C 수행인력 상세 이력", "부록", <PeopleDetailPage ctx={ctx} data={data} sectionStart={!withSummary && appendixSections.length === 0} />, {
        maxLevel: 1,
        flow: true,
      });
  };
  const back = () => add("c19", "C19", "뒤표지", "", <BackCoverPage ctx={ctx} data={data} />);

  if (kind === "brief") {
    // 요약·분야 브리프 — 섹션 첫 쪽이 간지 대신 섹션 앵커를 맡는다(숫자·개관·역량)
    const picked = data.theme.areas?.length ? data.theme.areas : DEFAULT_BRIEF_AREAS;
    coverPage();
    figures(true);
    add("c08", "C08", "사업 분야 개관", "02", <BusinessMapPage ctx={ctx} data={data} sectionStart linked={picked} />);
    data.areas
      .filter((a) => picked.includes(a.index))
      .forEach((a, i) => add(`brief-${a.index}`, "C20", `${a.name} 분야 요약`, "02", <BriefPage ctx={ctx} data={data} area={a} seq={i + 1} />));
    strengths(true);
    credentials();
    contact();
    back();
    return out;
  }
  coverPage();
  contents();
  intro();
  if (kind === "formal") {
    // 격조·공공형 — 신뢰 근거(인증·고객사·수행실적 총괄)를 사업 분야 앞으로, 부록 A 는 본편에
    trust(true);
    divider02();
    business();
    divider03();
    strengths();
    add("c11", "C11", "대표 성공 사례", "03", <CasePage ctx={ctx} data={data} />);
    people();
    contact();
    appendix(false);
    back();
    return out;
  }
  divider02();
  business();
  divider03();
  strengths();
  add("c11", "C11", "대표 성공 사례", "03", <CasePage ctx={ctx} data={data} />);
  people();
  trust(false);
  contact();
  appendix(true);
  back();
  return out;
}
