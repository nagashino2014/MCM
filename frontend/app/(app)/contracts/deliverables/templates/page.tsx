import { Suspense } from "react";
import { TemplateBoard } from "@/components/contracts/deliverables/TemplateBoard";

export const dynamic = "force-dynamic";

export default function ContractDeliverableTemplatesPage() {
  return (
    <Suspense fallback={null}>
      <TemplateBoard />
    </Suspense>
  );
}
