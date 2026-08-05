import { Suspense } from "react";
import { ApprovalLetterBoard } from "@/components/approval/ApprovalLetterBoard";

export const dynamic = "force-dynamic";

export default function ApprovalLetterPage() {
  return (
    <Suspense fallback={null}>
      <ApprovalLetterBoard />
    </Suspense>
  );
}
