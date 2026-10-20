import assert from "node:assert/strict";
import test from "node:test";
import { MENU_ITEMS, isMenuVisible, visibleSubmenu } from "../config/menu";
import { resolveMenuRoute } from "../components/layout/menu-route";

// 역할별 권한 요약(테스트용) — docs/open-test-permission-plan-2026-10-19.md §1.3·§4.1 의 템플릿 grant 를 요약 형식으로 옮긴 것.
// 298(2026-10-19): billing.view·sales.view 는 사원·부서장·임원에서 회수, payroll.view·finance.view 는 임원에서 회수.
const STAFF_PERMS = ["approval.view", "approval.act", "board.view", "board.write", "contract.view",
  "contact.view@all", "work_plan.view", "work_plan.edit", "staffing.view"];
const LEAD_PERMS = [...STAFF_PERMS, "billing.dept.view", "contract.edit", "work_plan.merge", "work_plan.lock_release", "bonus.view",
  "staffing.evaluation.read", "staffing.evaluation.write", "staffing.record.view", "trash.view", "trash.restore"];
const EXEC_PERMS = ["approval.view", "approval.act", "board.view", "board.write", "contract.view@all",
  "contact.view@all", "facility.view@all", "work_plan.view@all", "work_plan.directive@all",
  "work_plan.lock_release@all", "bonus.view@all", "staffing.view@all", "staffing.evaluation.read@all",
  "staffing.record.view@all", "calendar.meeting.manage@all", "todo.admin@all"];
// 영업 담당(tpl-sales-staff) — 영업 제설정에서 지정된 인원(298).
const SALES_STAFF_PERMS = [...STAFF_PERMS, "sales.view@all", "sales.edit@all", "contact.edit@all"];
// 대표이사(tpl-ceo) 중 메뉴 판정에 쓰이는 키만.
const CEO_PERMS = [...EXEC_PERMS, "billing.view@all", "payroll.view@all", "finance.view@all", "sales.view@all"];

test("기존 메뉴의 모든 진입 URL은 정확히 자기 메뉴를 선택한다", () => {
  assert.equal(MENU_ITEMS.length, 26);
  assert.equal(MENU_ITEMS.reduce((count, item) => count + (item.submenu?.length ?? 0), 0), 76);
  const survey = MENU_ITEMS.find((item) => item.title === "설문");
  assert.equal(survey?.href, "/survey/internal");
  assert.deepEqual(survey?.submenu?.map(({ title, href }) => ({ title, href })), [
    { title: "사내 설문", href: "/survey/internal" },
    { title: "외부 설문", href: "/survey/external" },
  ]);
  assert.equal(isMenuVisible(survey!, STAFF_PERMS), true);
  assert.deepEqual(visibleSubmenu(survey!, STAFF_PERMS).map((item) => item.href), ["/survey/internal"]);
  assert.deepEqual(visibleSubmenu(survey!, ["survey.manage@all"]).map((item) => item.href), ["/survey/internal", "/survey/external"]);
  for (const item of MENU_ITEMS) {
    for (const route of item.submenu?.length ? item.submenu : [item]) {
      const url = new URL(route.href, "https://mcm.local");
      assert.deepEqual(resolveMenuRoute(MENU_ITEMS, url.pathname, url.search), {
        parentTitle: item.title, href: route.href,
      }, route.href);
    }
  }
});

test("전자결재 경로를 공유하는 메뉴는 가장 구체적인 부모 하나로 판정한다", () => {
  for (const [pathname, parentTitle, href] of [
    ["/approval/archive/42", "파일 · 문서함", "/approval/archive"],
    ["/approval/leave/42", "근태·휴가", "/approval/leave"],
    ["/approval/leave-promotion", "근태·휴가", "/approval/leave-promotion"],
    ["/approval/forms/42/edit", "결재 운영 설정", "/approval/forms"],
    ["/approval/records/42", "전자결재", "/approval/records"],
    ["/approval/42", "전자결재", "/approval"],
  ]) {
    assert.deepEqual(resolveMenuRoute(MENU_ITEMS, pathname), { parentTitle, href });
  }
});

