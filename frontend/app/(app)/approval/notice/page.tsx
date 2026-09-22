import { Suspense } from "react";
import { ApprovalNoticeBoard } from "@/components/approval/ApprovalNoticeBoard";

export const dynamic = "force-dynamic";

export default function ApprovalNoticePage() {
  return (
    <Suspense fallback={null}>
      <ApprovalNoticeBoard />
    </Suspense>
  );
}
