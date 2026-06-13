"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { X, ExternalLink, Wind, Droplets, Briefcase, Building2 } from "lucide-react";
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
import { FACILITY_COMPANY_SIZE_LABELS, FACILITY_SERVICE_LABELS, type FacilityCompanySize, type FacilityServiceCategory } from "@/lib/ieps/facility-service";

/**
 * 라운드 2B (revised) — 시군구 클릭 시 지도 위에 떠 오르는 인라인 팝오버.
 *  - 4종 파이 차트:
 *      (1) 대기 종 규모  (실측 — permit_scales.air_class)
 *      (2) 수질 종 규모  (실측 — permit_scales.water_class)
 *      (3) 대상 용역 분류별 비율 (CONCEPT — 통합허가/화관법/HAPs/ESG)
 *      (4) 사업장 분류별 비율    (국가기관/지자체/공기업/대기업/중견기업/중소기업)
 *  - 사업장 30건 리스트 — `/facilities?focus=<id>` 진입 링크
 *  - 위치: 부모 컨테이너 기준 절대 좌표(x, y) — 부모(RegionMap)가 클램핑 처리
 */

interface RegionStatsFacility {
  facilityId: string;
  companyName: string;
  industryName: string | null;
  serviceCategories: FacilityServiceCategory[];
  companySize: FacilityCompanySize | null;
  airClass: number | null;
  waterClass: number | null;
  permitDate: string | null;
}
interface RegionStats {
  scope: { sido: string | null; sigungu: string | null };
  total: number;
  airClass: { class: number; count: number }[];
  waterClass: { class: number; count: number }[];
  serviceCategories: { category: FacilityServiceCategory; label: string; count: number }[];
  companySizes: { size: FacilityCompanySize | "unknown"; label: string; count: number }[];
  facilities: RegionStatsFacility[];
}

interface Props {
  /** 부모 컨테이너 기준 절대 좌표 left */
  x: number;
  /** 부모 컨테이너 기준 절대 좌표 top */
  y: number;
  /** DB region_sido 정확값 (예: "경기도"). null 이면 시도 미상 영역. */
  sidoFull: string | null;
  /** 표시용 시도 약식 (breadcrumb 동일) */
  sidoShort: string | null;
  /** DB region_sigungu (예: "수원시") */
  sigungu: string | null;
  onClose: () => void;
}

