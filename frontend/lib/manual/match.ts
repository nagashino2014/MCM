/**
 * 매뉴얼 기사 ↔ 화면 경로 매칭과 권한 필터(docs/manual-help-blueprint.md §1.2·§3).
 * 사이드바와 같은 기준(menuPermissionKeys + hasAnyPerm)으로 판정해 "메뉴에는 없는데 매뉴얼에는 있다"를 막는다.
 */
import { MANUAL_ARTICLES, MANUAL_CHANGELOG, MANUAL_CHAPTERS } from "@/content/manual";
import type { ChangelogEntry, ManualArticle, ManualChapter, ManualSection } from "@/content/manual";
import { menuPermissionKeys } from "@/config/menu-permissions";
import { hasAnyPerm } from "@/lib/auth/perms";

const BY_ID = new Map(MANUAL_ARTICLES.map((a) => [a.id, a]));

export function getArticle(id: string | null | undefined): ManualArticle | null {
  return id ? BY_ID.get(id) ?? null : null;
}

/** 기사가 요구하는 권한키 — 명시가 없으면 첫 화면 경로의 메뉴 권한표를 쓴다. */
export function articleRequiredKeys(article: ManualArticle): readonly string[] {
  if (article.requires) return article.requires;
  const first = article.routes[0];
  return first ? menuPermissionKeys(routeHref(first) ?? first.replace(/\/\*.*$/, "").replace(/\$$/, "")) : [];
}

export function canSeeArticle(article: ManualArticle, perms: readonly string[]): boolean {
  return hasAnyPerm(perms, articleRequiredKeys(article));
}

export function visibleSections(article: ManualArticle, perms: readonly string[]): ManualSection[] {
  return article.sections.filter((s) => !s.requires || hasAnyPerm(perms, s.requires));
}

export function visibleArticles(perms: readonly string[]): ManualArticle[] {
  return MANUAL_ARTICLES.filter((a) => canSeeArticle(a, perms));
}

/** 장 → 보이는 기사 목록(빈 장은 제외). */
export function visibleToc(perms: readonly string[]): { chapter: ManualChapter; articles: ManualArticle[] }[] {
  const list = visibleArticles(perms);
  return MANUAL_CHAPTERS.map((chapter) => ({ chapter, articles: list.filter((a) => a.chapter === chapter.id) })).filter(
    (c) => c.articles.length > 0
  );
}

export function visibleChangelog(perms: readonly string[]): ChangelogEntry[] {
  return MANUAL_CHANGELOG.filter(
    (e) => e.articles.length === 0 || e.articles.some((id) => {
      const a = getArticle(id);
      return !!a && canSeeArticle(a, perms);
    })
  );
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/**
 * 기사 routes 표기 → 실제로 열 수 있는 화면 주소. "*" 가 든 패턴은 null.
 * 끝의 "$" 는 "정확히 이 경로만"(하위 경로 제외) 표시다.
 */
export function routeHref(route: string): string | null {
  if (route.includes("*")) return null;
  return route.replace(/\$(?=\?|$)/, "");
}

/** 경로 패턴 일치 — "*" 세그먼트는 아무 세그먼트, 끝 "$" 는 정확히 일치, 그 외는 같거나 하위 경로. */
function pathMatches(routePath: string, currentPath: string): boolean {
  if (routePath.endsWith("$")) return currentPath === routePath.slice(0, -1);
  if (routePath.includes("*")) {
    const re = new RegExp(
      "^" + routePath.split("/").map((seg) => (seg === "*" ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/") + "(/.*)?$"
    );
    return re.test(currentPath);
  }
  return currentPath === routePath || (routePath !== "/" && currentPath.startsWith(`${routePath}/`));
}

/**
 * 현재 화면에 맞는 기사 — 경로가 가장 길고 query 가 가장 구체적인 것 하나(components/layout/menu-route.ts 와 같은 규칙).
 */
export function findArticleForLocation(pathname: string | null, search: string, perms: readonly string[]): ManualArticle | null {
  if (!pathname) return null;
  const currentPath = normalizePath(pathname);
  const currentQuery = new URLSearchParams(search);
  let best: { article: ManualArticle; pathLength: number; queryCount: number } | null = null;
  for (const article of visibleArticles(perms)) {
    for (const route of article.routes) {
      const url = new URL(route.replace(/\*/g, "__any__").replace(/\$(?=\?|$)/, "__exact__"), "https://mcm.local");
      const exact = url.pathname.endsWith("__exact__");
      const routePath = normalizePath(url.pathname.replace(/__exact__$/, "").replace(/__any__/g, "*")) + (exact ? "$" : "");
      if (!pathMatches(routePath, currentPath)) continue;
      const queryEntries = Array.from(url.searchParams.entries());
      if (!queryEntries.every(([key, value]) => currentQuery.get(key) === value)) continue;
      const pathLength = routePath.replace(/[*$]/g, "").length + (routePath.match(/\*/g)?.length ?? 0) + (exact ? 0.5 : 0);
      if (
        !best ||
        pathLength > best.pathLength ||
        (pathLength === best.pathLength && queryEntries.length > best.queryCount)
      ) {
        best = { article, pathLength, queryCount: queryEntries.length };
      }
    }
  }
  return best?.article ?? null;
}

export function articleHref(id: string, section?: string): string {
  return `/manual/${encodeURIComponent(id)}${section ? `#${section}` : ""}`;
}
