"use client";

// 정기 발행본 읽기 — 계획서 §3.3 순서(요약 → 동향 → 우선 검토 프로젝트 → 영업 시사점 → 수집 범위·상태 → 출처).
// 발행본은 수정 동작 없이 읽기만 한다. 출처 번호는 본문 흐름을 끊지 않도록 위첨자 링크로 둔다.

import { Fragment, useState } from "react";
import { Download, Share2 } from "lucide-react";
import { CdButton, useCdashTheme } from "@/components/cdash";
import { filenameFromDisposition } from "@/lib/client-download";
import type { Briefing } from "./intel-shared";
import { INTEL_STAGE_LABELS, humanizeSourceKeys, intelDate, intelSourceLabel } from "./intelligence-client";
import { BriefingShareModal } from "./BriefingShareModal";

const INSIGHT_ORDER = ["우선 검토", "확인 필요", "참고"];

export function ScheduledBriefingReport({ briefing, onOpenSource, canOpenProject = false }: { briefing: Briefing; onOpenSource: (id: string) => void; canOpenProject?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const { theme } = useCdashTheme();
  const report = briefing.report;

  async function download() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/sales/rag/briefings/${encodeURIComponent(briefing.briefingId)}/export`);
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error ?? "PDF를 내려받지 못했습니다."); }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = filenameFromDisposition(response, "정기_영업_브리핑.pdf"); document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  /** "[4]" 표기를 위첨자 출처 링크로 바꾼다. 굵게 표시 기호는 지운다. */
  function text(value: string) {
    return value.split(/(\[\d+\])/g).map((part, index) => {
      const match = part.match(/^\[(\d+)\]$/);
      const source = match ? briefing.sources[Number(match[1]) - 1] : undefined;
      if (!match) return <Fragment key={index}>{part.replace(/\*\*/g, "")}</Fragment>;
      if (!source) return null;
      return (
        <button key={index} type="button" className="intel-cite" aria-label={`출처 ${match[1]} 보기`} title={source.reportName ?? intelSourceLabel(source.source)} onClick={() => onOpenSource(source.signalId)}>
          {match[1]}
        </button>
      );
    });
  }

  const insightGroups = report ? [
    ...INSIGHT_ORDER.map((badge) => ({ badge, items: report.insights.filter((insight) => insight.badge === badge) })),
    { badge: "기타", items: report.insights.filter((insight) => !INSIGHT_ORDER.includes(insight.badge)) },
  ].filter((group) => group.items.length) : [];
  const note = report?.etcNote ? humanizeSourceKeys(report.etcNote) : null;

  return (
    <article className="intel-stack">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <p className="intel-table cd-text-muted">{briefing.model ? `작성 모델 ${briefing.model} · ` : ""}출처 {briefing.sources.length}건 · 원문 대조 검수 후 발행</p>
        <div className="flex gap-2 flex-wrap">
          {briefing.canShare === true && <CdButton size="sm" variant="ghost" onClick={() => setShareOpen(true)}><Share2 className="w-4 h-4" />공유</CdButton>}
          <CdButton size="sm" variant="ghost" disabled={busy} onClick={() => void download()}><Download className="w-4 h-4" />{busy ? "준비 중…" : "PDF"}</CdButton>
        </div>
      </div>
      {error && <p className="intel-error" role="alert">{error}</p>}

      <div className={`intel-report ${briefing.sources.length ? "has-rail" : ""}`}>
        <div className="intel-report-main">
          {report ? <>
            {report.kpis.length > 0 && (
              <div className="intel-stat-strip border rounded-lg cd-border-c">
                {report.kpis.slice(0, 4).map((kpi, index) => (
                  <div className="intel-stat" key={index}><span className="intel-table cd-text-muted">{kpi.label}</span><strong>{kpi.value}</strong>{kpi.sub && <span className="intel-meta">{kpi.sub}</span>}</div>
                ))}
              </div>
            )}

            <section>
              <h4>핵심 동향</h4>
              <ul className="intel-report-list">{report.trends.map((trend, index) => <li key={index}>{text(trend)}</li>)}</ul>
            </section>

            {report.companies.length > 0 && <section>
              <h4>우선 검토 프로젝트 <span className="intel-table cd-text-muted font-normal">{report.companies.length}건</span></h4>
              <div>
                {report.companies.map((company, index) => (
                  <div key={index} className="intel-project">
                    <div className="flex flex-wrap justify-between items-start gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">{company.project ?? company.name}</p>
                        <p className="intel-table cd-text-muted">{[company.name, company.region ?? "지역 미확인", (company.status?.trim() || "unknown") === "unknown" ? "단계 미확인" : INTEL_STAGE_LABELS[company.status!.trim()] ?? company.status].join(" · ")}</p>
                      </div>
                      {canOpenProject && company.projectId && <CdButton size="sm" variant="ghost" onClick={() => onOpenSource(`project:${company.projectId}`)}>프로젝트 상세</CdButton>}
                    </div>
                    <p className="intel-prose mt-2">{text(company.desc)}</p>
                    {company.facts.length > 0 && <dl className="intel-facts">{company.facts.map((fact, i) => <div key={i}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>}
                    {company.note && <p className="intel-compact cd-text-muted mt-3">{text(company.note.text)}</p>}
                  </div>
                ))}
              </div>
            </section>}

            {insightGroups.length > 0 && <section>
              <h4>영업 시사점</h4>
              {insightGroups.map((group) => (
                <div key={group.badge} className="intel-insight-group">
                  <p className="intel-table cd-text-muted font-medium">{group.badge} {group.items.length}건</p>
                  <ul className="intel-report-list">{group.items.map((insight, index) => <li key={index}>{text(insight.text)}</li>)}</ul>
                </div>
              ))}
            </section>}

            {note && <section>
              <h4>수집 범위·상태</h4>
              <p className="intel-notice intel-compact whitespace-pre-line">{note}</p>
            </section>}
          </> : <p className="intel-prose whitespace-pre-wrap">{briefing.answerMd}</p>}
        </div>

        {briefing.sources.length > 0 && (
          <aside className="intel-report-rail" aria-label="출처">
            <h4 className="intel-section mb-2">출처 <span className="intel-table cd-text-muted font-normal">{briefing.sources.length}건</span></h4>
            {briefing.sources.map((source, index) => (
              <button key={`${source.signalId}:${index}`} type="button" className="intel-source" onClick={() => onOpenSource(source.signalId)}>
                <span className="intel-source-no">{index + 1}</span>
                <span className="min-w-0">
                  <span className="intel-row-title intel-compact block">{source.reportName ?? source.companyName ?? "제목 없음"}</span>
                  <span className="intel-row-meta block">{[intelSourceLabel(source.source), source.companyName, source.disclosedAt ? intelDate(source.disclosedAt) : null].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            ))}
          </aside>
        )}
      </div>
      {shareOpen && <BriefingShareModal briefingId={briefing.briefingId} theme={theme} onClose={() => setShareOpen(false)} />}
    </article>
  );
}
