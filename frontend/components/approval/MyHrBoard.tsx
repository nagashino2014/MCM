"use client";

// 내 휴가·근태(/approval/my-hr, 전 직원) — 내 휴가 + 내 근태·초과근무 통합 화면.
// 별도 페이지 2개는 정보밀도가 낮아 하나로 합쳤다(사용자 확정 2026-08-31).
// 좌(2) 내 휴가 / 우(3) 내 근태·초과근무. 각 섹션은 자체 API 를 독립 로드한다.

import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { MyLeaveSection } from "@/components/approval/MyLeaveBoard";
import { MyAttendanceSection } from "@/components/approval/MyAttendanceBoard";
import "@/components/cdash/cdash.css";

export function MyHrBoard() {
  const { theme } = useCdashTheme();
  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader title="내 휴가·근태" />
      <div className="grid grid-cols-1 2xl:grid-cols-5 gap-5 flex-1 min-h-0 overflow-y-auto">
        <div className="2xl:col-span-2 min-w-0">
          <MyLeaveSection />
        </div>
        <div className="2xl:col-span-3 min-w-0">
          <MyAttendanceSection theme={theme} />
        </div>
      </div>
    </div>
  );
}
