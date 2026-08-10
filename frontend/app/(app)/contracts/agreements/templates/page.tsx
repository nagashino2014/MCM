import { AgreementTemplateBoard } from "@/components/contracts/agreements/AgreementTemplateBoard";

// 계약서 양식 기준 관리 — 용역 대분류-세분류별 표준 셋(견적 기준 관리 스타일) + 발주처 자체양식.
// 메뉴 미노출 — 계약서 작성 보드에서 진입한다.
export const dynamic = "force-dynamic";

export default function AgreementTemplatesPage() {
  return <AgreementTemplateBoard />;
}
