import assert from "node:assert/strict";
import test from "node:test";
import { boardFilterToParams, computeBoardStats, filterBoardProjects, parseBoardFilter, type SalesBoardFilter } from "../lib/sales/board";
import { SALES_REGION_GROUPS, salesRegionGroupId } from "../lib/sales/regions";
import type { SalesProject } from "../lib/sales/types";

// Salesboard 서버 판정(lib/sales/board.ts) — 2026-10-29 클라이언트 계산을 옮기며 화면 숫자 규칙을 고정한다.
const NOW = "2026-10-29T09:00:00.000Z"; // KST 벽시계 문자열(kstNowIso 와 같은 꼴)

function p(id: string, over: Partial<SalesProject> = {}): SalesProject {
  return {
    projectId: id,
    facilityId: "f",
    facilityName: "사업장",
    regionSido: null,
    title: `영업 ${id}`,
    stage: "lead",
    ownerEmployeeId: null,
    ownerEmployeeName: null,
    ownerDeptId: null,
    contractId: null,
    serviceCategory: null,
    serviceSubcategory: null,
    expectedAmount: null,
    priority: "normal",
    status: "open",
    openedAt: "2026-10-01",
    closedAt: null,
    memo: null,
    createdBy: null,
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
    leadMemberId: null,
    leadMemberName: null,
    activityTypes: [],
    reachedStage: "lead",
    finalBidAmount: null,
    ...over,
  };
}

const empty: SalesBoardFilter = { q: "", owner: "", year: "", regionIds: [], categoryIds: [], kpi: null, reached: null };

test("지역권 7권·미상 경계 — 시도 원문 표기 변형", () => {
  const cases: Array<[string | null, string]> = [
    ["서울특별시", "capital"],
    ["경기도", "capital"],
    ["인천광역시", "capital"],
    ["강원특별자치도", "gangwon"],
    ["세종특별자치시", "chungcheong"],
    ["충청북도", "chungcheong"],
    ["대구광역시", "gyeongbuk"],
    ["경상남도", "gyeongnam"],
    ["울산", "gyeongnam"],
    ["전북특별자치도", "jeolla"],
    ["광주광역시", "jeolla"],
    ["제주특별자치도", "jeju"],
    [" 부산 광역시", "gyeongnam"],
    [null, "unknown"],
    ["", "unknown"],
    ["해외", "unknown"],
  ];
  for (const [sido, id] of cases) assert.equal(salesRegionGroupId(sido), id, String(sido));
  assert.equal(SALES_REGION_GROUPS.length, 7);
});

test("태그 — 그룹 안 OR, 그룹 사이 AND, 건수는 같은 그룹 선택을 빼고 센다", () => {
  const list = [
    p("1", { regionSido: "서울", serviceCategory: "integrated_permit" }),
    p("2", { regionSido: "충북", serviceCategory: "integrated_permit" }),
    p("3", { regionSido: "서울", serviceCategory: "chem" }),
    p("4", { regionSido: null, serviceCategory: null }),
  ];
  const r = filterBoardProjects(list, { ...empty, regionIds: ["capital", "chungcheong"], categoryIds: ["integrated_permit"] }, NOW);
  assert.deepEqual(r.rows.map((x) => x.projectId), ["1", "2"]);
  assert.deepEqual(r.regionCounts, { capital: 1, chungcheong: 1 });
  assert.deepEqual(r.categoryCounts, { integrated_permit: 2, chem: 1 });
  const u = filterBoardProjects(list, { ...empty, regionIds: ["unknown"], categoryIds: ["unset"] }, NOW);
  assert.deepEqual(u.rows.map((x) => x.projectId), ["4"]);
});

