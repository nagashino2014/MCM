import assert from "node:assert/strict";
import test from "node:test";
import { MENU_ITEMS, isMenuVisibleForRole } from "../config/menu";
import { resolveMenuRoute } from "../components/layout/menu-route";

test("기존 메뉴의 모든 진입 URL은 정확히 자기 메뉴를 선택한다", () => {
  assert.equal(MENU_ITEMS.length, 23);
  assert.equal(MENU_ITEMS.reduce((count, item) => count + (item.submenu?.length ?? 0), 0), 65);
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

test("역할로 숨긴 메뉴는 matcher 입력에 포함되지 않는다", () => {
  const viewerMenus = MENU_ITEMS.filter((item) => isMenuVisibleForRole(item, "viewer"));
  const editorMenus = MENU_ITEMS.filter((item) => isMenuVisibleForRole(item, "editor"));
  assert.equal(resolveMenuRoute(viewerMenus, "/finance", "tab=bank"), null);
  assert.equal(resolveMenuRoute(viewerMenus, "/admin/users"), null);
  assert.equal(resolveMenuRoute(viewerMenus, "/trash"), null);
  assert.deepEqual(resolveMenuRoute(editorMenus, "/trash"), { parentTitle: "휴지통", href: "/trash" });
});
