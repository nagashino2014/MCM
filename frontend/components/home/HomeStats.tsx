"use client";

// 홈 상단 KPI 6카드(Soft Glass Ink 핸드오프 2a) — 아이콘 타일(30px 틴트) + 라벨 11.5 + 숫자 24/800 + 컬러 델타.
// 기존 4종(결재 대기·안읽은 메일·오늘 일정·경과 미입력) + 신규 2종(발행 요청 수신·업무보고 할 일).
// 데이터는 기존 엔드포인트 재사용(신규 API 없음). 권한 없는 KPI(발행 요청 수신)는 API 403 으로 스스로 빠진다.
// 카드를 누르면 해당 항목 카드 위치로 스크롤한다(카드가 숨김/미표시면 해당 화면으로 이동).

import { useRouter } from "next/navigation";
import { CalendarDays, ClipboardCheck, ClipboardList, Clock, FileText, Mail, type LucideIcon } from "lucide-react";
import { useHomeWidget } from "./useHomeWidget";
import { useNavBadges } from "@/components/layout/useNavBadges";

interface Activity {
  activityId: string;
  scheduledAt: string | null;
}

interface PendingReport {
  activities: unknown[];
}

interface InvoiceInboxItem {
  milestoneId: string;
  amount: number | null;
}

interface WorkPlanTodo {
  rebound: { count: number };
  thisWeek: { count: number };
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

function StatCard({
  icon: Icon,
  label,
  value,
  delta,
  tone,
  tint,
  onJump,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  delta?: string | null;
  /** 아이콘·델타 색. */
  tone: string;
  /** 아이콘 타일 배경. */
  tint: string;
  onJump: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onJump}
      className="cd-card px-4 py-3.5 flex flex-col gap-2.5 text-left cursor-pointer transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-[var(--cd-shadow-hover)]"
      title={`${label} 카드로 이동`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span
          className="w-[30px] h-[30px] rounded-[10px] inline-flex items-center justify-center shrink-0"
          style={{ background: tint, color: tone }}
        >
          <Icon className="w-[15px] h-[15px]" strokeWidth={2} />
        </span>
        <span className="text-[11.5px] font-bold cd-text-muted truncate">{label}</span>
      </span>
      <span className="flex items-baseline gap-[7px]">
        <span className="text-2xl font-extrabold tracking-[-0.02em] cd-text tabular-nums">{value}</span>
        {delta && (
          <span className="text-[11px] font-bold whitespace-nowrap" style={{ color: tone }}>
            {delta}
          </span>
        )}
      </span>
    </button>
  );
}

/** 만원 단위 금액 요약("3,300만원") — 만원 미만이면 생략. */
function manwon(sum: number): string | null {
  const man = Math.round(sum / 10000);
  return man > 0 ? `${man.toLocaleString("ko-KR")}만원` : null;
}

export function HomeStats() {
  const router = useRouter();
  const badges = useNavBadges();
  const wa = useHomeWidget<{ activities: Activity[] }>("/api/sales/upcoming-activities");
  const wp = useHomeWidget<{ reports: PendingReport[] }>("/api/sales/pending-reports");
  const wi = useHomeWidget<{ items: InvoiceInboxItem[] }>("/api/home/invoice-requests/inbox");
  const ww = useHomeWidget<WorkPlanTodo>("/api/home/work-plan-todo");

  const today = wa.status === "ok" ? todayOnly(wa.data.activities) : [];
  const firstAt = today
    .map((a) => hhmm(a.scheduledAt))
    .filter((v): v is string => !!v)
    .sort()[0];
  const pending =
    wp.status === "ok" ? wp.data.reports.reduce((sum, r) => sum + (r.activities?.length ?? 0), 0) : 0;
  const invoiceItems = wi.status === "ok" ? wi.data.items : [];
  const invoiceSum = invoiceItems.reduce((s, it) => s + (it.amount ?? 0), 0);
  const rebound = ww.status === "ok" ? ww.data.rebound.count : 0;
  const workTodo = ww.status === "ok" ? rebound + ww.data.thisWeek.count : 0;

  /** KPI → 해당 카드로 스크롤. 카드가 없거나 접혀 있으면(권한/숨김) 해당 화면으로 이동한다. */
  const jump = (anchor: string, fallbackHref: string) => {
    const el = document.querySelector<HTMLElement>(`[data-home-anchor="${anchor}"]`);
    if (el && el.offsetParent !== null) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    router.push(fallbackHref);
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <StatCard
        icon={ClipboardCheck}
        label="결재 대기"
        value={badges.approvalPending}
        delta={badges.approvalPending > 0 ? "내 차례" : null}
        tone="var(--cd-primary)"
        tint="var(--cd-primary-soft)"
        onJump={() => jump("approval", "/approval")}
      />
      <StatCard
        icon={Mail}
        label="안읽은 메일"
        value={badges.mailUnread}
        delta={badges.mailUnread > 0 ? "확인 필요" : null}
        tone="var(--cd-secondary)"
        tint="var(--cd-secondary-soft)"
        onJump={() => jump("mail", "/mail")}
      />
      <StatCard
        icon={CalendarDays}
        label="오늘 일정"
        value={today.length}
        delta={firstAt ? `${firstAt} 시작` : null}
        tone="var(--cd-success)"
        tint="var(--cd-success-soft)"
        onJump={() => jump("calendar", "/calendar")}
      />
      <StatCard
        icon={Clock}
        label="경과 미입력"
        value={pending}
        delta={pending > 0 ? "확인 필요" : null}
        tone="var(--cd-warning)"
        tint="var(--cd-warning-soft)"
        onJump={() => jump("pendingProgress", "/sales")}
      />
      {/* 발행 요청 수신 — billing.receivable.manage 권한이 없으면 API 403 → KPI 자체를 뺀다. */}
      {wi.status !== "forbidden" && (
        <StatCard
          icon={FileText}
          label="발행 요청 수신"
          value={invoiceItems.length}
          delta={manwon(invoiceSum)}
          tone="var(--cd-av-2)"
          tint="color-mix(in srgb, var(--cd-av-2) 16%, transparent)"
          onJump={() => jump("invoiceInbox", "/contracts/billing")}
        />
      )}
      {ww.status !== "forbidden" && (
        <StatCard
          icon={ClipboardList}
          label="업무보고 할 일"
          value={workTodo}
          delta={rebound > 0 ? `재작성 ${rebound}건` : null}
          tone="var(--cd-error)"
          tint="var(--cd-error-soft)"
          onJump={() => jump("workPlan", "/work-plan")}
        />
      )}
    </div>
  );
}
