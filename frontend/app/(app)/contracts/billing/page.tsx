import { Suspense } from "react";
import { BillingShell } from "@/components/contracts/billing/BillingShell";
import "../dashboard/dashboard.css";
import "./billing.css";

export default function ContractBillingPage() {
  return (
    // 하단 패딩을 없애 탭페이지 하단이 좌측 메뉴 바 하단과 정확히 일치하도록 한다
    <div className="px-2 pt-2 h-full">
      <Suspense fallback={null}>
        <BillingShell />
      </Suspense>
    </div>
  );
}
