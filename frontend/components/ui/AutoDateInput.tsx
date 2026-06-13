"use client";

import { useEffect, useState } from "react";

/**
 * 8자리 숫자(YYYYMMDD)를 연속 입력하면 자동으로 YYYY-MM-DD 로 완성되는 날짜 입력.
 * 네이티브 date 입력은 연도 칸이 6자리까지 숫자를 흡수해 "20260612" 연속 입력이
 * 불가능하므로, 텍스트 입력 + 자동 하이픈 삽입 방식으로 구현한다.
 * 값(value)은 항상 완성된 ISO(YYYY-MM-DD) 또는 빈 문자열로만 부모에 전달된다.
 */
export function AutoDateInput({
  value,
  onChange,
  className,
  placeholder,
  ...rest
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onChange: (next: string) => void;
}) {
  const [text, setText] = useState(value ?? "");

  // 부모 값이 바뀌면(모달 프리필 등) 표시 텍스트를 동기화한다.
  // 입력 중(부분 입력)에는 onChange 를 호출하지 않으므로 타이핑을 방해하지 않는다.
  useEffect(() => {
    setText(value ?? "");
  }, [value]);

  const commit = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    const formatted = formatDigits(digits);
    setText(formatted);
    if (digits.length === 0) {
      if (value !== "") onChange("");
      return;
    }
    if (digits.length === 8 && isValidIsoDate(formatted)) {
      if (value !== formatted) onChange(formatted);
    }
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={10}
      className={className}
      placeholder={placeholder ?? "YYYYMMDD"}
      value={text}
      onChange={(e) => commit(e.target.value)}
      onBlur={() => {
        // 미완성/잘못된 날짜는 마지막 유효 값으로 되돌린다.
        if (text !== "" && !isValidIsoDate(text)) setText(value ?? "");
      }}
    />
  );
}

/** 숫자만 받은 문자열을 입력 진행도에 맞춰 YYYY-MM-DD 형태로 변환 */
function formatDigits(digits: string): string {
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/** YYYY-MM-DD 형식 + 실제 존재하는 날짜인지 검증 (타임존 영향 없는 로컬 계산) */
function isValidIsoDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}
