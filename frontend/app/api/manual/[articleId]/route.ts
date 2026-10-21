import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { loadPermissionSummary } from "@/lib/auth/rbac";
import type { ManualBlock } from "@/content/manual";
import { canSeeArticle, getArticle, visibleSections } from "@/lib/manual/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ articleId: string }>;
}

/**
 * GET: 매뉴얼 기사 한 편(모바일 앱 4단계) — 웹 ManualArticleView 와 같은 권한 필터(기사·절 requires).
 * 볼 수 없는 기사로 가는 link 블록은 빼고, 보이는 것은 대상 제목을 함께 실어 앱이 그대로 그리게 한다.
 */
export async function GET(_: NextRequest, context: RouteContext) {
  try {
    const ctx = await requireSession();
    const perms = await loadPermissionSummary(ctx.userId);
    const { articleId } = await context.params;
    const article = getArticle(articleId);
    if (!article || !canSeeArticle(article, perms)) {
      return NextResponse.json({ error: "볼 수 있는 매뉴얼 기사가 아닙니다." }, { status: 404 });
    }
    const resolveBlock = (b: ManualBlock): (ManualBlock & { targetTitle?: string }) | null => {
      if (b.kind !== "link") return b;
      const target = getArticle(b.article);
      if (!target || !canSeeArticle(target, perms)) return null;
      const sectionTitle = b.section ? target.sections.find((s) => s.id === b.section)?.title : undefined;
      return { ...b, targetTitle: sectionTitle ? `${target.title} · ${sectionTitle}` : target.title };
    };
    return NextResponse.json({
      article: {
        id: article.id,
        chapter: article.chapter,
        title: article.title,
        summary: article.summary,
        reviewedAt: article.reviewedAt,
        sections: visibleSections(article, perms).map((s) => ({
          id: s.id,
          title: s.title,
          blocks: s.blocks.map(resolveBlock).filter((b) => b !== null),
        })),
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
