import { Suspense } from "react";
import { DeptBillingShell } from "@/components/contracts/billing/DeptBillingShell";
import "../dashboard/dashboard.css";
import "../billing/billing.css";

// 부서 수주·수금 현황(299) — 부서장 전용. 메뉴·URL 은 billing.dept.view 로 가드(config/menu-permissions.ts).
export default function DeptBillingPage() {
  return (
    <div className="px-2 pt-2 h-full">
      <Suspense fallback={null}>
        <DeptBillingShell />
      </Suspense>
    </div>
  );
}
