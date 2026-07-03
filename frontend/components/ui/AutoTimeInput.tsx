"use client";

import { useEffect, useState } from "react";

/**
 * 4자리 숫자(HHMM)를 연속 입력하면 자동으로 HH:MM 으로 완성되는 시간 입력.
 * 예) "0930" → "09:30". 값(value)은 완성된 "HH:MM" 또는 빈 문자열로만 부모에 전달된다.
 * 네이티브 time 입력의 아이콘/칸이동 불편을 피하기 위한 텍스트 입력 방식.
 */
export function AutoTimeInput({
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

  useEffect(() => {
    setText(value ?? "");
  }, [value]);

  const commit = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    const formatted = formatDigits(digits);
    setText(formatted);
    if (digits.length === 0) {
      if (value !== "") onChange("");
      return;
    }
    if (digits.length === 4 && isValidTime(formatted)) {
      if (value !== formatted) onChange(formatted);
    }
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      className={className}
      placeholder={placeholder ?? "HHMM"}
      value={text}
      onChange={(e) => commit(e.target.value)}
      onBlur={() => {
        if (text !== "" && !isValidTime(text)) setText(value ?? "");
      }}
    />
  );
}

/** 숫자만 받은 문자열을 입력 진행도에 맞춰 HH:MM 형태로 변환 */
function formatDigits(digits: string): string {
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** HH:MM 형식 + 실제 존재하는 시각(00:00~23:59)인지 검증 */
function isValidTime(hm: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!m) return false;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}
