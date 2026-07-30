"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardEdit, CreditCard, Search } from "lucide-react";
import {
  ActivityDetailSheet,
  ActivityTag,
  Empty,
  ErrorBox,
  Loading,
  MobileSheet,
  kstToday,
  timeOf,
  type MobileActivity,
} from "./mobile-shared";

// 모바일 홈 — 오늘·이번 주 일정(카드 탭 → 상세 시트), 경과 미입력(탭 → 미입력 리스트 → 바로 입력), 빠른 액션.

interface PendingReport {
  projectId: string;
  title: string;
  facilityName: string | null;
  activities: {
    activityId: string;
    activityType: MobileActivity["activityType"];
    scheduledAt: string | null;
    endedAt: string | null;
    summary: string | null;
  }[];
}

export function MobileHome() {
  const [activities, setActivities] = useState<MobileActivity[]>([]);
  const [pending, setPending] = useState<MobileActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MobileActivity | null>(null);
  const [pendingOpen, setPendingOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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
        const reports: PendingReport[] = Array.isArray(pendData.reports) ? pendData.reports : [];
        // 프로젝트 단위 응답을 일정 단위로 평탄화 — 시트에서 바로 경과 입력
        setPending(
          reports.flatMap((r) =>
            r.activities.map((a) => ({
              activityId: a.activityId,
              projectId: r.projectId,
              projectTitle: r.title,
              facilityName: r.facilityName,
              activityType: a.activityType,
              scheduledAt: a.scheduledAt ?? a.endedAt ?? "",
              endedAt: a.endedAt,
              summary: a.summary,
            }))
          )
        );
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = kstToday();
  const todayList = activities.filter((a) => a.scheduledAt.slice(0, 10) === today);
  const weekList = activities.filter((a) => a.scheduledAt.slice(0, 10) > today).slice(0, 8);

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBox message={error} />}

      {/* 경과 미입력 알림 — 탭 시 미입력 일정 리스트 시트 */}
      {pending.length > 0 && (
        <button className="cd-warn-bg rounded-2xl px-4 py-3 flex items-center justify-between w-full" onClick={() => setPendingOpen(true)}>
          <span className="cd-warn-text text-sm font-bold">경과 미입력 일정 {pending.length}건</span>
          <ChevronRight className="w-4 h-4 cd-warn-text" />
        </button>
      )}

      {/* 빠른 액션 */}
      <div className="grid grid-cols-2 gap-2">
        <Link href="/m/facilities" className="cd-card px-4 py-3.5 !flex-row items-center gap-2.5">
          <Search className="cd-text-primary" style={{ width: 18, height: 18 }} />
          <span className="cd-text text-sm font-bold">사업장 검색</span>
        </Link>
        <Link href="/m/card" className="cd-card px-4 py-3.5 !flex-row items-center gap-2.5">
          <CreditCard style={{ width: 18, height: 18 }} className="cd-text-primary" />
          <span className="cd-text text-sm font-bold">명함 촬영</span>
        </Link>
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
              <ActivityCard key={a.activityId} activity={a} showDate={false} onClick={() => setDetail(a)} />
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
                <ActivityCard key={a.activityId} activity={a} showDate onClick={() => setDetail(a)} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* 일정 상세 시트(경과 입력 포함) */}
      {detail && (
        <ActivityDetailSheet
          activity={detail}
          today={today}
          onClose={() => setDetail(null)}
          onSaved={() => {
            setDetail(null);
            load();
          }}
        />
      )}

      {/* 경과 미입력 리스트 시트 — 항목 탭 시 상세 시트로 전환해 바로 입력 */}
      {pendingOpen && !detail && (
        <MobileSheet title={`경과 미입력 일정 ${pending.length}건`} onClose={() => setPendingOpen(false)}>
          <div className="flex flex-col gap-2">
            {pending.map((a) => (
              <ActivityCard
                key={a.activityId}
                activity={a}
                showDate
                onClick={() => {
                  setPendingOpen(false);
                  setDetail(a);
                }}
              />
            ))}
          </div>
        </MobileSheet>
      )}
    </div>
  );
}

function ActivityCard({
  activity: a,
  showDate,
  onClick,
}: {
  activity: MobileActivity;
  showDate: boolean;
  onClick: () => void;
}) {
  const time = timeOf(a.scheduledAt);
  return (
    <button className="cd-card px-3.5 py-3 !flex-row items-center gap-2.5 text-left w-full" onClick={onClick}>
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
    </button>
  );
}
