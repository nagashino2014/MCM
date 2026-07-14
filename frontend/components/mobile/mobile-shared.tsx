"use client";

import { X } from "lucide-react";
import { ACTIVITY_TYPE_META, type SalesActivityType } from "@/lib/sales/types";

// 모바일 화면 공용 소품 — 시트(풀스크린 하단 모달)·활동유형 태그·상태 표시.

/** API 응답 shape(서버 UpcomingActivity와 동일). 일정 화면·홈 공용. */
export interface MobileActivity {
  activityId: string;
  projectId: string;
  projectTitle: string;
  facilityName: string | null;
  activityType: SalesActivityType;
  scheduledAt: string; // KST 벽시계 'YYYY-MM-DDTHH:MM:00'
  endedAt: string | null;
  summary: string | null;
}

export function ActivityTag({ type }: { type: SalesActivityType }) {
  const meta = ACTIVITY_TYPE_META[type];
  if (!meta) return null;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold shrink-0"
      style={{ background: meta.color, color: "#1f2937" }}
    >
      {meta.short}
    </span>
  );
}

/** 'YYYY-MM-DDTHH:MM' → 'HH:MM'. 시간 없으면 빈 문자열. */
export function timeOf(iso: string): string {
  const t = iso.slice(11, 16);
  return t === "00:00" ? "" : t;
}

/** KST 오늘 'YYYY-MM-DD'. scheduled_at 이 KST 벽시계 문자열이라 날짜 문자열끼리 비교한다. */
export function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function Loading() {
  return <div className="cd-text-faint text-sm text-center py-10">불러오는 중…</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm">{message}</div>;
}

export function Empty({ label }: { label: string }) {
  return (
    <div className="cd-text-faint text-sm text-center py-8 cd-card-bg rounded-2xl border cd-border-c">{label}</div>
  );
}

/** 하단에서 올라오는 시트 — 모바일 상세 뷰 공용(데스크톱 모달 대체). */
export function MobileSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center"
      style={{ background: "rgba(17,22,29,0.45)" }}
      onClick={onClose}
    >
      <div
        className="cd-card-bg rounded-t-3xl w-full flex flex-col"
        style={{ maxWidth: 480, maxHeight: "85dvh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
          <h3 className="cd-text text-base font-extrabold truncate">{title}</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" onClick={onClose} aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 pb-6" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** 시트 내부 라벨-값 행. */
export function SheetRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="cd-text-faint text-xs shrink-0 pt-0.5" style={{ width: 72 }}>{label}</span>
      <span className="cd-text text-sm flex-1 min-w-0 break-words">{value}</span>
    </div>
  );
}
