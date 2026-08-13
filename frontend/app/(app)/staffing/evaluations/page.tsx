"use client";

import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import BonusEvaluationsBoard from "@/components/bonus/BonusEvaluationsBoard";
import "@/components/cdash/cdash.css";

export default function BonusEvaluationsPage() {
  const { theme } = useCdashTheme();

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <BonusEvaluationsBoard />
    </div>
  );
}
