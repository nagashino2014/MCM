"use client";

// 매뉴얼 기사 한 편 — 드로어(compact)와 /manual 페이지가 같이 쓴다.

import Link from "next/link";
import { useRef } from "react";
import { ArrowUp, ExternalLink } from "lucide-react";
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
  const articleRef = useRef<HTMLElement>(null);
  // 항목 제목 옆 [맨 위로] — 드로어는 검색창까지(접두-top), 페이지는 기사 머리로 스크롤하고 제목에 포커스를 둔다.
  const scrollToTop = () => {
    // 포커스를 먼저 옮긴다 — 스크롤 뒤에 focus() 를 부르면 진행 중인 부드러운 스크롤이 취소된다.
    document.getElementById(`${idPrefix}-title`)?.focus({ preventScroll: true });
    const target = document.getElementById(`${idPrefix}-top`) ?? articleRef.current;
    if (!target) return;
    // 가장 가까운 스크롤 영역을 직접 부드럽게 올린다 — 스크롤 영역이 중첩된 /manual 페이지에서는
    // scrollIntoView({ behavior: "smooth" }) 가 움직이지 않는다.
    let box: HTMLElement | null = target.parentElement;
    while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) box = box.parentElement;
    if (!box) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const top = target.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 16;
    box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };

  return (
    <article ref={articleRef} className="min-w-0 scroll-mt-4" aria-labelledby={`${idPrefix}-title`}>
      <div className="mb-1 text-[12px] font-medium cd-text-muted">{chapter?.title}</div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={`${idPrefix}-title`} tabIndex={-1} className={compact ? "text-base font-semibold cd-text focus:outline-none" : "text-[22px] font-[650] tracking-[-0.02em] cd-text focus:outline-none"}>
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

      <div className="mt-4 space-y-11">
        {sections.map((s) => (
          <section key={s.id} id={manualSectionDomId(idPrefix, s.id)} className="scroll-mt-4" aria-labelledby={`${manualSectionDomId(idPrefix, s.id)}-h`}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 id={`${manualSectionDomId(idPrefix, s.id)}-h`} className="text-[14px] font-semibold cd-text">
                {s.title}
              </h3>
              {sections.length > 1 && (
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="cd-icon-button inline-flex h-7 w-7 shrink-0 items-center justify-center cd-text-muted hover:bg-[color:var(--cd-hover)] hover:text-[color:var(--cd-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--cd-primary)]"
                  aria-label={`${s.title}에서 매뉴얼 맨 위로`}
                  title="맨 위로"
                >
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            <ManualBlocks blocks={s.blocks} onNavigate={onNavigate} />
          </section>
        ))}
      </div>
    </article>
  );
}
