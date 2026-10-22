"use client";

// 현행 카탈로그(2026.06판) 수치 대조 — 자동 집계(지표 사전)와 나란히 보여 차이를 정의 결정으로 정리한다(블루프린트 §13).

import { Scale } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import type { InitialPermitDetail, MetricValue } from "@/lib/catalog/metrics";
import { REFERENCE_2026_06, REFERENCE_EDITION_LABEL } from "@/lib/catalog/reference-2026-06";

export function CatalogReferencePanel({ metrics, initialPermit }: { metrics: MetricValue[]; initialPermit: InitialPermitDetail }) {
  const byId = new Map(metrics.map((m) => [m.id, m]));
  const rows = REFERENCE_2026_06.map((r) => {
    const m = r.metric ? byId.get(r.metric) : undefined;
    const current = r.cohort ? initialPermit.byCohort.find((c) => c.id === r.cohort)?.sites ?? null : m?.value ?? null;
    const unit = r.cohort ? "건" : m?.unit ?? "";
    const diff = current != null && r.number != null ? Math.round((current - r.number) * 10) / 10 : null;
    return { ...r, current, unit, diff };
  });
  return (
    <section className="cd-card p-4 mb-3">
      <h3 className="cd-text font-semibold text-base flex items-center gap-1 mb-1">
        <Scale className="w-4 h-4 cd-text-primary" /> 현행 카탈로그 대조 <CdHelp topic="catalog.reference" />
      </h3>
      <p className="text-xs cd-text-faint mb-3">{REFERENCE_EDITION_LABEL} 수치와 지금 자동 집계 값을 나란히 봅니다. 차이가 나면 계약·인사 데이터나 정의를 확인합니다.</p>
      <div className="overflow-x-auto">
        <table className="cd-table">
          <thead>
            <tr>
              <th>항목</th>
              <th>현행 카탈로그</th>
              <th className="text-right">자동 집계</th>
              <th className="text-right">차이</th>
              <th>참고</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="cd-text font-semibold whitespace-nowrap">{r.label}</td>
                <td className="cd-text-muted">
                  {r.value}
                  <span className="block text-[11px] cd-text-faint">{r.page}</span>
                </td>
                <td className="text-right tabular-nums whitespace-nowrap">
                  {r.current == null ? (
                    <span className="cd-text-faint text-xs">—</span>
                  ) : (
                    <>
                      <span className="cd-text font-bold">{r.current.toLocaleString("ko-KR")}</span>
                      <span className="cd-text-faint text-xs ml-0.5">{r.unit}</span>
                    </>
                  )}
                </td>
                <td className="text-right tabular-nums whitespace-nowrap">
                  {r.diff == null ? (
                    <span className="cd-text-faint text-xs">—</span>
                  ) : r.diff === 0 ? (
                    <span className="cd-pill cd-pill-success">일치</span>
                  ) : (
                    <span className="cd-pill cd-pill-warn">{r.diff > 0 ? `+${r.diff.toLocaleString("ko-KR")}` : r.diff.toLocaleString("ko-KR")}</span>
                  )}
                </td>
                <td className="cd-text-muted text-xs">{r.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
