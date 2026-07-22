import { Suspense } from "react";
import { ApprovalDraftBoard } from "@/components/approval/ApprovalDraftBoard";

export const dynamic = "force-dynamic";

export default function ApprovalDraftPage() {
  return (
    <Suspense fallback={null}>
      <ApprovalDraftBoard />
    </Suspense>
  );
}
