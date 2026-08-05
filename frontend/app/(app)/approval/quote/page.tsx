import { Suspense } from "react";
import { QuoteBoard } from "@/components/approval/QuoteBoard";

export const dynamic = "force-dynamic";

export default function ApprovalQuotePage() {
  return (
    <Suspense fallback={null}>
      <QuoteBoard />
    </Suspense>
  );
}
