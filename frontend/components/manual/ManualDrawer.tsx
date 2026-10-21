"use client";

// 매뉴얼 드로어 — 지금 보고 있는 화면의 기사를 먼저 보여 주고, 검색·목차·새 소식으로 이어진다(blueprint §1.2).

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, BookOpen, Search } from "lucide-react";
import { CdDrawer } from "@/components/cdash/CdModal";
import { articleHref, findArticleForLocation, getArticle, visibleChangelog, visibleToc } from "@/lib/manual/match";
import { searchManual } from "@/lib/manual/search";
import { ManualArticleView, manualSectionDomId } from "./ManualArticleView";
import { ManualInline } from "./ManualBlocks";

const ID_PREFIX = "mdr";

export interface ManualDrawerProps {
  open: boolean;
  onClose: () => void;
  perms: readonly string[];
  initialArticle?: string;
  initialSection?: string;
}

export function ManualDrawer({ open, onClose, perms, initialArticle, initialSection }: ManualDrawerProps) {
  const pathname = usePathname();
  // 열린 순간의 화면 기준(드로어 안에서 다른 기사로 이동해도 "이 화면" 기준은 유지).
  const contextArticle = useMemo(
    () => (typeof window === "undefined" ? null : findArticleForLocation(pathname, window.location.search, perms)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open]
  );
  const [viewing, setViewing] = useState<{ article: string | null; section?: string }>(() => ({
    article: initialArticle ?? null,
    section: initialSection,
  }));
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const article = getArticle(viewing.article) ?? (viewing.article ? null : contextArticle);
  const hits = useMemo(() => searchManual(query, perms), [query, perms]);
  const toc = useMemo(() => visibleToc(perms), [perms]);
  const news = useMemo(() => visibleChangelog(perms).slice(0, 3), [perms]);

  // 절 이동 — 렌더 뒤 해당 절로 스크롤, 절이 없으면 맨 위로.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const el = viewing.section ? document.getElementById(manualSectionDomId(ID_PREFIX, viewing.section)) : document.getElementById(`${ID_PREFIX}-top`);
      el?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [open, viewing]);

  const navigate = (id: string, section?: string) => {
    setQuery("");
    setViewing({ article: id, section });
  };

  const showingContext = !!contextArticle && article?.id === contextArticle.id;

  return (
    <CdDrawer
      open={open}
      onClose={onClose}
      title="사용 매뉴얼"
      side="right"
      widthClass="max-w-[560px]"
      footer={
        <Link
          href={article ? articleHref(article.id) : "/manual"}
          onClick={onClose}
          className="cd-btn cd-btn-ghost inline-flex items-center gap-1.5"
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          전체 매뉴얼
        </Link>
      }
    >
      <div id={`${ID_PREFIX}-top`} className="flex flex-col gap-4">
        <label className="relative block">
          <span className="sr-only">매뉴얼 검색</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 cd-text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="매뉴얼 검색 (예: 연차, 결재선, ㄱㅈㅅ)"
            className="cd-input w-full"
            style={{ paddingLeft: 36 }}
          />
        </label>

        {query.trim() ? (
          <section aria-label="검색 결과">
            {hits.length === 0 ? (
              <p className="py-6 text-center text-[13px] cd-text-muted">검색 결과가 없습니다. 다른 낱말로 찾아 보세요.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {hits.map((h) => (
                  <li key={h.article.id}>
                    <button
                      type="button"
                      onClick={() => navigate(h.article.id, h.section)}
                      className="w-full rounded-lg px-3 py-2 text-left cd-row-hover"
                    >
                      <span className="block text-[13px] font-medium cd-text">{h.article.title}</span>
                      <span className="block truncate text-[12px] cd-text-muted">
                        <ManualInline text={h.article.summary[0] ?? ""} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <>
            {contextArticle && !showingContext && (
              <button
                type="button"
                onClick={() => setViewing({ article: contextArticle.id })}
                className="inline-flex w-fit items-center gap-1 text-[12px] font-medium text-[color:var(--cd-primary)] hover:underline"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                지금 보고 있는 화면({contextArticle.title}) 설명으로
              </button>
            )}

            {article ? (
              <ManualArticleView
                article={article}
                perms={perms}
                idPrefix={ID_PREFIX}
                compact
                onNavigate={navigate}
                onOpenScreen={onClose}
                hideOpenScreen={showingContext}
              />
            ) : (
              <section aria-label="매뉴얼 목차" className="flex flex-col gap-3">
                <p className="text-[13px] leading-[calc(1.625em+3px)] cd-text-muted">
                  이 화면의 설명은 아직 준비 중입니다. 아래 목차에서 찾거나 위 검색창에 궁금한 낱말을 입력하세요.
                </p>
                {toc.map(({ chapter, articles }) => (
                  <div key={chapter.id}>
                    <h3 className="mb-1 text-[12px] font-semibold cd-text-muted">{chapter.title}</h3>
                    <ul className="flex flex-col">
                      {articles.map((a) => (
                        <li key={a.id}>
                          <button type="button" onClick={() => navigate(a.id)} className="w-full rounded-md px-2 py-1.5 text-left text-[13px] cd-text cd-row-hover">
                            {a.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            )}

            {news.length > 0 && (
              <section aria-label="새로 바뀐 것" className="border-t cd-border-c pt-3">
                <h3 className="mb-1.5 text-[12px] font-semibold cd-text-muted">새로 바뀐 것</h3>
                <ul className="flex flex-col gap-1">
                  {news.map((n, i) => (
                    <li key={i} className="text-[12px] leading-[calc(1.625em+3px)] cd-text">
                      <span className="mr-1.5 cd-text-muted">{n.date.slice(5)}</span>
                      <span className="mr-1 font-medium">[{n.kind}]</span>
                      {n.articles[0] ? (
                        <button type="button" onClick={() => navigate(n.articles[0])} className="text-left hover:underline">
                          {n.title}
                        </button>
                      ) : (
                        n.title
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </CdDrawer>
  );
}
