"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Handshake, LayoutDashboard, Moon, Sun } from "lucide-react";
import { DASHBOARD_CATEGORIES, type CdTheme, type DashboardData } from "./types";
import { FilterCard } from "./FilterCard";
import { MonthlyTrendCard } from "./MonthlyTrendCard";
import { ServiceDetailCard } from "./ServiceDetailCard";
import { CollectionGaugeCard } from "./CollectionGaugeCard";
import { CounterpartyCard } from "./CounterpartyCard";
import { RegionCard } from "./RegionCard";
import { UncollectedCard } from "./UncollectedCard";
import { RecentCollectionsCard } from "./RecentCollectionsCard";

const THEME_STORAGE_KEY = "cdash-theme";

export function DashboardShell() {
  const [theme, setTheme] = useState<CdTheme>("dark");
  const [year, setYear] = useState<string | null>(null);
  const [category, setCategory] = useState<string>(DASHBOARD_CATEGORIES[0]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // 테마 복원
  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  };

  const load = useCallback(
    async (opts?: { year?: string | null; category?: string }) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        const y = opts?.year !== undefined ? opts.year : year;
        const cat = opts?.category ?? category;
        if (y) params.set("year", y);
        params.set("category", cat);
        const qs = params.toString();
        const res = await fetch(`/api/contracts/dashboard${qs ? `?${qs}` : ""}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string })?.error ?? "HTTP " + res.status);
        }
        const json = (await res.json()) as DashboardData;
        if (seq !== requestSeq.current) return;
        setData(json);
        setYear(json.year);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setError((err as Error).message);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [year, category]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleYearChange = (nextYear: string) => {
    setYear(nextYear);
    load({ year: nextYear });
  };

  const handleCategoryChange = (nextCategory: string) => {
    setCategory(nextCategory);
    load({ category: nextCategory });
  };

  return (
    <div className="cdash min-h-full rounded-3xl p-4 md:p-5" data-theme={theme}>
      {/* 헤더 */}
      <header className="flex items-center justify-between gap-3 flex-wrap mb-4 reveal">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center justify-center w-10 h-10 rounded-xl"
            style={{ background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }}
          >
            <LayoutDashboard className="w-5 h-5" />
          </span>
          <div>
            <p
              className="text-[10px] font-extrabold tracking-[0.22em] uppercase"
              style={{ color: "var(--cd-primary)" }}
            >
              Contract Dashboard
            </p>
            <h1 className="text-xl font-extrabold tracking-tight" style={{ color: "var(--cd-text)" }}>
              계약 Dashboard
              {data && (
                <span className="ml-2 text-sm font-bold" style={{ color: "var(--cd-faint)" }}>
                  {data.year}년
                </span>
              )}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <span
              className="text-[11px] font-bold px-3 py-1.5 rounded-lg"
              style={{ background: "var(--cd-error-soft)", color: "var(--cd-error)" }}
            >
              불러오기 실패: {error}
            </span>
          )}
          <button
            type="button"
            onClick={toggleTheme}
            className="cd-chip inline-flex items-center gap-1.5"
            aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
          >
            {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            {theme === "dark" ? "라이트" : "다크"}
          </button>
        </div>
      </header>

      {/* 그리드 */}
      <div className="cd-grid">
        <MonthlyTrendCard
          area="cd-a-sales"
          icon={<BarChart3 className="w-4 h-4" />}
          title="매출 현황"
          totalLabel="매출현황"
          variant="blue"
          theme={theme}
          year={data?.year ?? year}
          block={data?.sales ?? null}
          loading={loading && !data}
          delay={1}
        />
        <MonthlyTrendCard
          area="cd-a-orders"
          icon={<Handshake className="w-4 h-4" />}
          title="수주 현황"
          totalLabel="수주총액"
          variant="orange"
          theme={theme}
          year={data?.year ?? year}
          block={data?.orders ?? null}
          loading={loading && !data}
          delay={1}
        />
        <UncollectedCard items={data?.uncollected ?? null} loading={loading && !data} onChanged={() => load()} />
        <ServiceDetailCard
          year={data?.year ?? year}
          category={data?.category ?? category}
          totalCount={data?.serviceDetail.totalCount ?? 0}
          rows={data?.serviceDetail.rows ?? []}
          loading={loading && !data}
        />
        <CounterpartyCard theme={theme} year={data?.year ?? year} />
        <RegionCard theme={theme} regions={data?.regions ?? []} loading={loading && !data} />
        <RecentCollectionsCard items={data?.recentCollections ?? null} loading={loading && !data} onChanged={() => load()} />
        <CollectionGaugeCard
          theme={theme}
          year={data?.year ?? year}
          category={data?.category ?? category}
          collection={data?.collection ?? null}
          loading={loading && !data}
        />
        <FilterCard
          years={data?.availableYears ?? []}
          year={year}
          category={category}
          onYearChange={handleYearChange}
          onCategoryChange={handleCategoryChange}
        />
      </div>
    </div>
  );
}
