"use client";

import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import StaffingRecordsBoard from "@/components/staffing/StaffingRecordsBoard";
import "@/components/cdash/cdash.css";

export default function StaffingRecordsPage() {
  const { theme } = useCdashTheme();

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <StaffingRecordsBoard />
    </div>
  );
}