test("검색·담당(담당자 또는 대표 멤버)·연도·KPI·도달 단계", () => {
  const list = [
    p("1", { title: "부산발전 재검토", ownerEmployeeId: "a", stage: "won", outcomeAt: "2026-04-01", reachedStage: "won" }),
    p("2", { facilityName: "부산(주)", leadMemberId: "a", stage: "lost", outcomeAt: null, closedAt: "2025-12-31", openedAt: "2025-01-01" }),
    p("3", { stage: "bidding", reachedStage: "bidding", status: "closed" }),
    p("4", { stage: "hold", openedAt: null, createdAt: "2026-10-05" }),
  ];
  const ids = (f: Partial<SalesBoardFilter>) => filterBoardProjects(list, { ...empty, ...f }, NOW).rows.map((x) => x.projectId);
  assert.deepEqual(ids({ q: " 부산 " }), ["1", "2"]);
  assert.deepEqual(ids({ owner: "a" }), ["1", "2"]);
  assert.deepEqual(ids({ year: "2025" }), ["2"]);
  assert.deepEqual(ids({ kpi: "active" }), ["4"]); // closed 와 수주·실주 제외, 보류는 진행 중
  assert.deepEqual(ids({ kpi: "new" }), ["1", "3", "4"]); // opened_at 없으면 created_at
  assert.deepEqual(ids({ kpi: "won" }), ["1"]);
  assert.deepEqual(ids({ kpi: "lost" }), []); // 결과 스케쥴 없으면 closed_at 연도(2025)
  assert.deepEqual(ids({ reached: "bidding" }), ["1", "3"]);
});

test("URL 쿼리 왕복 — 한글 검색어·다중 태그·잘못된 값", () => {
  const f: SalesBoardFilter = { q: "충북 제지&1", owner: "e1", year: "2026", regionIds: ["jeju", "capital"], categoryIds: ["unset"], kpi: "outcome", reached: "proposal" };
  const back = parseBoardFilter(new URLSearchParams(boardFilterToParams(f).toString()));
  assert.deepEqual(back, { ...f, regionIds: ["capital", "jeju"] });
  const bad = parseBoardFilter(new URLSearchParams("kpi=x&reached=lost"));
  assert.equal(bad.kpi, null);
  assert.equal(bad.reached, null);
});

test("집계 — KPI·퍼널·세분류 순서·연도별 성과·담당자(겹침)·미지정", () => {
  const list = [
    p("1", { ownerEmployeeId: "a", stage: "won", outcomeAt: "2026-10-25", reachedStage: "won", finalBidAmount: 120000000, serviceCategory: "integrated_permit", serviceSubcategory: "first" }),
    p("2", { ownerEmployeeId: "a", leadMemberId: "b", stage: "lost", outcomeAt: "2026-04-10", reachedStage: "bidding", finalBidAmount: 80000000, serviceCategory: "integrated_permit", serviceSubcategory: "review" }),
    p("3", { leadMemberId: "b", stage: "proposal", reachedStage: "proposal", openedAt: "2026-09-02", serviceCategory: "integrated_permit", serviceSubcategory: "review" }),
    p("4", { stage: "won", outcomeAt: "2024-06-01", reachedStage: "won", openedAt: "2024-05-01" }),
    p("5", { stage: "hold", openedAt: "2026-09-30" }),
  ];
  const s = computeBoardStats(list, [{ projectId: "3" }, { projectId: "3" }], [{ projectId: "2", activities: [1, 2] }], NOW);
  assert.equal(s.thisYear, "2026");
  assert.equal(s.visibleTotal, 5);
  assert.deepEqual(s.years, ["2026", "2024"]);
  assert.deepEqual(s.kpi, {
    active: 2,
    activeByStage: { lead: 0, contact: 0, proposal: 1, bidding: 0, hold: 1 },
    newThisMonth: 2,
    newPrevMonth: 2,
    won: 1,
    lost: 1,
  });
  assert.deepEqual(s.funnel, [5, 4, 4, 3, 2]);
  assert.deepEqual(s.categories[0], { id: "integrated_permit", n: 3, subs: [{ code: "review", n: 2 }, { code: "first", n: 1 }] });
  assert.deepEqual(s.categories[4], { id: "unset", n: 2, subs: [] });
  assert.deepEqual(s.outcomes.map((o) => [o.year, o.won, o.lost, o.wonAmt, o.bidAmt, o.priced, o.total]), [
    ["2026", 1, 1, 120000000, 200000000, 2, 2],
    ["2025", 0, 0, 0, 0, 0, 0],
    ["2024", 1, 0, 0, 0, 0, 1],
  ]);
  // 2 번은 담당자 a 와 대표 멤버 b 양쪽에 잡힌다(예전 화면과 같은 판정)
  assert.deepEqual(s.staff.a, { active: 0, upcoming: 0, pending: 2, wonYear: 1 });
  assert.deepEqual(s.staff.b, { active: 1, upcoming: 2, pending: 2, wonYear: 0 });
  assert.deepEqual(s.unassigned, { active: 1, upcoming: 0, pending: 0, wonYear: 0, total: 2 });
});
