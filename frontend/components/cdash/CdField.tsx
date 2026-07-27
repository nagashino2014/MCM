"use client";

// cdash 공통 폼 필드 — cdash.css .cd-label/.cd-input/.cd-select/.cd-textarea 래핑(G0).
// 라벨 + 컨트롤 + 오류/힌트를 한 덩어리로. cd-fields-white 스코프에서 흰 배경(기존 규칙).

import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface FieldShellProps {
  label?: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
  /** 라벨 우측 부가 요소(예: "+ 참조 추가" 링크). */
  labelExtra?: ReactNode;
}

function FieldShell({ label, required, hint, error, className, children, labelExtra }: FieldShellProps) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      {label != null && (
        <span className="cd-label flex items-center justify-between">
          <span>
            {label}
            {required && <span className="cd-error-text ml-0.5">*</span>}
          </span>
          {labelExtra}
        </span>
      )}
      {children}
      {error ? (
        <span className="text-xs cd-error-text">{error}</span>
      ) : hint ? (
        <span className="text-xs cd-text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

type ShellProps = Pick<FieldShellProps, "label" | "required" | "hint" | "error" | "labelExtra"> & { className?: string };

export interface CdInputProps extends InputHTMLAttributes<HTMLInputElement>, ShellProps {}

export const CdInput = forwardRef<HTMLInputElement, CdInputProps>(function CdInput(
  { label, required, hint, error, labelExtra, className, ...rest },
  ref
) {
  return (
    <FieldShell label={label} required={required} hint={hint} error={error} labelExtra={labelExtra} className={className}>
      <input ref={ref} className={cn("cd-input", error && "border-[color:var(--cd-error)]")} {...rest} />
    </FieldShell>
  );
});

export interface CdSelectProps extends SelectHTMLAttributes<HTMLSelectElement>, ShellProps {}

export const CdSelect = forwardRef<HTMLSelectElement, CdSelectProps>(function CdSelect(
  { label, required, hint, error, labelExtra, className, children, ...rest },
  ref
) {
  return (
    <FieldShell label={label} required={required} hint={hint} error={error} labelExtra={labelExtra} className={className}>
      <select ref={ref} className={cn("cd-select", error && "border-[color:var(--cd-error)]")} {...rest}>
        {children}
      </select>
    </FieldShell>
  );
});

export interface CdTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, ShellProps {}

export const CdTextarea = forwardRef<HTMLTextAreaElement, CdTextareaProps>(function CdTextarea(
  { label, required, hint, error, labelExtra, className, ...rest },
  ref
) {
  return (
    <FieldShell label={label} required={required} hint={hint} error={error} labelExtra={labelExtra} className={className}>
      <textarea ref={ref} className={cn("cd-textarea", error && "border-[color:var(--cd-error)]")} {...rest} />
    </FieldShell>
  );
});

export interface CdCheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
}

export const CdCheckbox = forwardRef<HTMLInputElement, CdCheckboxProps>(function CdCheckbox(
  { label, className, ...rest },
  ref
) {
  return (
    <label className={cn("inline-flex items-center gap-2 cursor-pointer select-none", className)}>
      <input ref={ref} type="checkbox" className="w-4 h-4 accent-[var(--cd-primary)] cursor-pointer" {...rest} />
      {label != null && <span className="text-sm cd-text">{label}</span>}
    </label>
  );
});
