"use client";

import { X } from "lucide-react";
import { formatExactAmount } from "@/lib/contracts/format-money";

/**
 * 매입 계약 화면 공용 조각(331) — 매출 계약 관리 page.tsx 의 로컬 ModalShell·Info·진척 카드를 같은 모양으로 둔다.
 * (매출 page.tsx 는 다브랜치 동시 수정 파일이라 export 로 바꾸지 않고 15줄짜리 복사본을 둔다.)
 */
export function ModalShell({ title, onClose, children, wide }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-[color:var(--cd-overlay)] flex items-center justify-center p-4">
      <div className={"cd-card rounded-lg max-h-[min(840px,calc(100vh-32px))] shadow-[var(--cd-shadow-dialog)] overflow-hidden flex flex-col " + (wide ? "w-[min(960px,calc(100vw-32px))]" : "w-[min(640px,calc(100vw-32px))]")}>
        <div className="p-5 border-b cd-border-c flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold cd-text">{title}</h3>
          <button type="button" onClick={onClose} className="cd-text-faint hover:opacity-70">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto scrollbar-hide">{children}</div>
      </div>
    </div>
  );
}

export function Info({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  const isEmpty = value == null || value === "";
  return (
    <div className={"rounded-lg border p-3 " + (highlight ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c")}>
      <p className="text-[11px] cd-text-faint">{label}</p>
      <p className={"text-sm mt-1 truncate " + (highlight ? "cd-text-primary" : "cd-text")}>
        {isEmpty ? "-" : value}
      </p>
    </div>
  );
}

/** 지급 진척도 — 매출의 수금 진척도 카드와 같은 SVG 링, 라벨만 지급. */
export function PaidProgressCard({ rate, paidAmount, baseAmount }: { rate: number; paidAmount: number; baseAmount: number }) {
  const percent = Math.round(rate * 100);
  const today = formatKoreanDate(new Date());
  return (
    <div className="rounded-lg border cd-border-c p-4 min-h-[180px] flex flex-col items-center justify-center relative">
      <p className="absolute left-4 top-3 text-[11px] font-semibold cd-text-faint">지급 진척도</p>
      <div className="relative w-28 h-28 flex items-center justify-center">
        <svg width="112" height="112" viewBox="0 0 112 112" className="absolute inset-0">
          <circle cx="56" cy="56" r="44" fill="none" strokeWidth="12" stroke="color-mix(in srgb, #B4A7D6 22%, transparent)" />
          {percent > 0 && (
            <circle
              cx="56"
              cy="56"
              r="44"
              fill="none"
              strokeWidth="12"
              stroke="#B4A7D6"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 44}
              strokeDashoffset={2 * Math.PI * 44 * (1 - Math.min(1, Math.max(0, rate)))}
              transform="rotate(-90 56 56)"
            />
          )}
        </svg>
        <span className="relative text-[22px] font-semibold text-[#8E7CC3]">{percent}%</span>
      </div>
      <p className="mt-3 text-xs font-mono cd-text-muted">
        {formatExactAmount(paidAmount)} / {formatExactAmount(baseAmount)}
      </p>
      {/* 좁은 카드(220px)에서 금액 줄과 겹치지 않게 흐름 배치 */}
      <p className="mt-1 text-[11px] cd-text-faint">{today} 기준</p>
    </div>
  );
}

export function formatKoreanDate(date: Date): string {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

export function formatThousands(value: string): string {
  const digits = stripDigits(value);
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
}

export function stripDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

export const str = (v: unknown): string => (v == null ? "" : String(v));
export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
