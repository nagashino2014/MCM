"use client";

import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import PayrollLedgerBoard from "@/components/payroll/PayrollLedgerBoard";
import "@/components/cdash/cdash.css";

export default function PayrollLedgerPage() {
  const { theme } = useCdashTheme();

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <PayrollLedgerBoard />
    </div>
  );
}
