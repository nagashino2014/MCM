"use client";

import { useEffect, useState } from "react";

/**
 * 금액 입력 — 타이핑 중에도 천단위 구분(1,234,567)이 즉시 표시된다.
 * 네이티브 number 입력은 콤마를 넣을 수 없어(값이 무효화됨) 텍스트 입력 + 포맷 방식으로 구현한다.
 * 값(value)은 항상 콤마 없는 숫자 문자열로만 부모에 전달된다.
 * AutoDateInput 과 같은 계열의 전사 공용 입력 컴포넌트.
 */
export function AmountInput({
  value,
  onChange,
  className,
  placeholder,
  allowNegative = false,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string | number | null | undefined;
  onChange: (next: string) => void;
  /** 음수 허용(조정액 등). 기본 false */
  allowNegative?: boolean;
}) {
  const [text, setText] = useState(() => formatAmount(value));

  // 부모 값이 바뀌면(자동 채움·회차 변경 등) 표시를 동기화한다.
  useEffect(() => {
    setText((prev) => (stripAmount(prev) === stripAmount(value) ? prev : formatAmount(value)));
  }, [value]);

  const commit = (raw: string) => {
    const neg = allowNegative && raw.trim().startsWith("-");
    const digits = raw.replace(/[^\d]/g, "");
    const next = digits ? (neg ? "-" : "") + digits : "";
    setText(next ? withCommas(next) : "");
    onChange(next);
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={className}
      placeholder={placeholder ?? "0"}
      value={text}
      onChange={(e) => commit(e.target.value)}
    />
  );
}

function stripAmount(v: unknown): string {
  if (v == null || v === "") return "";
  return String(v).replace(/[^\d-]/g, "");
}

function withCommas(numeric: string): string {
  const neg = numeric.startsWith("-");
  const digits = neg ? numeric.slice(1) : numeric;
  return (neg ? "-" : "") + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 숫자·문자열 → 천단위 표시 문자열(빈 값은 빈 문자열). */
export function formatAmount(v: unknown): string {
  const s = stripAmount(v);
  return s ? withCommas(s) : "";
}
