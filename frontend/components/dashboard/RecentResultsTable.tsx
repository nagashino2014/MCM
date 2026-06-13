"use client";

import { useCallback, useEffect, useState } from "react";
import { ListChecks, ArrowUpRight } from "lucide-react";
import { formatCompanyName } from "@/lib/ieps/formatters";

interface Row {
  facilityId: string;
  companyName: string;
  siteAddress: string | null;
  industryCode: string | null;
  industryName: string | null;
  decisionNo: string | null;
  permitDate: string | null;
  airClass: number | null;
  waterClass: number | null;
  createdAt: string;
}

export function RecentResultsTable({ refreshKey }: { refreshKey?: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/recent-facilities?limit=10", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { items: Row[] };
      setRows(json.items || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  return (
    <section className="cd-card p-6 rounded-3xl cd-reveal delay-2">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold cd-text-muted flex items-center gap-2">
          <ListChecks className="w-5 h-5 cd-text-primary" />
          수집 결과
        </h3>
        <a
          href="/data/review"
          className="text-xs font-semibold cd-text-faint hover:text-[color:var(--cd-primary)] transition-colors flex items-center gap-1 group"
        >
          검수 대기열로 이동
          <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </a>
      </div>

      {/* 헤더와 행 영역의 좌측 시작 위치를 일치시키기 위해 동일 그리드 + 동일 좌우 패딩(p-3) 사용.
          행 영역의 `overflow-y-auto` 가 만드는 스크롤바 gutter 만큼 헤더 우측에 padding 을 보태
          fr 분배가 헤더/행에서 동일하게 되도록 보정한다. */}
      <div className="hidden md:grid grid-cols-[1.5fr_1fr_1fr_0.8fr] gap-3 p-3 pr-[14px] text-left text-[10px] font-bold uppercase cd-text-faint tracking-wide">
        <div className="text-left">상호 / 소재지</div>
        <div className="text-left">결정번호 · 허가일</div>
        <div className="text-left">업종</div>
        <div className="text-left">종 규모</div>
      </div>

      <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto">
        {loading && (
          <div className="cd-text-faint text-sm text-center py-10">로딩 중…</div>
        )}
        {error && (
          <div className="cd-error-text text-sm font-bold text-center py-6">
            데이터 조회 실패: {error}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="cd-text-faint text-sm text-center py-10">
            아직 수집된 사업장이 없습니다. 우측 수집 옵션에서 수집을 시작하세요.
          </div>
        )}
        {rows.map((r) => {
          const companyName = formatCompanyName(r.companyName) ?? r.companyName;
          return (
            <div
              key={r.facilityId}
              className="grid grid-cols-[1.5fr_1fr_1fr_0.8fr] gap-3 items-start p-3 rounded-xl cd-surface-bg hover:bg-[color:var(--cd-surface)] transition-colors border cd-border-c group text-left"
            >
              <div className="min-w-0 text-left">
                <div className="text-sm font-bold cd-text truncate">
                  {companyName || "(상호 미상)"}
                </div>
                <div className="text-[11px] cd-text-faint truncate">
                  {r.siteAddress || "—"}
                </div>
              </div>
              <div className="min-w-0 text-left">
                <div className="text-xs font-bold cd-text-muted truncate">{r.decisionNo || "—"}</div>
                <div className="text-[11px] cd-text-faint truncate">{r.permitDate || "—"}</div>
              </div>
              <div className="min-w-0 text-left">
                <div className="text-xs font-bold cd-text-muted truncate">
                  {r.industryCode || "—"}
                </div>
                <div className="text-[11px] cd-text-faint truncate">
                  {r.industryName || "—"}
                </div>
              </div>
              <div className="flex flex-col items-start gap-1 text-left">
                {r.airClass != null && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 w-fit">
                    대기 {r.airClass}종
                  </span>
                )}
                {r.waterClass != null && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-800 w-fit">
                    수질 {r.waterClass}종
                  </span>
                )}
                {r.airClass == null && r.waterClass == null && (
                  <span className="text-[10px] cd-text-faint">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
