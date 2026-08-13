"use client";

import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import BonusStatementsBoard from "@/components/bonus/BonusStatementsBoard";
import "@/components/cdash/cdash.css";

export default function BonusStatementsPage() {
  const { theme } = useCdashTheme();

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <BonusStatementsBoard />
    </div>
  );
}
