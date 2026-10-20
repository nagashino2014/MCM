import type { HelpTopic } from "../types";

/** 사업 운영 — 사업장·계약 화면의 ? 도움말. sources[0] 파일에 topic="id" 가 있어야 한다(test:manual). */
export const FACILITIES_CONTRACTS_HELP: HelpTopic[] = [
  // ── 사업장 ──
  {
    id: "facilities.contacts",
    label: "사업장 담당자 도움말",
    blocks: [
      { kind: "list", items: [
        "담당자마다 업무 분류 태그(계약부서·환경부서·계산서)를 여러 개 붙일 수 있습니다.",
        "**계산서** 태그가 있고 이메일이 있는 재직 담당자는 이 사업장 계약의 전자세금계산서 기본 수신처가 됩니다. 여러 명이면 첫 사람이 대표 수신처, 나머지는 추가 수신처입니다.",
        "태그가 없으면 이메일이 있는 첫 담당자가 기본 수신처가 되며, 발행 창에서 바꿀 수 있습니다.",
        "연락처 구분은 담당자가 아니라 사업장 단위 속성(주소록 분류)입니다.",
      ] },
    ],
    more: { article: "facilities.main", section: "contacts" },
    sources: ["components/facilities/FacilityDetailPanel.tsx", "lib/barobill/invoicing.ts", "components/contracts/TaxInvoiceIssueModal.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "facilities.bizcert",
    label: "사업자등록증 도움말",
    blocks: [
      { kind: "list", items: [
        "PDF를 올리면 새 파일이 현재본이 되고, 업태·종목·법인등록번호·대표자명을 읽어 사업장 정보에 반영합니다.",
        "**재분석**: 현재본이면 인식된 값으로 사업장 정보를 덮어씁니다(읽지 못한 항목은 기존 값 유지). 과거본이면 그 파일 기록만 고칩니다.",
        "과거본 삭제는 되돌릴 수 없습니다. 현재본은 삭제할 수 없으니 갱신본을 먼저 올리세요.",
      ] },
    ],
    more: { article: "facilities.main", section: "bizcert" },
    sources: ["components/facilities/FacilityDetailPanel.tsx", "app/api/facilities/[id]/business-certificates/[certificateId]/route.ts"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "facilities.merge",
    label: "중복 병합 도움말",
    blocks: [
      { kind: "list", items: [
        "라디오로 고른 사업장(TARGET)이 남고, 나머지는 허가·계약·담당자·사업자등록증 등을 TARGET으로 넘긴 뒤 삭제됩니다.",
        "필드별 우선순위를 고르지 않은 항목은 TARGET의 현재 값을 유지합니다.",
        "병합은 되돌릴 수 없습니다.",
        "[[개별 업체 제외]]·[[전체 업체 제외]]한 후보는 자동 후보에 다시 나오지 않고 이 화면에서 되돌릴 수 없습니다.",
      ] },
    ],
    more: { article: "facilities.merge", section: "steps" },
    sources: ["app/(app)/facilities/merge/page.tsx", "app/api/facilities/merge/route.ts"],
    reviewedAt: "2026-10-20",
  },
  // ── 계약 관리 ──
  {
    id: "contracts.ledger",
    label: "계약 관리 권한 도움말",
    blocks: [
      { kind: "table", head: ["역할", "볼 수 있는 계약"], rows: [
        ["사원", "본인이 참여한 계약"],
        ["부서장", "소속 부서가 수행부서이거나 부서원이 참여한 계약"],
        ["임원·관리자", "전체 계약"],
      ] },
      { kind: "p", text: "신규 계약·변경계약 입력은 계약 편집 권한(부서장·관리자), 계약 삭제는 계약 삭제 권한이 있는 사람에게만 버튼이 보입니다. 단계 입력도 계약 편집 권한이 있어야 저장됩니다." },
    ],
    more: { article: "contracts.manage", section: "roles" },
    sources: ["app/(app)/contracts/page.tsx", "lib/auth/contract-scope.ts"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "contracts.stages",
    label: "청구·수금 단계 도움말",
    blocks: [
      { kind: "list", items: [
        "계약금액은 단계 청구금액의 합계로 자동 맞춰집니다. 단계를 추가·수정·삭제하면 계약금액도 바뀝니다.",
        "[[발행/수금]]은 이미 발행한 계산서 PDF와 수금을 기록하고, [[전자발행]]은 바로빌로 계산서를 실제로 발행합니다.",
        "실적 정산 열은 마지막 단계가 준공금·잔금·준공 기성금일 때만 나옵니다. 행을 끌어 순서를 바꿀 수 있습니다.",
        "단계를 삭제하면 그 단계의 세금계산서 파일이 휴지통 없이 즉시 지워집니다. 이미 전자발행한 계산서는 국세청·바로빌에 그대로 남습니다.",
      ] },
    ],
    more: { article: "contracts.manage", section: "stages" },
    sources: ["app/(app)/contracts/page.tsx", "lib/contracts/contract-amount.ts"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "contracts.invoice-entry",
    label: "발행/수금 입력 도움말",
    blocks: [
      { kind: "list", items: [
        "**복수 등록**: 계산서 한 장을 여러 단계에 함께 등록합니다. 발행금액은 각 단계 금액이고, 수금 정보는 이 창을 연 단계에만 들어갑니다. 이미 계산서가 있는 단계는 파일이 교체됩니다.",
        "**실적 정산**: 정산한 실제 청구액을 넣으면 발행금액·누적 수금금액이 같은 값으로 바뀌고 차감액이 자동 계산됩니다.",
        "**누적 수금금액**에는 이 단계에서 지금까지 받은 합계를 적습니다. 발행금액보다 적으면 부분입금으로 남아 미수금 현황에 잔액이 보입니다.",
        "부분입금 사유는 기록용 메모입니다.",
      ] },
    ],
    more: { article: "contracts.manage", section: "invoice" },
    sources: ["app/(app)/contracts/page.tsx", "app/api/contracts/[contractId]/invoices/route.ts"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "contracts.change-mode",
    label: "변경 구분 도움말",
    blocks: [
      { kind: "list", items: [
        "**새 변경계약(N차)**: 변경계약서를 새로 맺은 경우. [[준공일 및 기타]] 탭에서 변경계약서 PDF를 첨부해야 저장됩니다.",
        "**기존 차수 보완**: 이미 등록한 차수에 빠진 내용을 더합니다.",
        "**정보 정정**: 변경계약서 없이 잘못 입력한 값을 고칩니다. 차수가 생기지 않고 대행 실적 변경 보고 대상도 아닙니다.",
        "입력한 항목만 반영되고, 비워 둔 항목은 기존 값이 유지됩니다.",
      ] },
    ],
    more: { article: "contracts.manage", section: "change" },
    sources: ["components/contracts/ContractChangeModal.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "contracts.rate-card",
    label: "단가 계약 도움말",
    blocks: [
      { kind: "steps", items: [
        "① 단가 기준표에 발주처 단가표의 항목·단위·단가만 옮겨 적습니다.",
        "② 차수표에서 [[차수 추가]] 후 수량을 넣으면 금액이 단가×수량으로 계산됩니다. 감소율은 소수 수량(예: 16.7)이나 금액 칸 직접 수정으로 반영합니다(직접 고친 금액은 주황색).",
        "차수 소계는 지급 단위 비율(기본 선급금 30%·준공금 70%)로 나뉘어 청구·수금 단계 후보가 됩니다. 마지막 단위는 잔액으로 맞춰집니다.",
      ] },
      { kind: "p", text: "차수가 1개이고 지급 단위를 모두 지우면 구분별 소계가 단계가 됩니다. 추가 발주는 차수를 늘려 ‘1차 변경, 2차 변경…’으로 입력합니다." },
    ],
    more: { article: "contracts.manage", section: "unit-price" },
    sources: ["components/contracts/RateCardEditor.tsx"],
    reviewedAt: "2026-10-20",
  },
  // ── 계약 하위 화면 ──
  {
    id: "contracts.agreements",
    label: "계약서 작성 도움말",
    blocks: [
      { kind: "list", items: [
        "흐름: [[새 계약서]] 작성 → [[상신]](전자결재) → 승인 → 목록의 [[발주처 발송]]. 승인돼도 자동으로 발송되지 않습니다.",
        "결재: 작성 중 · 결재 진행 · 승인 · 반려(편집은 작성 중·반려일 때만). 발송: 발송 대기 · 발송 중 · 발송 완료 · 발송 실패(실패 시 [[재발송]]).",
        "발송 메일은 기안자 계정으로 나가고 결재선의 참조/열람자가 Cc로 받습니다. 초안 협의용 HWPX가 기본 첨부입니다.",
        "작성 화면은 5분마다 자동 저장됩니다.",
      ] },
    ],
    more: { article: "contracts.agreements", section: "flow" },
    sources: ["components/contracts/agreements/AgreementBoard.tsx", "lib/agreement/types.ts"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "contracts.deliverables",
    label: "착수계·준공계 도움말",
    blocks: [
      { kind: "table", head: ["VAT 표기", "계산"], rows: [
        ["VAT 별도(기본)", "계약금액 = 공급가액, 부가세 10% 가산"],
        ["VAT 별도(금액에 미포함)", "부가세 없이 공급가액만"],
        ["VAT 포함", "계약금액에서 ÷1.1로 공급가액 역산"],
      ] },
      { kind: "list", items: [
        "준공계의 금회 회차는 기본이 마지막(준공) 단계입니다. 중간 기성 청구면 해당 단계를 고릅니다.",
        "[[공문으로 발송]]은 저장 후 공문 작성 화면에 이 문서를 첨부해 엽니다. 공문 결재가 승인돼야 발송됩니다.",
        "기재 사항은 5분마다 자동 저장됩니다.",
      ] },
    ],
    more: { article: "contracts.deliverables", section: "vat" },
    sources: ["components/contracts/deliverables/DeliverableBoard.tsx", "lib/deliverable/format.ts"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "contracts.billing",
    label: "수주/수금/발행 현황 도움말",
    blocks: [
      { kind: "table", head: ["탭", "기준"], rows: [
        ["수주 현황", "계약일 기준 수주 계약(지도에서 시도 선택)"],
        ["미수금 현황", "계산서는 발행했지만 수금 완료되지 않은 단계의 잔액"],
        ["미발행 현황", "세금계산서를 아직 발행하지 않은 단계"],
        ["수금 현황", "수금된 단계(연도는 계약일 기준)"],
        ["어음 현황", "기간별 어음 발행·만기 도래 건"],
        ["완료 현황", "허가일 또는 마지막 단계 발행일이 있는 계약"],
      ] },
      { kind: "p", text: "미수금 리스트의 행을 누르면 수금을 입력합니다. 수금금액은 이번에 들어온 금액이고 기존 수금에 더해집니다. 잔액을 받지 않기로 했을 때만 ‘잔액이 남아도 수금 완료 처리’를 체크합니다." },
    ],
    more: { article: "contracts.billing", section: "tabs" },
    sources: ["components/contracts/billing/BillingShell.tsx", "components/contracts/billing/CollectionEntryModal.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "contracts.receivable-actions",
    label: "장기 미수금 대응 조치 도움말",
    blocks: [
      { kind: "list", items: [
        "3개월 이상 장기 미수금 리스트에서 건을 고르면 이 카드에 대응 이력을 남깁니다. 이력이 없는 건은 ‘미대응’으로 표시됩니다.",
        "조치: 구두 독촉 · 내용 증명 발송 · 채권 추심 진행(가압류 신청~공탁금 반환 결정 단계별 일자) · 회생 절차 진행 · 채권 포기.",
        "**채권 포기**는 이력 기록일 뿐, 미수금 목록·금액에서 자동으로 빠지지 않습니다.",
        "입력·수정은 미수 관리 권한이 있는 회계 담당자만 저장할 수 있습니다. 증빙 서류는 20MB 이하입니다.",
      ] },
    ],
    more: { article: "contracts.billing", section: "receivables" },
    sources: ["components/contracts/billing/ReceivableActionsCard.tsx", "lib/ieps/receivables.ts"],
    reviewedAt: "2026-10-20",
  },
];
