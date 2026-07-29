"use client";

import { useEffect, useState } from "react";
import { Save, X } from "lucide-react";
import type { ReviewRow } from "./ReviewQueueTable";

interface Props {
  row: ReviewRow | null;
  onSave: (id: number, reviewedValue: string) => Promise<void>;
  onClose: () => void;
  canEdit?: boolean;
}

export function ReviewSidePanel({ row, onSave, onClose, canEdit = true }: Props) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(row?.reviewedValue ?? row?.normalizedValue ?? row?.rawValue ?? "");
    setError(null);
  }, [row]);

  if (!row) {
    return (
      <div className="cd-card rounded-3xl p-6 text-center cd-text-faint text-sm">
        좌측 목록에서 검수할 항목을 선택하세요.
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(row.id, value);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cd-card rounded-3xl p-6 flex flex-col gap-4 sticky top-0">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold cd-text-faint uppercase tracking-wide">
            검수 항목
          </div>
          <h3 className="text-base font-bold cd-text mt-1">{row.fieldLabel}</h3>
          <div className="text-[11px] cd-text-faint mt-0.5">
            {row.facilityName || "(상호 미상)"} · {row.attachmentFileName || row.attachmentId}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="cd-btn cd-btn-ghost rounded-xl w-8 h-8 flex items-center justify-center cd-text-faint"
          aria-label="닫기"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex flex-col gap-2 text-xs">
        <DetailRow label="rule_id" value={row.ruleId} />
        <DetailRow label="원본 값" value={row.rawValue || "—"} />
        <DetailRow label="정규화" value={row.normalizedValue || "—"} />
        <DetailRow
          label="신뢰도"
          value={(row.confidence * 100).toFixed(1) + "%"}
        />
        <DetailRow
          label="페이지"
          value={row.sourcePage != null ? row.sourcePage + "p" : "—"}
        />
        {row.error && (
          <div className="flex items-baseline gap-3">
            <span className="text-[10px] font-bold text-red-500 uppercase tracking-wide w-16 shrink-0">
              실패사유
            </span>
            <span className="cd-error-text font-medium break-all">{row.error}</span>
          </div>
        )}
      </div>

      <div className="cd-surface-bg border cd-border-c rounded-xl p-3 max-h-48 overflow-y-auto">
        <div className="text-[10px] font-bold cd-text-faint uppercase mb-1">
          source text
        </div>
        <pre className="text-[11px] cd-text-muted whitespace-pre-wrap font-mono">
          {row.sourceText || "(원본 텍스트 없음)"}
        </pre>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">
          검수 확정 값
        </label>
        <textarea
          className="cd-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="확정할 값을 입력하세요"
        />
        {error && (
          <div className="text-xs font-bold cd-error-text cd-error-bg border cd-error-border rounded-xl px-3 py-2">
            {error}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t cd-border-c">
        <button
          type="button"
          onClick={onClose}
          className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted"
        >
          취소
        </button>
          <button
          type="button"
          disabled={saving || !value.trim() || !canEdit}
          onClick={handleSave}
          title={!canEdit ? "조회자 권한은 검수 값을 확정할 수 없습니다." : undefined}
          className="rounded-xl px-3 py-2 text-xs font-bold text-white cd-fill-primary shadow-sm flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? "저장 중…" : "확정"}
        </button>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] font-bold cd-text-faint uppercase tracking-wide w-16 shrink-0">
        {label}
      </span>
      <span className="cd-text-muted break-all">{value}</span>
    </div>
  );
}
