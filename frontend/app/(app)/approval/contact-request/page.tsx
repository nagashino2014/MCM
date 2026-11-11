import { Suspense } from "react";
import { ApprovalContactRequestBoard } from "@/components/approval/ApprovalContactRequestBoard";

export const dynamic = "force-dynamic";

export default function ApprovalContactRequestPage() {
  return (
    <Suspense fallback={null}>
      <ApprovalContactRequestBoard />
    </Suspense>
  );
}
