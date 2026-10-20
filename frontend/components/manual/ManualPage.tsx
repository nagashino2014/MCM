"use client";

// 전체 매뉴얼 페이지(/manual, /manual/[articleId]) — 왼쪽 목차 + 오른쪽 기사(blueprint §1.3).
// 사이드바 메뉴에는 넣지 않는다(구조 보존). 상단바 [매뉴얼]·F1·? 도움말·전역 검색으로 들어온다.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Printer, Search } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { MANUAL_GROUP_LABEL } from "@/content/manual";
import { articleHref, canSeeArticle, getArticle, visibleChangelog, visibleToc } from "@/lib/manual/match";
import { searchManual } from "@/lib/manual/search";
import { cn } from "@/lib/utils";
import { ManualArticleView, manualSectionDomId } from "./ManualArticleView";
import { ManualInline } from "./ManualBlocks";

const ID_PREFIX = "mpg";

export function ManualPage({ perms, articleId }: { perms: readonly string[]; articleId?: string }) {
  const { theme } = useCdashTheme();
  const [query, setQuery] = useState("");
  const toc = useMemo(() => visibleToc(perms), [perms]);
  const hits = useMemo(() => searchManual(query, perms, 20), [query, perms]);
  const news = useMemo(() => visibleChangelog(perms), [perms]);
  const found = getArticle(articleId);
  const article = found && canSeeArticle(found, perms) ? found : null;

  // 주소의 #절 로 이동(드로어·도움말에서 "전체 매뉴얼"로 넘어온 경우).
  useEffect(() => {
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!hash || !article) return;
    requestAnimationFrame(() => document.getElementById(manualSectionDomId(ID_PREFIX, hash))?.scrollIntoView({ block: "start" }));
  }, [article]);

  let lastGroup = "";
  const tocNav = (
    <nav aria-label="매뉴얼 목차" className="flex flex-col gap-3">
      {toc.map(({ chapter, articles }) => {
        const groupLabel = MANUAL_GROUP_LABEL[chapter.group];
        const showGroup = groupLabel !== lastGroup && groupLabel !== chapter.title;
        lastGroup = groupLabel;
        return (
          <div key={chapter.id}>
            {showGroup && <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide cd-text-muted">{groupLabel}</div>}
            <div className="mb-0.5 text-[13px] font-semibold cd-text">{chapter.title}</div>
            <ul className="flex flex-col border-l cd-border-c">
              {articles.map((a) => (
                <li key={a.id}>
                  <Link
                    href={articleHref(a.id)}
                    aria-current={a.id === article?.id ? "page" : undefined}
                    className={cn(
                      "-ml-px block border-l-2 px-3 py-1 text-[13px]",
                      a.id === article?.id
                        ? "border-[color:var(--cd-primary)] font-medium text-[color:var(--cd-primary)]"
                        : "border-transparent cd-text-muted hover:text-[color:var(--cd-text)]"
                    )}
                  >
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="사용 매뉴얼"
        breadcrumbs={article ? [{ label: "사용 매뉴얼", href: "/manual" }, { label: article.title }] : undefined}
        meta={article ? undefined : `내 권한으로 볼 수 있는 기사 ${toc.reduce((n, c) => n + c.articles.length, 0)}편`}
        actions={
          <button type="button" className="cd-btn cd-btn-ghost inline-flex items-center gap-1.5 print:hidden" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            인쇄 · PDF
          </button>
        }
      />

      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-h-0 print:hidden lg:overflow-y-auto">
          <label className="relative mb-4 block">
            <span className="sr-only">매뉴얼 검색</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 cd-text-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="매뉴얼 검색"
              className="cd-input w-full"
            style={{ paddingLeft: 36 }}
            />
          </label>
          {query.trim() ? (
            <ul className="flex flex-col gap-1" aria-label="검색 결과">
              {hits.length === 0 && <li className="py-4 text-center text-[13px] cd-text-muted">검색 결과가 없습니다.</li>}
              {hits.map((h) => (
                <li key={h.article.id}>
                  <Link href={articleHref(h.article.id, h.section)} onClick={() => setQuery("")} className="block rounded-lg px-3 py-2 cd-row-hover">
                    <span className="block text-[13px] font-medium cd-text">{h.article.title}</span>
                    <span className="block truncate text-[12px] cd-text-muted">
                      <ManualInline text={h.article.summary[0] ?? ""} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <details className="lg:hidden">
                <summary className="cursor-pointer text-[13px] font-semibold cd-text">목차</summary>
                <div className="mt-2">{tocNav}</div>
              </details>
              <div className="hidden lg:block">{tocNav}</div>
            </>
          )}
        </aside>

        <section aria-label="매뉴얼 본문" className="min-h-0 min-w-0 rounded-lg border cd-border-c p-4 md:p-6 lg:overflow-y-auto" style={{ background: "var(--cd-card-solid)" }}>
          {article ? (
            <ManualArticleView article={article} perms={perms} idPrefix={ID_PREFIX} />
          ) : articleId ? (
            <p className="text-[13px] cd-text-muted">
              이 기사를 찾을 수 없거나 볼 권한이 없습니다. <Link href="/manual" className="text-[color:var(--cd-primary)] hover:underline">목차로</Link>
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              <section>
                <h2 className="mb-2 text-base font-semibold cd-text">이렇게 찾아보세요</h2>
                <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed cd-text">
                  <li>어느 화면에서든 상단의 <ManualInline text="[[매뉴얼]]" /> 버튼이나 <strong>F1</strong> 키를 누르면 지금 보고 있는 화면의 설명이 열립니다.</li>
                  <li>제목이나 입력란 옆의 <strong>?</strong> 버튼은 그 항목만 짧게 설명합니다. 끝의 &lsquo;매뉴얼에서 자세히&rsquo;로 이어서 읽을 수 있습니다.</li>
                  <li>상단 검색(Ctrl K)에서도 매뉴얼을 찾을 수 있습니다. 초성(예: ㅇㅊ)으로도 찾습니다.</li>
                  <li>내 권한으로 쓸 수 없는 메뉴의 설명은 보이지 않습니다.</li>
                </ul>
              </section>
              {news.length > 0 && (
                <section aria-labelledby="mpg-news">
                  <h2 id="mpg-news" className="mb-2 text-base font-semibold cd-text">새로 바뀐 것</h2>
                  <ul className="flex flex-col divide-y cd-border-c rounded-lg border cd-border-c">
                    {news.map((n, i) => (
                      <li key={i} className="px-3 py-2 text-[13px] leading-relaxed cd-text">
                        <span className="mr-2 cd-text-muted">{n.date}</span>
                        <span className="mr-1.5 font-medium">[{n.kind}]</span>
                        {n.articles[0] ? (
                          <Link href={articleHref(n.articles[0])} className="hover:underline">{n.title}</Link>
                        ) : (
                          n.title
                        )}
                        {n.body && <p className="mt-0.5 text-[12px] cd-text-muted">{n.body}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              <section aria-labelledby="mpg-toc">
                <h2 id="mpg-toc" className="mb-2 text-base font-semibold cd-text">전체 목차</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {toc.map(({ chapter, articles }) => (
                    <div key={chapter.id} className="rounded-lg border cd-border-c p-3">
                      <h3 className="mb-1.5 text-[13px] font-semibold cd-text">{chapter.title}</h3>
                      <ul className="flex flex-col gap-0.5">
                        {articles.map((a) => (
                          <li key={a.id}>
                            <Link href={articleHref(a.id)} className="text-[13px] cd-text-muted hover:text-[color:var(--cd-primary)] hover:underline">
                              {a.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
