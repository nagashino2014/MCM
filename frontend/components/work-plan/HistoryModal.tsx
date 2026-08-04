"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Download, History, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProgressHistoryRow } from "@/lib/work-plan/workspace";

const ISSUE_KIND_LABELS: Record<string, string> = {
  permit_condition: "허가조건 강화",
  contact_change: "발주처/허가기관 담당자 변경",
  accident: "사업장 사고 발생",
  doc_missing: "중요 서류 누락",
  schedule_delay: "일정 지연",
  other: "기타",
};

const SEVERITY: Record<string, { label: string; bg: string; fg: string }> = {
  info: { label: "정보", bg: "#E6F1FB", fg: "#0C447C" },
  warn: { label: "주의", bg: "#FAEEDA", fg: "#633806" },
  critical: { label: "심각", bg: "#FCEBEB", fg: "#791F1F" },
};

interface IssueHistoryRow {
  issueId: string;
  issueKind: string;
  description: string | null;
  occurredOn: string | null;
  severity: string;
  responsePlan: string | null;
  status: string;
  createdAt: string;
  attachments?: { attachmentId: string; fileName: string; publicPath: string | null }[];
}

export type HistoryTab = "progress" | "issues";

/**
 * 지난 내역 보기 모달 — 한 용역/Task의 전 회차 추진 내역(1회차~현재)과 이슈 이력.
 * 보고 작성·부서장 감독·임원 검토 어디서든 ReportEditor 를 통해 열린다.
 */
export default function HistoryModal({
  subjectKind,
  subjectId,
  initialTab,
  theme,
  onClose,
}: {
  subjectKind: "contract" | "task";
  subjectId: string;
  initialTab: HistoryTab;
  theme: "light" | "dark";
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<HistoryTab>(initialTab);
  const [entries, setEntries] = useState<ProgressHistoryRow[] | null>(null);
  const [issues, setIssues] = useState<IssueHistoryRow[] | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch(`/api/work-plan/history?kind=${subjectKind}&id=${encodeURIComponent(subjectId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setEntries(d.entries ?? []))
      .catch(() => setEntries([]));
    const issuesUrl = subjectKind === "task" ? `/api/work-tasks/${subjectId}/issues` : `/api/contracts/${subjectId}/issues`;
    fetch(issuesUrl, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setIssues(d.issues ?? []))
      .catch(() => setIssues([]));
  }, [subjectKind, subjectId]);

  if (!mounted) return null;

  return createPortal(
    <div className="cdash-vars cd-fields-white fixed inset-0 z-[95] flex items-center justify-center p-4" data-theme={theme}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative cd-solid-bg border cd-border-c rounded-3xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b cd-border-c">
          <h2 className="text-lg font-bold cd-text flex items-center gap-2">
            <History className="w-4 h-4 cd-text-primary" /> 지난 내역
          </h2>
          <div className="inline-flex rounded-xl border cd-border-c overflow-hidden text-xs font-semibold">
            {([
              { value: "progress", label: "추진 내역" },
              { value: "issues", label: "이슈 상황" },
            ] as { value: HistoryTab; label: string }[]).map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={cn("px-3 py-1.5 border-l first:border-l-0 cd-border-c", tab === t.value ? "cd-fill-primary text-white" : "cd-text-muted")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg cd-text-faint hover:cd-text" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
          {tab === "progress" ? (
            entries === null ? (
              <p className="p-8 text-center text-xs cd-text-faint">불러오는 중…</p>
            ) : entries.length === 0 ? (
              <p className="p-8 text-center text-xs cd-text-faint">작성된 추진 내역이 없습니다.</p>
            ) : (
              entries.map((e) => (
                <div key={e.reportId} className="rounded-2xl border cd-border-c p-3.5">
                  <div className="flex flex-wrap items-center gap-2 mb-2.5">
                    <span className="text-[11px] font-semibold cd-text-primary cd-tint-primary rounded-lg px-2 py-0.5">
                      {e.meetingLabel || "보고"} {e.meetingSeq ?? "-"}회차
                    </span>
                    <span className="text-[11px] cd-text-faint">{e.periodStart} ~ {e.periodEnd}</span>
                    {e.reportDate && <span className="text-[11px] cd-text-faint">회의 {e.reportDate}</span>}
                    {e.authorName && <span className="text-[11px] cd-text-faint ml-auto">{e.authorName}</span>}
                    {e.status !== "submitted" && <span className="text-[10px] cd-text-faint">(임시저장)</span>}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] font-semibold cd-text-faint mb-1">이번 기간</p>
                      <p className="text-xs cd-text leading-relaxed whitespace-pre-wrap">{e.progressText || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold cd-text-faint mb-1">다음 기간</p>
                      <p className="text-xs cd-text leading-relaxed whitespace-pre-wrap">{e.planText || "—"}</p>
                    </div>
                  </div>
                </div>
              ))
            )
          ) : issues === null ? (
            <p className="p-8 text-center text-xs cd-text-faint">불러오는 중…</p>
          ) : issues.length === 0 ? (
            <p className="p-8 text-center text-xs cd-text-faint">보고된 이슈가 없습니다.</p>
          ) : (
            issues.map((iss) => {
              const sev = SEVERITY[iss.severity] ?? SEVERITY.warn;
              return (
                <div key={iss.issueId} className="rounded-2xl border cd-border-c p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold inline-flex items-center gap-1" style={{ background: sev.bg, color: sev.fg }}>
                      <AlertTriangle className="w-3 h-3" /> {ISSUE_KIND_LABELS[iss.issueKind] ?? "기타"} · {sev.label}
                    </span>
                    {iss.occurredOn && <span className="text-[11px] cd-text-faint">발생 {iss.occurredOn}</span>}
                    <span className={cn("text-[10px] font-semibold ml-auto", iss.status === "resolved" ? "cd-text-primary" : "cd-error-text")}>
                      {iss.status === "resolved" ? "해결" : "미해결"}
                    </span>
                  </div>
                  {iss.description && <p className="text-xs cd-text mt-2 leading-relaxed whitespace-pre-wrap">{iss.description}</p>}
                  {(iss.attachments ?? []).length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {(iss.attachments ?? []).map((a) => (
                        <a
                          key={a.attachmentId}
                          href={a.publicPath ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] rounded-md border cd-border-c px-1.5 py-0.5 cd-text-primary hover:underline"
                        >
                          <Paperclip className="w-3 h-3 cd-text-faint" /> {a.fileName} <Download className="w-2.5 h-2.5" />
                        </a>
                      ))}
                    </div>
                  )}
                  {iss.responsePlan && (
                    <p className="text-[11px] mt-2 pt-2 border-t cd-border-c cd-text-muted">
                      <span className="cd-text-primary font-semibold">대응방안</span> · {iss.responsePlan}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
