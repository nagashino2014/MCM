import { Suspense } from "react";
import { FilingQueueBoard } from "@/components/filings/FilingQueueBoard";

export const dynamic = "force-dynamic";

export default function ContractFilingsPage() {
  return (
    <Suspense fallback={null}>
      <FilingQueueBoard />
    </Suspense>
  );
}
