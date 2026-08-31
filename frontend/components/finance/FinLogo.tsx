"use client";

// 은행·카드사 로고 (public/finance/logos, 공식 파비콘 수집본)
// FinanceBoard 와 JournalPanels 가 함께 쓰므로 공용 모듈로 분리(FinanceBoard → JournalPanels 순환 import 방지).

import { useState } from "react";

// 바로빌 지원 전체 은행 — FinanceBoard 로고 카드와 어음 취급 은행 select 가 같은 목록을 쓴다.
export const BAROBILL_BANKS: Array<{ code: string; name: string }> = [
  { code: "KB", name: "국민은행" }, { code: "SHINHAN", name: "신한은행" }, { code: "NH", name: "농협은행" },
  { code: "HANA", name: "하나은행" }, { code: "SC", name: "제일은행" }, { code: "WOORI", name: "우리은행" },
  { code: "IBK", name: "기업은행" }, { code: "KDB", name: "산업은행" }, { code: "KFCC", name: "새마을금고" },
  { code: "CITI", name: "씨티은행" }, { code: "SUHYUP", name: "수협은행" }, { code: "CU", name: "신협은행" },
  { code: "EPOST", name: "우체국" }, { code: "KJBANK", name: "광주은행" }, { code: "JBBANK", name: "전북은행" },
  { code: "DGB", name: "대구은행" }, { code: "BUSANBANK", name: "부산은행" }, { code: "KNBANK", name: "경남은행" },
  { code: "EJEJUBANK", name: "제주은행" }, { code: "KBANK", name: "케이뱅크" }, { code: "TOSS", name: "토스뱅크" },
];

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
