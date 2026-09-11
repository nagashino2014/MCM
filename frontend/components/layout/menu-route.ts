interface MenuRoute {
  title: string;
  href: string;
  submenu?: { title: string; href: string }[];
}

export interface MenuRouteMatch {
  parentTitle: string;
  href: string;
}

// FinanceBoard의 소메뉴 내부 탭도 동일한 탐색 문맥을 유지한다. URL 자체는 변경하지 않는다.
const FINANCE_MENU_TABS: Record<string, string> = {
  connections: "connections",
  bank: "bank", card: "bank", reimburse: "bank",
  invoice: "invoice", recon: "invoice",
  vat: "vat", shopreceipt: "vat", hometax: "vat", vatreturn: "vat", withholding: "vat", incomeledger: "vat",
  journal: "journal", ledger: "journal", trial: "journal",
  pnl: "pnl", cash: "pnl", balance: "pnl", closing: "pnl",
  fixedassets: "fixedassets", triplog: "fixedassets", budget: "fixedassets",
  expsettle: "expsettle", severance: "expsettle",
};

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/** 전체 메뉴에서 경로가 가장 길고 query가 가장 구체적인 항목 하나만 고른다. */
export function resolveMenuRoute(items: readonly MenuRoute[], pathname: string | null, search = ""): MenuRouteMatch | null {
  if (!pathname) return null;
  const currentPath = normalizePath(pathname);
  const currentQuery = new URLSearchParams(search);
  if (currentPath === "/finance") {
    const tab = currentQuery.get("tab") ?? "";
    currentQuery.set("tab", Object.prototype.hasOwnProperty.call(FINANCE_MENU_TABS, tab) ? FINANCE_MENU_TABS[tab] : "connections");
  }
  let best: (MenuRouteMatch & { pathLength: number; queryCount: number; child: number }) | null = null;

  for (const item of items) {
    for (const [index, route] of [item, ...(item.submenu ?? [])].entries()) {
      const url = new URL(route.href, "https://mcm.local");
      const routePath = normalizePath(url.pathname);
      if (currentPath !== routePath && (routePath === "/" || !currentPath.startsWith(`${routePath}/`))) continue;
      const queryEntries = Array.from(url.searchParams.entries());
      if (!queryEntries.every(([key, value]) => currentQuery.get(key) === value)) continue;
      const candidate = { parentTitle: item.title, href: route.href, pathLength: routePath.length, queryCount: queryEntries.length, child: index > 0 ? 1 : 0 };
      if (!best || candidate.pathLength > best.pathLength
        || (candidate.pathLength === best.pathLength && candidate.queryCount > best.queryCount)
        || (candidate.pathLength === best.pathLength && candidate.queryCount === best.queryCount && candidate.child > best.child)) {
        best = candidate;
      }
    }
  }

  return best ? { parentTitle: best.parentTitle, href: best.href } : null;
}
