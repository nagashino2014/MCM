"use client";

import { cn } from "@/lib/utils";

export interface ReviewRow {
  id: number;
  attachmentId: string;
  ruleId: string;
  fieldLabel: string;
  rawValue: string | null;
  normalizedValue: string | null;
  sourcePage: number | null;
  sourceText: string | null;
  confidence: number;
  reviewedValue: string | null;
  /** 백엔드 ParsedField.error — "값을 찾지 못함" 등 실패 사유. */
  error: string | null;
  facilityName: string | null;
  attachmentFileName: string | null;
}

interface Props {
  rows: ReviewRow[];
  selectedId: number | null;
  onSelect: (row: ReviewRow) => void;
  loading?: boolean;
}

export function ReviewQueueTable({ rows, selectedId, onSelect, loading }: Props) {
  if (loading) {
    return (
      <div className="cd-text-faint text-sm text-center py-10">검수 대기열 로딩 중…</div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="cd-text-faint text-sm text-center py-10">
        검수 대기열이 비어 있습니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="hidden md:grid grid-cols-[1.4fr_1fr_1.2fr_0.6fr_0.6fr] gap-3 px-3 py-2 text-[10px] font-bold uppercase cd-text-faint tracking-wide">
        <div>사업장 / 첨부</div>
        <div>항목</div>
        <div>원본 값</div>
        <div>페이지</div>
        <div>신뢰도</div>
      </div>
      {rows.map((r) => (
        <button
          type="button"
          key={r.id}
          onClick={() => onSelect(r)}
          className={cn(
            "grid grid-cols-[1.4fr_1fr_1.2fr_0.6fr_0.6fr] gap-3 items-center text-left p-3 rounded-xl border transition-colors",
            selectedId === r.id
              ? "cd-tint-primary border-[color:var(--cd-primary)]"
              : "cd-surface-bg hover:bg-[color:var(--cd-surface)] cd-border-c"
          )}
        >
          <div className="min-w-0">
            <div className="text-sm font-bold cd-text truncate">
              {r.facilityName || "(상호 미상)"}
            </div>
            <div className="text-[11px] cd-text-faint truncate">
              {r.attachmentFileName || r.attachmentId}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold cd-text-muted truncate">{r.fieldLabel}</div>
            <div className="text-[10px] cd-text-faint truncate">{r.ruleId}</div>
          </div>
          <div className="min-w-0">
            <div className="text-xs cd-text-muted truncate">
              {r.rawValue || <span className="cd-text-faint">—</span>}
            </div>
            {r.error && (
              <div className="text-[10px] cd-error-text truncate" title={r.error}>
                ⚠ {r.error}
              </div>
            )}
          </div>
          <div className="text-xs cd-text-muted">
            {r.sourcePage != null ? r.sourcePage + "p" : "—"}
          </div>
          <div className="text-xs">
            <span
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold",
                r.confidence >= 0.8
                  ? "cd-tint-primary cd-text-primary"
                  : r.confidence >= 0.5
                  ? "bg-amber-100 text-amber-700"
                  : "cd-error-bg cd-error-text"
              )}
            >
              {Math.round(r.confidence * 100)}%
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
