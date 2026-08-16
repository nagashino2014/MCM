import { Suspense } from "react";
import { FinanceBoard } from "@/components/finance/FinanceBoard";

export const dynamic = "force-dynamic";

export default function FinancePage() {
  return (
    <Suspense>
      <FinanceBoard />
    </Suspense>
  );
}
