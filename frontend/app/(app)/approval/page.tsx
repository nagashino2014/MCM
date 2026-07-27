import { Suspense } from "react";
import { ApprovalHomeBoard } from "@/components/approval/ApprovalHomeBoard";

export const dynamic = "force-dynamic";

export default function ApprovalHomePage() {
  return (
    <Suspense fallback={null}>
      <ApprovalHomeBoard />
    </Suspense>
  );
}
