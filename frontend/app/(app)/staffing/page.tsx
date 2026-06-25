"use client";

import { UserCog } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";

export default function StaffingPage() {
  const { theme, toggleTheme } = useCdashTheme();

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<UserCog className="w-5 h-5" />}
        eyebrow="Work · Staffing"
        title="사업참여 수행인력"
        subtitle="용역별 수행인력 현황을 자동 집계하고, 실적증명서 명단 생성과 반기 성과급 산정의 기준 데이터를 관리합니다."
      />

      <section className="cd-card rounded-3xl p-8 cd-reveal delay-1 flex flex-col items-center justify-center text-center gap-3 min-h-[320px]">
        <span className="cd-title-icon"><UserCog className="w-5 h-5" /></span>
        <h2 className="text-lg font-extrabold cd-text">수행인력 모듈 준비 중</h2>
        <p className="max-w-xl text-sm leading-relaxed cd-text-faint">
          용역×사람 매트릭스, 인력 변동 이력·반기 평점, 수행인력 명단(HWPX→PDF) 생성 기능이
          단계적으로 제공될 예정입니다. 계약 담당 본부·수행 인력은 계약 상세에서 지정합니다.
        </p>
      </section>
    </div>
  );
}