test("상세 경로와 끝 슬래시에서도 자식 메뉴를 유지하고 부분 문자열은 매치하지 않는다", () => {
  assert.deepEqual(resolveMenuRoute(MENU_ITEMS, "/contracts/agreements/42/edit/"), { parentTitle: "계약", href: "/contracts/agreements" });
  assert.deepEqual(resolveMenuRoute(MENU_ITEMS, "/files/personal/42"), { parentTitle: "파일 · 문서함", href: "/files/personal" });
  assert.deepEqual(resolveMenuRoute(MENU_ITEMS, "/assets/reservations/42"), { parentTitle: "자산 예약", href: "/assets/reservations" });
  assert.equal(resolveMenuRoute(MENU_ITEMS, "/contracts-other"), null);
  assert.equal(resolveMenuRoute(MENU_ITEMS, null), null);
});

test("재무는 query 변경·필터 추가·그룹 내부 탭에서도 현재 소메뉴를 표시한다", () => {
  for (const [query, target] of [
    ["", "connections"], ["tab=unknown", "connections"], ["tab=__proto__", "connections"], ["tab=bank&year=2026", "bank"],
    ["year=2026&tab=invoice", "invoice"], ["tab=card", "bank"], ["tab=recon", "invoice"],
    ["tab=vatreturn", "vat"], ["tab=trial", "journal"], ["tab=closing", "pnl"],
    ["tab=budget", "fixedassets"], ["tab=severance", "expsettle"],
  ]) {
    assert.deepEqual(resolveMenuRoute(MENU_ITEMS, "/finance", query), { parentTitle: "재무", href: `/finance?tab=${target}` }, query);
  }
});

test("query 조건을 모두 만족한 후보 중 구체적인 항목을 고른다", () => {
  const routes = [{ title: "목록", href: "/list", submenu: [
    { title: "보관", href: "/list?tab=archive" },
    { title: "내 보관", href: "/list?tab=archive&scope=mine" },
  ] }];
  assert.equal(resolveMenuRoute(routes, "/list", "scope=mine&tab=archive&sort=newest")?.href, "/list?tab=archive&scope=mine");
  assert.equal(resolveMenuRoute(routes, "/list", "scope=all&tab=archive")?.href, "/list?tab=archive");
  assert.equal(resolveMenuRoute(routes, "/list", "tab=active")?.href, "/list");
});

test("권한으로 숨긴 메뉴는 matcher 입력에 포함되지 않는다", () => {
  const staffMenus = MENU_ITEMS.filter((item) => isMenuVisible(item, STAFF_PERMS));
  const leadMenus = MENU_ITEMS.filter((item) => isMenuVisible(item, LEAD_PERMS));
  const execMenus = MENU_ITEMS.filter((item) => isMenuVisible(item, EXEC_PERMS));
  assert.equal(resolveMenuRoute(staffMenus, "/finance", "tab=bank"), null);
  assert.equal(resolveMenuRoute(staffMenus, "/admin/users"), null);
  assert.equal(resolveMenuRoute(staffMenus, "/trash"), null);
  assert.equal(resolveMenuRoute(staffMenus, "/facilities"), null);
  assert.equal(resolveMenuRoute(staffMenus, "/data/status"), null);
  assert.equal(resolveMenuRoute(staffMenus, "/staffing"), null);
  assert.deepEqual(resolveMenuRoute(leadMenus, "/trash"), { parentTitle: "휴지통", href: "/trash" });
  assert.deepEqual(resolveMenuRoute(leadMenus, "/staffing"), { parentTitle: "성과급 산정", href: "/staffing" });
  assert.equal(resolveMenuRoute(leadMenus, "/facilities"), null);
  // 재무는 관리자·인사/회계·대표이사만(298) — 임원은 숨김
  assert.equal(resolveMenuRoute(execMenus, "/finance", "tab=bank"), null);
  const ceoMenus = MENU_ITEMS.filter((item) => isMenuVisible(item, CEO_PERMS));
  assert.deepEqual(resolveMenuRoute(ceoMenus, "/finance", "tab=bank"), { parentTitle: "재무", href: "/finance?tab=bank" });
  assert.equal(resolveMenuRoute(ceoMenus, "/admin/users"), null);
  assert.deepEqual(resolveMenuRoute(execMenus, "/facilities"), { parentTitle: "사업장", href: "/facilities" });
  assert.equal(resolveMenuRoute(execMenus, "/trash"), null);
  assert.equal(resolveMenuRoute(execMenus, "/admin/users"), null);
});

