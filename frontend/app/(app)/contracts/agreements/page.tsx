import { Suspense } from "react";
import { AgreementBoard } from "@/components/contracts/agreements/AgreementBoard";

// 계약서 작성 — 용역 계약서 초안 작성·전자결재 검토·발주처 발송.
// 설계: docs/contract-agreement-blueprint.md
export const dynamic = "force-dynamic";

export default function ContractAgreementsPage() {
  return (
    <Suspense>
      <AgreementBoard />
    </Suspense>
  );
}
