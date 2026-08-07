import { Suspense } from "react";
import { DeliverableBoard } from "@/components/contracts/deliverables/DeliverableBoard";

export const dynamic = "force-dynamic";

export default function ContractDeliverablesPage() {
  return (
    <Suspense fallback={null}>
      <DeliverableBoard />
    </Suspense>
  );
}
