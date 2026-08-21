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

/**
 * 날짜 문자열을 **YYYYMMDD 로 이어 치면** YYYY-MM-DD 로 맞춰 준다.
 * 입력 도중의 부분 값(2026 / 2026-07)도 그대로 돌려주므로 타이핑을 막지 않는다.
 */
export function formatDateDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/** 실제로 존재하는 날짜인지 — 2026-02-30 같은 값을 거른다 */
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export interface CdDateInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">,
    ShellProps {
  /** YYYY-MM-DD (입력 도중에는 부분 값이 들어온다) */
  value: string;
  onChange: (value: string) => void;
}

/**
 * MCM 표준 날짜 입력. **네이티브 `type="date"` 를 쓰지 않는다** —
 * 칸을 옮겨 가며 채우는 방식이 손이 많이 가고 붙여넣기도 불편해서다.
 * 숫자 8자리를 이어 치면 구분선이 자동으로 붙는다(20260701 → 2026-07-01).
 */
export const CdDateInput = forwardRef<HTMLInputElement, CdDateInputProps>(function CdDateInput(
  { label, required, hint, error, labelExtra, className, value, onChange, ...rest },
  ref
) {
  const malformed = value.length === 10 && !isValidDateString(value);

  return (
    <FieldShell
      label={label}
      required={required}
      hint={hint}
      error={error ?? (malformed ? "없는 날짜입니다" : undefined)}
      labelExtra={labelExtra}
      className={className}
    >
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="YYYYMMDD"
        maxLength={10}
        value={value}
        onChange={(e) => onChange(formatDateDigits(e.target.value))}
        className={cn("cd-input", (error || malformed) && "border-[color:var(--cd-error)]")}
        {...rest}
      />
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
