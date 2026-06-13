"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Briefcase,
  Droplets,
  ExternalLink,
  FileSpreadsheet,
  Wind,
} from "lucide-react";
import {
  AIR_PALETTE,
  PieCard,
  SERVICE_PALETTE,
  SIZE_PALETTE,
  WATER_PALETTE,
  bucketsToSlices,
  dummyServiceMix,
  dummySizeMix,
} from "./RegionStatsCharts";
import { formatCompanyName } from "@/lib/ieps/formatters";
import type { FacilityCompanySize } from "@/lib/ieps/facility-service";

interface RegionStatsFacility {
  facilityId: string;
  companyName: string;
  industryName: string | null;
  airClass: number | null;
  waterClass: number | null;
  permitDate: string | null;
}

interface RegionStats {
  scope: { sido: string | null; sigungu: string | null };
  total: number;
  airClass: { class: number; count: number }[];
  waterClass: { class: number; count: number }[];
  companySizes: { size: FacilityCompanySize | "unknown"; label: string; count: number }[];
  facilities: RegionStatsFacility[];
}

interface Props {
  sidoFull: string;
  sidoShort: string;
}

export function RegionSidoSummaryCard({ sidoFull, sidoShort }: Props) {
  const [data, setData] = useState<RegionStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    (async () => {
      try {
        const params = new URLSearchParams({ sido: sidoFull, limit: "all" });
        const res = await fetch("/api/dashboard/region-stats?" + params.toString(), {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = (await res.json()) as RegionStats;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sidoFull]);

  const seed = useMemo(() => {
    let h = 0;
    for (let i = 0; i < sidoFull.length; i++) h = (h * 31 + sidoFull.charCodeAt(i)) >>> 0;
    return h || 1;
  }, [sidoFull]);

  const exportHref =
    "/api/dashboard/region-stats/export?" +
    new URLSearchParams({ sido: sidoFull }).toString();

  return (
    <aside
      className="region-sido-summary cd-card rounded-2xl"
      aria-label={`${sidoShort} 광역 사업장 통계`}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <header className="flex items-start justify-between gap-3 px-4 py-3 border-b cd-border-c">
        <div className="min-w-0">
          <p className="text-[10px] font-bold cd-text-primary tracking-[0.18em] uppercase">
            Province Snapshot
          </p>
          <h3 className="text-sm font-extrabold cd-text truncate mt-0.5">
            {sidoShort} 전체 사업장
          </h3>
          <p className="text-[10px] cd-text-faint mt-0.5 truncate">
            시군구 지도 단계에서 보는 광역 통계 · 전체 리스트
          </p>
        </div>
        <a
          href={exportHref}
          className="cd-btn cd-btn-ghost inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl cd-text-primary"
          aria-label={`${sidoShort} 사업장 목록 엑셀 내보내기`}
          title="엑셀 내보내기"
        >
          <FileSpreadsheet className="h-4 w-4" />
        </a>
      </header>

      <div className="px-4 py-3">
        {loading && (
          <div className="py-10 text-center text-xs font-bold cd-text-faint">불러오는 중…</div>
        )}
        {error && (
          <div className="py-10 text-center text-xs font-bold cd-error-text">
            데이터 로딩 실패: {error}
          </div>
        )}

        {data && !loading && (
          <>
            <div className="mb-3 flex items-end justify-between gap-2">
              <div>
                <div className="text-[11px] cd-text-faint">총 사업장</div>
                <div className="text-2xl font-black cd-text leading-none">
                  {data.total.toLocaleString()}
                  <span className="ml-1 text-xs font-bold cd-text-faint">개</span>
                </div>
              </div>
              <div className="rounded-full cd-tint-primary px-2.5 py-1 text-[10px] font-extrabold cd-text-primary">
                {data.facilities.length.toLocaleString()}개 표시
              </div>
            </div>

            <section className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <PieCard
                title="대기 종 규모"
                icon={<Wind className="h-3.5 w-3.5" style={{ color: "#5B9BD5" }} />}
                slices={bucketsToSlices(data.airClass, "종")}
                kind="real"
                palette={AIR_PALETTE}
                compact
              />
              <PieCard
                title="수질 종 규모"
                icon={<Droplets className="h-3.5 w-3.5" style={{ color: "#70AD47" }} />}
                slices={bucketsToSlices(data.waterClass, "종")}
                kind="real"
                palette={WATER_PALETTE}
                compact
              />
              <PieCard
                title="대상 용역 분류"
                icon={<Briefcase className="h-3.5 w-3.5 cd-text-faint" />}
                slices={dummyServiceMix(data.total, seed)}
                kind="concept"
                palette={SERVICE_PALETTE}
                conceptNote="계약 관리 모듈 입력 후 실측 전환 예정"
                compact
              />
              <PieCard
                title="사업장 분류"
                icon={<Building2 className="h-3.5 w-3.5 cd-text-faint" />}
                slices={
                  data.companySizes?.some((item) => item.count > 0 && item.size !== "unknown")
                    ? data.companySizes.map((item) => ({ label: item.label, count: item.count }))
                    : dummySizeMix(data.total, seed)
                }
                kind={data.companySizes?.some((item) => item.count > 0 && item.size !== "unknown") ? "real" : "concept"}
                palette={SIZE_PALETTE}
                conceptNote="사업장 분류 입력 전 임시 분포"
                compact
              />
            </section>

            <section className="mt-4">
              <h4 className="mb-2 text-[11px] font-extrabold cd-text-muted">
                사업장 리스트 ({data.facilities.length.toLocaleString()}개)
              </h4>
              <div className="max-h-[294px] overflow-y-auto scrollbar-hide rounded-xl border cd-border-c cd-surface-bg">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 z-10">
                    <tr className="cd-surface-bg text-left text-[9px] font-extrabold uppercase tracking-wider cd-text-faint">
                      <th className="px-2 py-1.5">상호</th>
                      <th className="px-2 py-1.5">업종</th>
                      <th className="px-2 py-1.5 text-center">대기</th>
                      <th className="px-2 py-1.5 text-center">수질</th>
                      <th className="px-2 py-1.5">허가일자</th>
                      <th className="px-2 py-1.5 w-[1%]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.facilities.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-2 py-5 text-center cd-text-faint">
                          사업장 데이터가 없습니다.
                        </td>
                      </tr>
                    )}
                    {data.facilities.map((f) => {
                      const companyName = formatCompanyName(f.companyName) ?? f.companyName;
                      return (
                      <tr key={f.facilityId} className="border-t cd-border-c hover:bg-[color:var(--cd-surface)]">
                        <td className="max-w-[220px] truncate px-2 py-1.5 font-bold cd-text">
                          {companyName || "(이름 없음)"}
                        </td>
                        <td className="max-w-[190px] truncate px-2 py-1.5 cd-text-muted">
                          {f.industryName ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center cd-text-muted">
                          {f.airClass != null ? `${f.airClass}종` : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center cd-text-muted">
                          {f.waterClass != null ? `${f.waterClass}종` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 cd-text-faint">
                          {f.permitDate ?? "—"}
                        </td>
                        <td className="px-2 py-1.5">
                          <Link
                            href={`/facilities?focus=${encodeURIComponent(f.facilityId)}`}
                            className="inline-flex items-center justify-center cd-text-primary hover:text-[color:var(--cd-primary)]/80"
                            aria-label={`${companyName || "사업장"} 상세 열기`}
                            title="상세 열기"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
