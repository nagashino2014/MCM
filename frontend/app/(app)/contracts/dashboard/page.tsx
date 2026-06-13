import { DashboardShell } from "@/components/contracts/dashboard/DashboardShell";
import "./dashboard.css";
// 미수금/수금내역 카드의 발행·수금 모달 스타일 (cdb-modal-*)
import "../billing/billing.css";

export default function ContractDashboardPage() {
  return (
    <div className="p-2 h-full">
      <DashboardShell />
    </div>
  );
}
