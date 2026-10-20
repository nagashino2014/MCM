"use client";

// 매뉴얼 기사 한 편 — 드로어(compact)와 /manual 페이지가 같이 쓴다.

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { ManualArticle } from "@/content/manual";
import { MANUAL_CHAPTERS } from "@/content/manual";
import { routeHref, visibleSections } from "@/lib/manual/match";
import { ManualBlocks } from "./ManualBlocks";

const AUDIENCE_LABEL: Record<string, string> = { staff: "직원", head: "부서장", exec: "임원", admin: "관리자" };

/** 매뉴얼 절 앵커 id — 드로어와 페이지가 한 화면에 함께 떠도 겹치지 않게 접두를 둔다. */
export function manualSectionDomId(prefix: string, sectionId: string): string {
  return `${prefix}-${sectionId}`;
}

export interface ManualArticleViewProps {
  article: ManualArticle;
  perms: readonly string[];
  idPrefix: string;
  /** 드로어처럼 좁은 영역 */
  compact?: boolean;
  onNavigate?: (article: string, section?: string) => void;
  /** "이 화면 열기" 링크를 눌렀을 때(드로어 닫기 등). */
  onOpenScreen?: () => void;
  /** 지금 이 화면을 보고 있으면 "이 화면 열기"를 숨긴다. */
  hideOpenScreen?: boolean;
}

export function ManualArticleView({ article, perms, idPrefix, compact, onNavigate, onOpenScreen, hideOpenScreen }: ManualArticleViewProps) {
  const chapter = MANUAL_CHAPTERS.find((c) => c.id === article.chapter);
  const sections = visibleSections(article, perms);
  const screen = article.routes.map(routeHref).find((r): r is string => !!r);

  return (
    <article className="min-w-0" aria-labelledby={`${idPrefix}-title`}>
      <div className="mb-1 text-[12px] font-medium cd-text-muted">{chapter?.title}</div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`${idPrefix}-title`} className={compact ? "text-base font-semibold cd-text" : "text-[22px] font-[650] tracking-[-0.02em] cd-text"}>
          {article.title}
        </h2>
        <span className="text-[11px] cd-text-muted">
          {article.audience.map((a) => AUDIENCE_LABEL[a]).join(" · ")} · 업데이트 {article.reviewedAt}
        </span>
      </div>

      {screen && !hideOpenScreen && (
        <Link
          href={screen}
          onClick={onOpenScreen}
          className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-[color:var(--cd-primary)] hover:underline"
        >
          이 화면 열기
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}

      <section className="mt-3 rounded-lg border cd-border-c px-3.5 py-3" aria-label="이 화면에서 할 수 있는 일">
        <h3 className="mb-1.5 text-[13px] font-semibold cd-text">이 화면에서 할 수 있는 일</h3>
        <ManualBlocks blocks={[{ kind: "list", items: article.summary }]} compact />
      </section>

      {sections.length > 1 && (
        <nav aria-label="이 기사 목차" className="mt-3 flex flex-wrap gap-1.5">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${manualSectionDomId(idPrefix, s.id)}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(manualSectionDomId(idPrefix, s.id))?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="cd-chip cd-chip-sm"
            >
              {s.title}
            </a>
          ))}
        </nav>
      )}

      <div className="mt-4 space-y-6">
        {sections.map((s) => (
          <section key={s.id} id={manualSectionDomId(idPrefix, s.id)} className="scroll-mt-4" aria-labelledby={`${manualSectionDomId(idPrefix, s.id)}-h`}>
            <h3 id={`${manualSectionDomId(idPrefix, s.id)}-h`} className="mb-2 text-[14px] font-semibold cd-text">
              {s.title}
            </h3>
            <ManualBlocks blocks={s.blocks} onNavigate={onNavigate} />
          </section>
        ))}
      </div>
    </article>
  );
}
