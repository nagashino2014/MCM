"use client";

// 홈 상단 스탯 4카드(Soft Glass Ink) — 라벨 11.5/700 + 숫자 25/800 + 컬러 델타.
// 데이터는 기존 엔드포인트 재사용(신규 API 없음): 결재/메일은 nav 뱃지, 일정·경과는 영업 API.
// 델타 문구는 실제 응답에서 도출되는 값만 표시한다(값이 없으면 델타를 비운다).

import { useHomeWidget } from "./useHomeWidget";
import { useNavBadges } from "@/components/layout/useNavBadges";

interface Activity {
  activityId: string;
  scheduledAt: string | null;
}

interface PendingReport {
  activities: unknown[];
}

/** ISO → KST "HH:mm". */
function hhmm(dt: string | null): string | null {
  if (!dt) return null;
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return null;
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

/** 오늘(KST) 일정만 추린다. */
function todayOnly(activities: Activity[]): Activity[] {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 3600 * 1000);
  const key = kstNow.toISOString().slice(0, 10);
  return activities.filter((a) => {
    if (!a.scheduledAt) return false;
    const d = new Date(a.scheduledAt);
    if (Number.isNaN(d.getTime())) return false;
    return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) === key;
  });
}

function StatCard({ label, value, delta, tone }: { label: string; value: number; delta?: string | null; tone: string }) {
  return (
    <div className="cd-card px-[18px] py-3.5 gap-1">
      <span className="text-[11.5px] font-bold tracking-[0.02em] cd-text-muted">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-[25px] font-extrabold tracking-[-0.02em] cd-text tabular-nums">{value}</span>
        {delta && (
          <span className="text-[11.5px] font-bold" style={{ color: tone }}>
            {delta}
          </span>
        )}
      </span>
    </div>
  );
}

export function HomeStats() {
  const badges = useNavBadges();
  const wa = useHomeWidget<{ activities: Activity[] }>("/api/sales/upcoming-activities");
  const wp = useHomeWidget<{ reports: PendingReport[] }>("/api/sales/pending-reports");

  const today = wa.status === "ok" ? todayOnly(wa.data.activities) : [];
  const firstAt = today
    .map((a) => hhmm(a.scheduledAt))
    .filter((v): v is string => !!v)
    .sort()[0];
  const pending =
    wp.status === "ok" ? wp.data.reports.reduce((sum, r) => sum + (r.activities?.length ?? 0), 0) : 0;

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      <StatCard label="결재 대기" value={badges.approvalPending} delta={badges.approvalPending > 0 ? "내 차례" : null} tone="var(--cd-error)" />
      <StatCard label="안읽은 메일" value={badges.mailUnread} delta={badges.mailUnread > 0 ? "확인 필요" : null} tone="var(--cd-primary)" />
      <StatCard label="오늘 일정" value={today.length} delta={firstAt ? `${firstAt} 시작` : null} tone="var(--cd-secondary)" />
      <StatCard label="경과 미입력" value={pending} delta={pending > 0 ? "확인 필요" : null} tone="var(--cd-warning)" />
    </div>
  );
}
