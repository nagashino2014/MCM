"use client";

import dynamic from "next/dynamic";

/**
 * react-apexcharts 는 window 에 의존하므로 SSR 을 끄고 동적 로드한다.
 * 로딩 중에는 차트 높이만큼 자리를 확보해 레이아웃 점프를 막는다.
 */
const ApexChart = dynamic(() => import("react-apexcharts"), {
  ssr: false,
  loading: () => <div className="w-full h-full min-h-[120px]" />,
});

export default ApexChart;
