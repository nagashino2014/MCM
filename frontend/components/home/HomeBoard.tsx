"use client";

import { House } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import "@/components/cdash/cdash.css";

import { TodayScheduleCard } from "./widgets/TodayScheduleCard";
import { PendingProgressCard } from "./widgets/PendingProgressCard";
import { UpcomingBidsCard } from "./widgets/UpcomingBidsCard";
import { WorkPlanTodoCard } from "./widgets/WorkPlanTodoCard";
import { InvoiceRequestCard } from "./widgets/InvoiceRequestCard";
import { InvoiceInboxCard } from "./widgets/InvoiceInboxCard";
import { QuickFacilitiesCard } from "./widgets/QuickFacilitiesCard";
import { AlertsCard } from "./widgets/AlertsCard";

/**
 * 홈 대시보드 보드(cdash). 권한별 노출은 각 위젯의 API 403 → 카드 숨김으로 처리(프론트 권한 분기 없음).
 * 카드 높이가 제각각이라 CSS multi-column(masonry) 로 유동 배치한다.
 */
export function HomeBoard({ role }: { role?: string }) {
  const { theme, toggleTheme } = useCdashTheme();

  return (
    <div
      className="cdash cd-fields-white flex flex-col gap-5 p-4 md:p-5 rounded-3xl min-h-full"
      data-theme={theme}
    >
      <CdPageHeader
        icon={<House className="w-5 h-5" />}
        eyebrow="Home"
        title="홈"
        subtitle="오늘 내 업무의 출발점 — 일정·경과·투찰·업무보고·세금계산서 발행을 한눈에."
        actions={<CdThemeToggle theme={theme} onToggle={toggleTheme} />}
      />

      <div className="columns-1 lg:columns-2 xl:columns-3 gap-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
        <TodayScheduleCard />
        <PendingProgressCard theme={theme} />
        <UpcomingBidsCard />
        <WorkPlanTodoCard />
        <InvoiceRequestCard />
        <InvoiceInboxCard />
        <QuickFacilitiesCard role={role} />
        <AlertsCard role={role} />
      </div>
    </div>
  );
}
