"use client";

import { useEffect, useMemo, useRef } from "react";
import { X, Activity, Download, ScanText, Database, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProgressEvent =
  | { event: "scrape"; phase?: string; page?: number; articles?: number; total?: number; current?: number }
  | {
      event: "download";
      phase?: string;
      fileName?: string;
      bytes?: number | null;
      method?: "http" | "playwright" | "skipped" | "cache";
      attempts?: number;
      status?: "ok" | "failed";
      reason?: string | null;
      httpSucceeded?: number;
      playwrightSucceeded?: number;
      failed?: number;
      current?: number;
      total?: number;
    }
  | { event: "parse"; postId?: string; status?: string; current?: number; total?: number }
  | { event: "upsert"; facility?: string; permitId?: string; current?: number; total?: number }
  | { event: "log"; level?: "info" | "warn" | "error"; message: string }
  | { event: "done"; summaryPath?: string }
  | { event: "error"; message: string };

interface Props {
  open: boolean;
  onClose: () => void;
  events: ProgressEvent[];
  status: "idle" | "running" | "done" | "error";
  errorMessage?: string;
  onCancel?: () => void;
  /**
   * 잡 종류에 따라 패널 제목/단계 표시를 다르게 하기 위한 컨텍스트.
   *  - "collect" : 스크래핑 + PDF 다운로드 (4단계 중 scrape/download 만 활성)
   *  - "parse"   : raw/ 카테고리별 파싱 + 적재 (parse/upsert 만 활성)
   * 미지정 시 옛 동작(전체 단계 표시) 유지.
   */
  jobKind?: "collect" | "parse";
  /** 헤더 보조 라벨 — 예: "통합허가 파싱", "수집(다운로드)". */
  jobTitle?: string;
}

interface PhaseInfo {
  id: "scrape" | "download" | "parse" | "upsert";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

// 옛 단계 "최초허가 필터" 는 게시판 카테고리(gubunList) 사전 필터로 대체돼 더 이상 사용하지 않는다.
const ALL_PHASES: PhaseInfo[] = [
  { id: "scrape", label: "목록 수집", icon: Activity },
  { id: "download", label: "PDF 다운로드", icon: Download },
  { id: "parse", label: "OCR 추출", icon: ScanText },
  { id: "upsert", label: "사업장 적재", icon: Database },
];

const COLLECT_PHASES: PhaseInfo[] = ALL_PHASES.filter((p) => p.id === "scrape" || p.id === "download");
const PARSE_PHASES: PhaseInfo[] = ALL_PHASES.filter((p) => p.id === "parse" || p.id === "upsert");

export function ProgressDrawer({ open, onClose, events, status, errorMessage, onCancel, jobKind, jobTitle }: Props) {
  const logRef = useRef<HTMLDivElement>(null);

  const phases = useMemo(() => {
    if (jobKind === "collect") return COLLECT_PHASES;
    if (jobKind === "parse") return PARSE_PHASES;
    return ALL_PHASES;
  }, [jobKind]);

  const phaseStats = useMemo(() => {
    const stats = new Map<string, { current: number; total: number; latest: string }>();
    for (const evt of events) {
      const key = (evt as { event: string }).event;
      if (key === "log" || key === "done" || key === "error") continue;
      const entry = stats.get(key) ?? { current: 0, total: 0, latest: "" };
      const e = evt as Record<string, unknown>;
      if (typeof e.current === "number") entry.current = e.current as number;
      if (typeof e.total === "number") entry.total = e.total as number;
      if (key === "scrape" && typeof e.page === "number") {
        entry.latest = "page " + e.page + " · " + (e.articles ?? "?") + "건";
      } else if (key === "download") {
        if (typeof e.fileName === "string" && e.fileName) {
          const method = typeof e.method === "string" ? e.method.toUpperCase() : "";
          const attempts = typeof e.attempts === "number" ? e.attempts : 0;
          const statusTag = e.status === "failed" ? " · 실패" : "";
          const retryTag = attempts > 1 ? " · ↻" + attempts : "";
          entry.latest = (method ? "[" + method + "] " : "") + String(e.fileName) + retryTag + statusTag;
        }
      } else if (key === "parse" && typeof e.postId === "string") {
        entry.latest = e.postId + " " + (e.status ?? "");
      } else if (key === "upsert" && typeof e.facility === "string") {
        entry.latest = String(e.facility);
      }
      stats.set(key, entry);
    }
    return stats;
  }, [events]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  if (!open) return null;

  return (
    <>
      {/* 진행 중에는 오버레이 클릭으로 실수 닫힘 방지 — 닫을 땐 X/닫기 버튼 또는 중단 버튼으로 */}
      <div
        className="drawer-overlay"
        onClick={status === "running" ? undefined : onClose}
      />
      <aside className="drawer">
        <header className="px-6 py-5 border-b cd-border-c flex items-center justify-between">
          <div>
            <div className="text-xs font-bold cd-text-faint uppercase tracking-wide">
              수집 진행 상황
            </div>
            <h3 className="text-base font-bold cd-text mt-1 flex items-center gap-2">
              {status === "running" && (
                <span className="status-pill status-pill--running">진행 중</span>
              )}
              {status === "done" && (
                <span className="status-pill status-pill--success">
                  <CheckCircle2 className="w-3 h-3" /> 완료
                </span>
              )}
              {status === "error" && (
                <span className="status-pill status-pill--error">
                  <AlertTriangle className="w-3 h-3" /> 오류
                </span>
              )}
              {status === "idle" && (
                <span className="status-pill status-pill--idle">대기</span>
              )}
              {jobTitle ?? "IEPS 통합허가 수집"}
            </h3>
          </div>
          <button
            type="button"
            className="cd-btn cd-btn-ghost rounded-xl w-9 h-9 flex items-center justify-center cd-text-muted"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="px-6 py-4 flex flex-col gap-3 border-b cd-border-c">
          {phases.map((p) => {
            const stats = phaseStats.get(p.id);
            const total = stats?.total ?? 0;
            const current = stats?.current ?? 0;
            const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
            const PhaseIcon = p.icon;
            const active = !!stats;
            return (
              <div key={p.id} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <PhaseIcon
                    className={cn(
                      "w-4 h-4",
                      active ? "cd-text-primary" : "cd-text-faint"
                    )}
                  />
                  <div className="text-xs font-bold cd-text-muted">{p.label}</div>
                  <div className="text-[11px] cd-text-faint font-medium ml-auto">
                    {total > 0 ? current + " / " + total : current > 0 ? current : "—"}
                  </div>
                </div>
                <div className="progress-track">
                  <div className="progress-bar" style={{ width: pct + "%" }} />
                </div>
                {stats?.latest && (
                  <div className="text-[10px] cd-text-faint truncate">{stats.latest}</div>
                )}
              </div>
            );
          })}
        </div>

        <div ref={logRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-1.5 text-[11px] font-mono">
          {events.map((evt, i) => {
            const e = evt as { event: string } & Record<string, unknown>;
            const isError =
              e.event === "error" ||
              (e.event === "log" && e.level === "error") ||
              (e.event === "download" && e.status === "failed");
            const isWarn = e.event === "log" && e.level === "warn";
            const downloadMethod =
              e.event === "download" && typeof e.method === "string" ? (e.method as string) : null;
            const attempts =
              e.event === "download" && typeof e.attempts === "number" ? (e.attempts as number) : 0;
            return (
              <div
                key={i}
                className={cn(
                  "leading-snug",
                  isError ? "cd-error-text" : isWarn ? "text-amber-600" : "cd-text-muted"
                )}
              >
                <span className="cd-text-faint">[{e.event}]</span>{" "}
                {downloadMethod && (
                  <span className={cn("method-badge", "method-" + downloadMethod)}>{downloadMethod.toUpperCase()}</span>
                )}
                {attempts > 1 && (
                  <span className="method-badge method-retry" title={"재시도 " + attempts + "회"}>
                    ↻{attempts}
                  </span>
                )}
                {formatEvent(evt)}
              </div>
            );
          })}
          {events.length === 0 && (
            <div className="cd-text-faint italic">수집을 시작하면 진행 로그가 표시됩니다.</div>
          )}
          {errorMessage && (
            <div className="cd-error-text font-bold">[error] {errorMessage}</div>
          )}
        </div>

        <footer className="px-6 py-4 border-t cd-border-c flex items-center gap-2">
          {status === "running" && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted"
            >
              중단
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3 py-2 text-xs font-bold text-white cd-fill-primary ml-auto"
          >
            닫기
          </button>
        </footer>
      </aside>
    </>
  );
}

function formatEvent(evt: ProgressEvent): string {
  switch (evt.event) {
    case "scrape":
      if (evt.phase === "start") return "목록 수집 시작 (" + (evt.total ?? 0) + " 페이지)";
      if (typeof evt.page === "number") return "페이지 " + evt.page + " — " + (evt.articles ?? 0) + "건";
      return JSON.stringify(evt);
    case "download":
      if (evt.phase === "start") return "다운로드 시작 (" + (evt.total ?? 0) + "건)";
      if (evt.phase === "done") {
        const summary = [
          "HTTP " + (evt.httpSucceeded ?? 0),
          "Playwright " + (evt.playwrightSucceeded ?? 0),
          "실패 " + (evt.failed ?? 0),
        ].join(" · ");
        return "다운로드 완료 — " + summary;
      }
      if (evt.status === "failed") {
        return (
          (evt.fileName ?? "?") +
          (evt.reason ? " — " + evt.reason : " — 실패") +
          (evt.attempts && evt.attempts > 1 ? " (시도 " + evt.attempts + "회)" : "")
        );
      }
      return (
        (evt.fileName ?? "?") +
        (typeof evt.bytes === "number" && evt.bytes
          ? " (" + (evt.bytes / 1024).toFixed(1) + " KB)"
          : "")
      );
    case "parse":
      return "post " + (evt.postId ?? "?") + " — " + (evt.status ?? "");
    case "upsert":
      return (evt.facility ?? "?") + (evt.permitId ? " (" + evt.permitId + ")" : "");
    case "log":
      return evt.message;
    case "done":
      return "완료. summary: " + (evt.summaryPath ?? "");
    case "error":
      return evt.message;
    default:
      return JSON.stringify(evt);
  }
}
