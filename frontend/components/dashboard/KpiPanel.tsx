"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Factory,
  Database,
  FileText,
  Sparkles,
  AlertTriangle,
  RefreshCw,
  Bot,
} from "lucide-react";
import { KpiCard } from "./KpiCard";

interface KpiData {
  totalFacilities: number;
  recentFacilities24h: number;
  downloadedPdfs: number;
  parsedDocs: number;
  needsReview: number;
  playwrightFallbacks?: number;
  failedDownloads?: number;
}

export function KpiPanel({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<KpiData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/kpi", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as KpiData;
      setData(json);
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
    <div className="cd-card p-6 rounded-3xl flex flex-col gap-4 cd-reveal delay-1">
      <div className="flex items-center justify-between">
        <h3 className="font-bold cd-text-muted flex items-center gap-2">
          <Database className="w-5 h-5 cd-text-primary" />
          IEPS 수집 파이프라인
        </h3>
        <button
          type="button"
          onClick={reload}
          className="cd-btn cd-btn-ghost rounded-xl px-3 py-1.5 text-xs font-bold cd-text-muted flex items-center gap-1"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          새로고침
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <KpiCard
            label="누적 수집 사업장"
            value={loading ? "—" : (data?.totalFacilities ?? 0).toLocaleString()}
            hint="IEPS 정보공개 기준 누적"
            icon={Factory}
            emphasis
          />
        </div>
        <KpiCard
          label="24h 신규"
          value={loading ? "—" : (data?.recentFacilities24h ?? 0).toLocaleString()}
          icon={Sparkles}
        />
        <KpiCard
          label="다운로드 PDF"
          value={loading ? "—" : (data?.downloadedPdfs ?? 0).toLocaleString()}
          hint={
            data?.failedDownloads && data.failedDownloads > 0
              ? `실패 ${data.failedDownloads.toLocaleString()}건`
              : undefined
          }
          icon={FileText}
        />
        <KpiCard
          label="파싱 완료"
          value={loading ? "—" : (data?.parsedDocs ?? 0).toLocaleString()}
          icon={Database}
        />
        <KpiCard
          label="검수 대기"
          value={loading ? "—" : (data?.needsReview ?? 0).toLocaleString()}
          icon={AlertTriangle}
        />
        <KpiCard
          label="Playwright 폴백"
          value={loading ? "—" : (data?.playwrightFallbacks ?? 0).toLocaleString()}
          hint="HTTP 실패 시 자동 재시도"
          icon={Bot}
        />
      </div>

      {error && (
        <div className="text-[11px] cd-error-text font-bold">KPI 로딩 실패: {error}</div>
      )}
    </div>
  );
}
