"use client";

import { useId, useState } from "react";
import { FileText, Upload, X } from "lucide-react";

/**
 * 단일 파일 첨부 영역(2026-11-02 사용자 요청) — 끌어다 놓거나 영역을 클릭해 탐색기에서 고른다.
 * 공문 첨부(components/approval/ApprovalLetterBoard.tsx)의 드롭존 모양을 한 파일용으로 줄인 것으로,
 * 계약서·변경계약서·외주 계약서 PDF 입력이 모두 이 컴포넌트를 쓴다. 파일 자체는 부모가 들고 있고(value),
 * 여기서는 고르기·지우기만 알린다.
 */
export function FileDropZone({
  value,
  onChange,
  accept = "application/pdf,.pdf",
  label = "파일을 끌어다 놓거나 클릭해 선택",
  hint,
  disabled,
  className,
}: {
  value: File | null;
  onChange: (file: File | null) => void;
  /** input accept 와 drop 검사에 함께 쓴다(확장자 또는 MIME, 쉼표 구분). */
  accept?: string;
  label?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}) {
  const inputId = useId();
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const accepts = (file: File): boolean => {
    const tokens = accept.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (tokens.length === 0) return true;
    const name = file.name.toLowerCase();
    const type = (file.type || "").toLowerCase();
    return tokens.some((t) => {
      if (t.startsWith(".")) return name.endsWith(t);
      if (t.endsWith("/*")) return type.startsWith(t.slice(0, -1));
      return type === t;
    });
  };

  const pick = (files: FileList | null | undefined) => {
    const file = files?.[0] ?? null;
    if (!file) return;
    if (!accepts(file)) {
      setRejected(`${file.name} — 허용되지 않는 형식입니다.`);
      return;
    }
    setRejected(null);
    onChange(file);
  };

  return (
    <div className={"grid gap-1.5 " + (className ?? "")}>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragOver(false);
          pick(e.dataTransfer.files);
        }}
        className={
          "rounded-[var(--mcm-action-radius,10px)] border-2 border-dashed px-4 py-5 flex flex-col items-center justify-center gap-1.5 text-center " +
          (disabled ? "opacity-60 cursor-not-allowed " : "cursor-pointer ") +
          (dragOver ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c")
        }
      >
        <Upload className="w-5 h-5 cd-text-faint" />
        <span className="text-[12px] cd-text">{label}</span>
        {hint && <span className="text-[11px] cd-text-faint">{hint}</span>}
        <input
          id={inputId}
          type="file"
          accept={accept}
          disabled={disabled}
          className="hidden"
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {value && (
        <div className="flex items-center gap-2 rounded-[var(--mcm-action-radius,10px)] border cd-border-c px-2.5 py-1.5 text-xs">
          <FileText className="w-3.5 h-3.5 cd-text-primary shrink-0" />
          <span className="truncate cd-text flex-1 min-w-0" title={value.name}>{value.name}</span>
          <span className="cd-text-faint shrink-0 tabular-nums">{formatBytes(value.size)}</span>
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                setRejected(null);
                onChange(null);
              }}
              className="rounded-lg p-0.5 cd-text-faint hover:cd-error-text"
              title="첨부 지우기"
              aria-label="첨부 지우기"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      {rejected && <span className="text-[11px] cd-error-text">{rejected}</span>}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