test("서브메뉴별 권한키 — 본인용과 관리용이 섞인 메뉴는 보유 키만큼만 보인다(§4.1)", () => {
  const payroll = MENU_ITEMS.find((item) => item.title === "급여·근로계약")!;
  assert.deepEqual(visibleSubmenu(payroll, STAFF_PERMS).map((s) => s.href), ["/payroll/my", "/payroll/my-yearend"]);
  assert.deepEqual(visibleSubmenu(payroll, EXEC_PERMS).map((s) => s.href), ["/payroll/my", "/payroll/my-yearend"]);
  assert.deepEqual(visibleSubmenu(payroll, CEO_PERMS).map((s) => s.href), ["/payroll/my", "/payroll/my-yearend", "/payroll", "/payroll/contracts", "/payroll/yearend", "/payroll/settings"]);
  const hr = MENU_ITEMS.find((item) => item.title === "근태·휴가")!;
  assert.deepEqual(visibleSubmenu(hr, EXEC_PERMS).map((s) => s.href), ["/approval/my-hr"]);
  assert.equal(visibleSubmenu(hr, ["staffing.edit@all"]).length, 7);
  const workPlan = MENU_ITEMS.find((item) => item.title === "업무추진계획")!;
  assert.deepEqual(visibleSubmenu(workPlan, STAFF_PERMS).map((s) => s.href), ["/work-plan"]);
  assert.deepEqual(visibleSubmenu(workPlan, LEAD_PERMS).map((s) => s.href), ["/work-plan", "/work-plan/oversight"]);
  assert.deepEqual(visibleSubmenu(workPlan, EXEC_PERMS).map((s) => s.href), ["/work-plan", "/work-plan/oversight", "/work-plan/exec", "/work-plan/present"]);
  const admin = MENU_ITEMS.find((item) => item.title === "사용자 관리")!;
  assert.equal(isMenuVisible(admin, ["security.access_log@all"]), true);
  assert.deepEqual(visibleSubmenu(admin, ["security.access_log@all"]).map((s) => s.href), ["/admin/access-log"]);
  const contracts = MENU_ITEMS.find((item) => item.title === "계약")!;
  assert.deepEqual(visibleSubmenu(contracts, STAFF_PERMS).map((s) => s.href).includes("/contracts/filings"), false);
  // Dashboard·수주/수금/발행 현황은 billing.view(관리자·인사/회계·대표이사)만(298)
  assert.equal(visibleSubmenu(contracts, ["contract.view@all", "filing.view@all"]).length, 5);
  assert.equal(visibleSubmenu(contracts, ["contract.view@all", "filing.view@all", "billing.view@all"]).length, 7);
  assert.equal(visibleSubmenu(contracts, EXEC_PERMS).some((s) => s.href === "/contracts/dashboard"), false);
  // 부서장은 전사 현황 대신 부서 수주·수금 현황(299)
  const leadContracts = visibleSubmenu(contracts, LEAD_PERMS).map((s) => s.href);
  assert.equal(leadContracts.includes("/contracts/dept-billing"), true);
  assert.equal(leadContracts.includes("/contracts/billing"), false);
  assert.equal(visibleSubmenu(contracts, EXEC_PERMS).some((s) => s.href === "/contracts/dept-billing"), false);
});

test("영업/마케팅 메뉴는 지정된 영업 담당자·대표이사·관리자만 본다(298)", () => {
  const sales = MENU_ITEMS.find((item) => item.title === "영업/마케팅")!;
  // 담당자 정보 데이터(contact.view)는 전 직원에게 있지만 메뉴는 sales.view 로 가린다
  assert.equal(isMenuVisible(sales, STAFF_PERMS), false);
  assert.equal(isMenuVisible(sales, LEAD_PERMS), false);
  assert.equal(isMenuVisible(sales, EXEC_PERMS), false);
  assert.equal(isMenuVisible(sales, SALES_STAFF_PERMS), true);
  assert.equal(isMenuVisible(sales, CEO_PERMS), true);
  assert.deepEqual(visibleSubmenu(sales, SALES_STAFF_PERMS).map((s) => s.href),
    ["/sales", "/sales/contacts", "/sales/intel", "/sales/rag", "/sales/bids", "/approval/quote"]);
});
