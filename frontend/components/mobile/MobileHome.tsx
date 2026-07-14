"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardEdit, CreditCard, Search } from "lucide-react";
import {
  ActivityTag,
  Empty,
  ErrorBox,
  Loading,
  kstToday,
  timeOf,
  type MobileActivity,
} from "./mobile-shared";

// 모바일 홈 — 오늘·이번 주 일정(upcoming-activities 14일 응답을 클라에서 분리),
// 경과 미입력 배지(pending-reports 건수), 빠른 액션.

export function MobileHome() {
  const [activities, setActivities] = useState<MobileActivity[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [actRes, pendRes] = await Promise.all([
          fetch("/api/sales/upcoming-activities", { cache: "no-store" }),
          fetch("/api/sales/pending-reports", { cache: "no-store" }),
        ]);
        if (!actRes.ok) throw new Error(`일정 조회 실패 (HTTP ${actRes.status})`);
        const actData = await actRes.json();
        setActivities(Array.isArray(actData.activities) ? actData.activities : []);
        if (pendRes.ok) {
          const pendData = await pendRes.json();
          setPendingCount(Array.isArray(pendData.reports) ? pendData.reports.length : 0);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const today = kstToday();
  const todayList = activities.filter((a) => a.scheduledAt.slice(0, 10) === today);
  const weekList = activities.filter((a) => a.scheduledAt.slice(0, 10) > today).slice(0, 8);

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBox message={error} />}

      {/* 경과 미입력 알림 */}
      {pendingCount > 0 && (
        <Link href="/m/schedule" className="cd-warn-bg rounded-2xl px-4 py-3 flex items-center justify-between">
          <span className="cd-warn-text text-sm font-bold">경과 미입력 일정 {pendingCount}건</span>
          <ChevronRight className="w-4 h-4 cd-warn-text" />
        </Link>
      )}

      {/* 빠른 액션 */}
      <div className="grid grid-cols-2 gap-2">
        <Link href="/m/facilities" className="cd-card-bg border cd-border-c rounded-2xl px-4 py-3.5 flex items-center gap-2.5">
          <Search className="w-4.5 h-4.5 cd-text-primary" style={{ width: 18, height: 18 }} />
          <span className="cd-text text-sm font-bold">사업장 검색</span>
        </Link>
        <div className="cd-card-bg border cd-border-c rounded-2xl px-4 py-3.5 flex items-center gap-2.5 opacity-50">
          <CreditCard style={{ width: 18, height: 18 }} className="cd-text-faint" />
          <span className="cd-text-muted text-sm font-bold">명함 촬영 (준비 중)</span>
        </div>
      </div>

      {/* 오늘 일정 */}
      <section>
        <h2 className="cd-text-muted text-xs font-bold mb-1.5 px-1">오늘 일정</h2>
        {loading ? (
          <Loading />
        ) : todayList.length === 0 ? (
          <Empty label="오늘 예정된 일정이 없습니다." />
        ) : (
          <div className="flex flex-col gap-2">
            {todayList.map((a) => (
              <ActivityCard key={a.activityId} activity={a} showDate={false} />
            ))}
          </div>
        )}
      </section>

      {/* 이번 주(다가오는) 일정 */}
      {!loading && (
        <section>
          <div className="flex items-center justify-between mb-1.5 px-1">
            <h2 className="cd-text-muted text-xs font-bold">다가오는 일정</h2>
            <Link href="/m/schedule" className="cd-text-primary text-xs font-bold inline-flex items-center">
              전체 보기 <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {weekList.length === 0 ? (
            <Empty label="2주 내 예정된 일정이 없습니다." />
          ) : (
            <div className="flex flex-col gap-2">
              {weekList.map((a) => (
                <ActivityCard key={a.activityId} activity={a} showDate />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ActivityCard({ activity: a, showDate }: { activity: MobileActivity; showDate: boolean }) {
  const time = timeOf(a.scheduledAt);
  return (
    <div className="cd-card-bg border cd-border-c rounded-2xl px-3.5 py-3 flex items-center gap-2.5">
      <ActivityTag type={a.activityType} />
      <div className="flex-1 min-w-0">
        <div className="cd-text text-sm font-bold truncate">{a.projectTitle}</div>
        <div className="cd-text-faint text-xs truncate">
          {[showDate ? `${a.scheduledAt.slice(5, 10).replace("-", "/")}` : null, time || null, a.facilityName]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <ClipboardEdit className="w-4 h-4 cd-text-faint shrink-0" style={{ opacity: a.summary ? 1 : 0 }} />
    </div>
  );
}
