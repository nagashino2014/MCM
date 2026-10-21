import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { loadPermissionSummary } from "@/lib/auth/rbac";
import { MANUAL_GROUP_LABEL } from "@/content/manual";
import { visibleChangelog, visibleToc } from "@/lib/manual/match";
import { searchManual } from "@/lib/manual/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: 사용 매뉴얼 목차·검색(모바일 앱 4단계, docs/manual-help-blueprint.md §1.4).
 * 웹과 같은 content/manual 을 내 권한(사이드바와 같은 기준)으로 걸러 돌려준다 — 원본은 하나다.
 *   ?q= 가 있으면 검색 결과 { hits }, 없으면 { toc, changelog }.
 * 권한 요약은 웹 세션 스냅샷 대신 DB 에서 새로 읽는다(모바일 Bearer 토큰에는 요약이 없다).
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const perms = await loadPermissionSummary(ctx.userId);
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 50);
    if (q) {
      const hits = searchManual(q, perms, 20).map((h) => ({
        articleId: h.article.id,
        title: h.article.title,
        section: h.section ?? null,
        sectionTitle: h.section ? h.article.sections.find((s) => s.id === h.section)?.title ?? null : null,
      }));
      return NextResponse.json({ hits });
    }
    const toc = visibleToc(perms).map(({ chapter, articles }) => ({
      id: chapter.id,
      title: chapter.title,
      group: MANUAL_GROUP_LABEL[chapter.group] ?? chapter.group,
      articles: articles.map((a) => ({ id: a.id, title: a.title, summary: a.summary[0] ?? "" })),
    }));
    return NextResponse.json({ toc, changelog: visibleChangelog(perms).slice(0, 10) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
