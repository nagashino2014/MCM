// 회사소개서 스튜디오 시험용 렌더 데이터(가상) — 실제 회사·고객 정보 아님. DB 없이 쪽 계획·변환·편집층을 시험한다.
// extraContract = 통합환경허가 계약 1건이 새로 등록된 뒤의 데이터(지표·부록·대표 실적이 바뀜).
import { DEFAULT_APPENDIX_RULES, type AppendixListRow, type AppendixResult } from "@/lib/catalog/appendix";
import { CATALOG_CATEGORIES } from "@/lib/catalog/areas";
import { DEFAULT_DOCUMENT_THEME } from "@/lib/catalog/document-theme";
import { METRIC_DEFS, type MetricId, type MetricValue } from "@/lib/catalog/metrics";
import { REGION_GROUPS } from "@/lib/catalog/regions";
import { AREA_DISPLAY_NAME } from "@/lib/catalog/render/master-content";
import type { AreaInfo, CatalogRenderData, MatrixSection } from "@/lib/catalog/render/types";

export function makeFixture(opts: { extraContract?: boolean } = {}): CatalogRenderData {
  const extra = opts.extraContract ? 1 : 0;
  const values: Partial<Record<MetricId, number>> = {
    "permit.initial.completed": 40 + extra,
    "permit.change.completed": 60,
    "permit.contracts.total": 120 + extra,
    "permit.industries": 12,
    "projects.area.1": 120 + extra,
    "projects.area.2": 50,
    "projects.area.3": 200,
    "projects.area.4": 6,
    "projects.area.5": 30,
    "projects.area.6": 0,
    "software.products": 3,
    "projects.total": 406 + extra,
    "clients.total": 150,
    "staff.total": 30,
    "staff.exec": 6,
    "staff.employee": 24,
    "staff.technical": 26,
    "advisors.total": 10,
    "company.years": 10,
    "market.permit.share": Math.round(((40 + extra) / 1307) * 1000) / 10,
  };
  const metrics = Object.fromEntries(
    METRIC_DEFS.map((d) => [d.id, { ...d, value: values[d.id] ?? null, asOf: "2026-10-22" } satisfies MetricValue])
  ) as Record<MetricId, MetricValue>;
  const areas: AreaInfo[] = CATALOG_CATEGORIES.map((category, i) => ({
    index: i + 1,
    category,
    name: AREA_DISPLAY_NAME[category] ?? category,
    count: values[`projects.area.${i + 1}` as MetricId] ?? 0,
    completed: Math.max(0, (values[`projects.area.${i + 1}` as MetricId] ?? 0) - 5),
    recent3: 10,
    regions: 4,
    firstYear: "2017",
    featured:
      i === 0
        ? [
            ...(extra ? [{ year: "2026", title: "가상발전 신규 사업장 통합환경허가 최초허가 용역", meta: "수행 중" }] : []),
            { year: "2025", title: "가상화학 1공장 통합환경허가 변경허가 용역", meta: "2025-05-01 · 제 2025-001호" },
            { year: "2024", title: "가상제철 통합환경허가 최초허가 용역", meta: "2024-03-02 · 제 2024-010호" },
          ]
        : i < 5
          ? [{ year: "2025", title: `가상고객 ${i + 1} 용역`, meta: "2025.01–2025.06" }]
          : [],
    featuredFallback: false,
  }));
  const row = (key: string, year: string, title: string, status: "completed" | "ongoing"): AppendixListRow => ({
    key,
    contractIds: [key],
    year,
    category: "통합환경허가",
    title,
    detail: "",
    industry: "발전",
    region: "수도권",
    period: `${year}.01. ~ ${year}.12.`,
    status,
    permitNo: status === "completed" ? `제 ${year}-001호` : "",
    amount: 100_000_000,
    featured: false,
    grouped: false,
  });
  const permitRows = [row("ct1", "2024", "가상제철 통합환경허가 최초허가 용역 준공", "completed"), row("ct2", "2025", "가상화학 변경허가 용역 준공", "completed")];
  if (extra) permitRows.push(row("ct9", "2026", "가상발전 신규 사업장 통합환경허가 최초허가 용역", "ongoing"));
  const byYear = new Map<string, AppendixListRow[]>();
  for (const r of permitRows) byYear.set(r.year, [...(byYear.get(r.year) ?? []), r]);
  const appendix: AppendixResult = {
    sections: [
      {
        category: "통합환경허가",
        years: [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, rows]) => ({ year, rows, hiddenCount: 0, hiddenSummary: "" })),
        shownRows: permitRows.length,
        shownContracts: permitRows.length,
        hiddenContracts: 0,
      },
    ],
    shownRows: permitRows.length,
    shownContracts: permitRows.length,
    hiddenContracts: 0,
    hiddenByReason: { never: 0, period: 0, ongoing: 0, "no-amount": 0, amount: 0 },
    estimatedPages: 1,
    summary: { basis: "all", byYear: {}, byRegion: {}, total: {} },
  };
  const matrix: MatrixSection[] = areas.slice(0, 5).map((a) => ({
    category: a.category,
    index: a.index,
    name: a.name,
    desc: "",
    rows: [
      { label: a.name, period: "2017–2026", total: a.count, byRegion: { capital: Math.ceil(a.count / 2), central: Math.floor(a.count / 4), honam: Math.floor(a.count / 4) }, isTotal: true },
      { label: "", period: "2025", total: 5, byRegion: { capital: 5 } as Record<string, number>, isTotal: false },
    ],
  }));
  return {
    asOf: "2026-10-22",
    asOfLabel: "2026. 10",
    docLabel: "회사소개서 2026.10",
    theme: { ...DEFAULT_DOCUMENT_THEME },
    rules: { ...DEFAULT_APPENDIX_RULES },
    company: {
      name: "㈜가상환경연구원",
      nameShort: "가상",
      nameEn: "Virtual Environment Institute",
      ceoName: "홍길동",
      ceoTitle: "대표이사",
      foundedYear: "2016",
      foundedMonth: "3",
      website: "www.example.com",
      email: "info@example.com",
      phone: "02-000-0000",
      vision: "",
      slogan: "",
      revenue: { year: "2025", millionWon: 3000 },
      credit: null,
      registrations: ["환경컨설팅업", "통합허가 대행업"],
    },
    offices: [
      { key: "hq", name: "서울 본사", nameEn: "HEAD OFFICE", address: "서울특별시 가상구 가상로 1", addressLines: ["서울특별시 가상구 가상로 1", "가상빌딩 5층"], phone: "02-000-0000", transit: [{ label: "지하철", text: "가상역 1번 출구" }], lon: 126.88, lat: 37.48, photo: null },
      { key: "ulsan", name: "울산 지사", nameEn: "ULSAN BRANCH", address: "울산광역시 가상구 1", addressLines: ["울산광역시 가상구 1"], phone: "052-000-0000", transit: [], lon: 129.31, lat: 35.54, photo: null },
    ],
    metrics,
    initialPermit: {
      sites: 40 + extra,
      completedContracts: 38,
      excludedContracts: 0,
      ongoingContracts: 3 + extra,
      completedWithoutPermitNo: 0,
      byCohort: [
        { id: "c1", label: "1차년도 발전·폐기물", sites: 20 },
        { id: "c2", label: "2차년도 철강·비철", sites: 10 + extra },
        { id: "c3", label: "3차년도 석유화학", sites: 5 },
        { id: "c4", label: "4차년도 제지·전자", sites: 3 },
        { id: "c5", label: "5차년도 반도체 등", sites: 2 },
      ],
      rows: [],
    },
    figures: { "permit.sites.total": 1307 },
    areas,
    appendix,
    projectIndex: Object.fromEntries(permitRows.map((r) => [r.key, { subtype: r.title.includes("변경") ? "변경허가" : "최초허가", permitIssuedAt: `${r.year}-06-01` }])),
    matrix,
    regionColumns: REGION_GROUPS.map((g) => ({ id: g.id, label: g.label })),
    permitByRegion: { capital: 60 + extra, central: 30, honam: 30 },
    permitIndustries: ["발전", "철강", "석유화학", "제지", "전자", "반도체"],
    history: [
      { year: "2016", highlight: true, items: [{ month: "03", content: "회사 설립", category: "설립", highlight: true }] },
      { year: "2021", highlight: false, items: [{ month: "05", content: "통합허가 대행업 등록", category: "등록", highlight: false }] },
    ],
    credentials: [{ key: "cr1", kind: "등록", name: "환경컨설팅업", meta: "2017.01", image: null }],
    ceoMessage: { title: "인사말", quote: "환경의 순환을 설계합니다.", paragraphs: ["가상 인사말 첫 문단입니다.", "가상 인사말 둘째 문단입니다."], signTitle: "대표이사", signName: "홍길동", draft: false },
    ceo: { key: "ceo", name: "홍길동", initial: "홍", role: "대표이사", photo: null, edu: "가상대학교 환경공학 박사", cert: "대기관리기술사", career: "환경 컨설팅 25년", careerYears: 25, manual: false },
    leaders: [
      { key: "l1", name: "홍길동", initial: "홍", role: "대표이사", photo: null, edu: "박사", cert: "기술사", career: "25년", careerYears: 25, manual: false },
      { key: "l2", name: "김가상", initial: "김", role: "부사장", photo: null, edu: "석사", cert: "기사", career: "20년", careerYears: 20, manual: false },
    ],
    leaderAvgCareer: 22.5,
    staffStats: {
      technical: 26,
      experts: 4,
      expertNote: "기술사 2 · 박사 2",
      avgCareer: 11.2,
      certs: [
        { name: "대기환경기사", count: 10 },
        { name: "수질환경기사", count: 6 },
      ],
      degrees: { doctor: 2, master: 8, bachelor: 18, other: 2 },
      careerBuckets: [3, 9, 10, 8],
      population: 30,
    },
    staffRows: [{ key: "s1", name: "이가상", position: "과장", dept: "통합환경1팀", edu: "학사", certs: "대기환경기사", years: 8 }],
    advisors: [{ key: "a1", name: "박자문", field: "대기", org: "가상대학교", title: "교수", career: "前 가상연구원" }],
    orgChart: {
      nodes: [
        {
          id: "root",
          label: "대표이사",
          sub: "",
          badge: "",
          children: [
            { id: "d1", label: "통합환경본부", sub: "10명", badge: "", children: [{ id: "t1", label: "통합환경1팀", sub: "", badge: "", children: [] }] },
            { id: "d2", label: "화학안전본부", sub: "6명", badge: "", children: [] },
          ],
        },
      ],
    },
    clients: [{ label: "정부·공공기관", sub: "발주·협력", items: [{ name: "가상공사", logo: null }] }],
    people: [],
    notices: [],
  };
}
