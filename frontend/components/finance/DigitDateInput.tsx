"use client";

// YYYYMMDD(또는 YYYYMM) 숫자만 입력하면 하이픈을 채워 주는 날짜 입력.
// <input type="date"> 는 브라우저 달력 아이콘 때문에 폭을 줄일 수 없어 원장 필터·카드 피커가 함께 쓴다.
// 값은 자리수가 다 찼을 때만 onChange 로 올린다(부분 입력 중에 조회가 튀지 않게).
// 원래 FinanceBoard 안에 있던 로컬 컴포넌트를 그대로 옮긴 것.

import { useEffect, useState } from "react";

export function DigitDateInput({
  value,
  onChange,
  mode = "ymd",
  className,
  style,
}: {
  value: string; // "YYYY-MM-DD" | "YYYY-MM" | ""
  onChange: (v: string) => void;
  mode?: "ymd" | "ym";
  className?: string;
  style?: React.CSSProperties;
}) {
  const maxDigits = mode === "ymd" ? 8 : 6;
  const format = (digits: string) => {
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  };
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder={mode === "ymd" ? "YYYYMMDD" : "YYYYMM"}
      className={className ?? "cd-input w-full"}
      style={style}
      value={text}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, maxDigits);
        const formatted = format(digits);
        setText(formatted);
        onChange(digits.length === maxDigits ? formatted : "");
      }}
    />
  );
}
