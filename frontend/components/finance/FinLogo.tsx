"use client";

// 은행·카드사 로고 (public/finance/logos, 공식 파비콘 수집본)
// FinanceBoard 와 JournalPanels 가 함께 쓰므로 공용 모듈로 분리(FinanceBoard → JournalPanels 순환 import 방지).

import { useState } from "react";

// 로고 파일 코드: 은행 = {code} / 카드사 = CARD_{code} (은행 겸용 코드는 은행 로고 재사용)
export const logoFileCode = (kind: "bank" | "card", code: string) =>
  kind === "card" ? (["KJBANK", "JBBANK", "SUHYUP"].includes(code) ? code : `CARD_${code}`) : code;

// 서빙: DB 업로드본 우선 → 번들 정적 파일 폴백(/api/finance/logos/img). 갱신 반영용 버전 쿼리.
export const logoSrc = (kind: "bank" | "card", code: string, version = 0) =>
  `/api/finance/logos/img/${logoFileCode(kind, code)}${version ? `?v=${version}` : ""}`;

export function FinLogo({ kind, code, label, size = 36, version = 0 }: { kind: "bank" | "card"; code: string; label: string; size?: number; version?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed || !code) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full font-bold shrink-0"
        style={{ width: size, height: size, background: "var(--cd-primary-soft)", color: "var(--cd-primary)", fontSize: size * 0.38 }}
      >
        {label.slice(0, 1)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoSrc(kind, code, version)}
      alt={label}
      width={size}
      height={size}
      className="rounded-full shrink-0 object-contain"
      style={{ background: "#fff", border: "1px solid var(--cd-border)" }}
      onError={() => setFailed(true)}
    />
  );
}