export function RegionDrillPopover({ x, y, sidoFull, sidoShort, sigungu, onClose }: Props) {
  const [data, setData] = useState<RegionStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sigungu) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    (async () => {
      try {
        const params = new URLSearchParams();
        if (sidoFull) params.set("sido", sidoFull);
        if (sigungu) params.set("sigungu", sigungu);
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
  }, [sidoFull, sigungu]);

  // ESC 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const title = `${sidoShort ?? "—"} · ${sigungu ?? "—"}`;

  // 시드 — 동일 sigungu 입력 시 동일한 CONCEPT 더미 분포가 나오도록.
  const seed = useMemo(() => {
    const s = `${sidoShort ?? ""}|${sigungu ?? ""}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h || 1;
  }, [sidoShort, sigungu]);

  return (
    <div
      className="region-popover cd-card rounded-2xl flex flex-col"
      style={{ position: "absolute", left: x, top: y, width: 520, maxHeight: 580 }}
      role="dialog"
      aria-label={`${title} 분포`}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <header className="flex items-center justify-between px-4 py-3 border-b cd-border-c">
        <div className="min-w-0">
          <h3 className="text-sm font-bold cd-text truncate">{title}</h3>
          <p className="text-[10px] cd-text-faint mt-0.5 truncate">
            해당 시군구 사업장 분포 — 대기/수질/용역/분류 실측
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="cd-btn cd-btn-ghost rounded-xl px-2 py-1.5 cd-text-muted shrink-0 ml-2"
          aria-label="닫기"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-hide px-4 py-3">
        {loading && (
          <div className="text-center text-xs cd-text-faint py-8">불러오는 중…</div>
        )}
        {error && (
          <div className="text-center text-xs cd-error-text py-8">데이터 로딩 실패: {error}</div>
        )}

        {data && !loading && (
          <>
            <div className="mb-3 text-[11px] cd-text-muted">
              <span className="font-bold cd-text">총 {data.total.toLocaleString()}개</span>{" "}
              사업장 (실측)
            </div>

            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <PieCard
                title="대기 종 규모"
                icon={<Wind className="w-3.5 h-3.5" style={{ color: "#5B9BD5" }} />}
                slices={bucketsToSlices(data.airClass, "종")}
                kind="real"
                palette={AIR_PALETTE}
              />
              <PieCard
                title="수질 종 규모"
                icon={<Droplets className="w-3.5 h-3.5" style={{ color: "#70AD47" }} />}
                slices={bucketsToSlices(data.waterClass, "종")}
                kind="real"
                palette={WATER_PALETTE}
              />
              <PieCard
                title="대상 용역 분류"
                icon={<Briefcase className="w-3.5 h-3.5 cd-text-faint" />}
                slices={
                  data.serviceCategories?.some((item) => item.count > 0)
                    ? data.serviceCategories.map((item) => ({ label: item.label, count: item.count }))
                    : dummyServiceMix(data.total, seed)
                }
                kind={data.serviceCategories?.some((item) => item.count > 0) ? "real" : "concept"}
                palette={SERVICE_PALETTE}
                conceptNote="용역 카테고리 입력 전 임시 분포"
              />
              <PieCard
                title="사업장 분류"
                icon={<Building2 className="w-3.5 h-3.5 cd-text-faint" />}
                slices={
                  data.companySizes?.some((item) => item.count > 0 && item.size !== "unknown")
                    ? data.companySizes.map((item) => ({ label: item.label, count: item.count }))
                    : dummySizeMix(data.total, seed)
                }
                kind={data.companySizes?.some((item) => item.count > 0 && item.size !== "unknown") ? "real" : "concept"}
                palette={SIZE_PALETTE}
                conceptNote="사업장 분류 입력 전 임시 분포"
              />
            </section>

            <section className="mt-4">
              <h4 className="text-[11px] font-bold cd-text-muted mb-2">
                사업장 (최신 {data.facilities.length}건 / 총 {data.total.toLocaleString()})
              </h4>
              <div className="rounded-xl border cd-border-c cd-surface-bg overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-[9px] cd-text-faint uppercase tracking-wider cd-surface-bg">
                      <th className="px-2 py-1.5">상호</th>
                      <th className="px-2 py-1.5">업종</th>
                      <th className="px-2 py-1.5">용역/분류</th>
                      <th className="px-2 py-1.5 text-center">대기</th>
                      <th className="px-2 py-1.5 text-center">수질</th>
                      <th className="px-2 py-1.5">허가일자</th>
                      <th className="px-2 py-1.5 w-[1%]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.facilities.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-2 py-4 text-center cd-text-faint">
                          사업장 데이터가 없습니다.
                        </td>
                      </tr>
                    )}
                    {data.facilities.map((f) => {
                      const companyName = formatCompanyName(f.companyName) ?? f.companyName;
                      return (
                      <tr
                        key={f.facilityId}
                        className="border-t cd-border-c hover:bg-[color:var(--cd-surface)] transition"
                      >
                        <td className="px-2 py-1.5 font-bold cd-text truncate max-w-[160px]">
                          {companyName || "(이름 없음)"}
                        </td>
                        <td className="px-2 py-1.5 cd-text-muted truncate max-w-[140px]">
                          {f.industryName ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 cd-text-muted">
                          <div className="flex flex-wrap gap-1 max-w-[150px]">
                            {(f.serviceCategories.length ? f.serviceCategories : (["integrated"] as FacilityServiceCategory[])).map((category) => (
                              <span key={category} className="rounded cd-surface-bg px-1.5 py-0.5 text-[9px] font-bold">
                                {FACILITY_SERVICE_LABELS[category]}
                              </span>
                            ))}
                            {f.companySize && (
                              <span className="rounded cd-surface-bg px-1.5 py-0.5 text-[9px] font-bold">
                                {FACILITY_COMPANY_SIZE_LABELS[f.companySize]}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-center cd-text-muted">
                          {f.airClass != null ? `${f.airClass}종` : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center cd-text-muted">
                          {f.waterClass != null ? `${f.waterClass}종` : "—"}
                        </td>
                        <td className="px-2 py-1.5 cd-text-faint">
                          {f.permitDate ?? "—"}
                        </td>
                        <td className="px-2 py-1.5">
                          <Link
                            href={`/facilities?focus=${encodeURIComponent(f.facilityId)}`}
                            className="inline-flex items-center justify-center cd-text-primary hover:text-[color:var(--cd-primary)]/80 transition-colors"
                            onClick={onClose}
                            aria-label={`${companyName || "사업장"} 상세 열기`}
                            title="상세 열기"
                          >
                            <ExternalLink className="w-4 h-4" />
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
    </div>
  );
}

