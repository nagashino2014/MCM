import type { HelpTopic } from "../types";

/** 재무(/finance) 화면의 ? 도움말. sources[0] 에 topic="id" 가 있어야 한다. */
export const FINANCE_HELP: HelpTopic[] = [
  {
    id: "finance.collect-range",
    label: "수집 범위·엑셀 적재 도움말",
    blocks: [
      { kind: "list", items: [
        "바로빌은 매일 새벽 4시에 내역을 모으고, 앱은 오래되었으면 화면을 열 때 뒤에서 수집합니다.",
        "바로빌이 보관하는 원장은 **계좌 최근 3개월, 카드 약 2개월**뿐입니다. 그보다 과거는 [[지금 수집]]으로도 오지 않습니다.",
        "과거분은 은행·카드사 엑셀로 적재합니다. 이미 있는 거래는 건너뛰고, 카드 취소 건은 넣지 않습니다.",
        "엑셀로 넣은 카드 건은 공급가액·부가세가 비어 있어 부가세 카드 공제 대상에서 빠집니다.",
      ] },
      { kind: "warn", text: "적재는 화면에서 되돌릴 수 없습니다. [[적재 대상]]을 확인한 뒤 적재하세요." },
    ],
    more: { article: "finance.connections", section: "collect" },
    sources: ["components/finance/FinanceBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "finance.card-classify",
    label: "계정과목 분류 도움말",
    blocks: [
      { kind: "p", text: "자동 분류 순서: 가맹점 고정 규칙 → 학습 사전(전에 직접 고른 가맹점) → 상호 키워드 → 업태." },
      { kind: "list", items: [
        "[[자동분류 재실행]]은 **미분류 건만** 다시 분류합니다. 새로 수집된 건도 이 버튼을 눌러야 분류됩니다.",
        "가게 아이콘으로 만든 고정 규칙은 **이미 수집된 같은 가맹점 거래에도 소급** 적용됩니다. 직접 고른 과목과 결의서 귀속·제외·공제 검토 건은 바뀌지 않습니다.",
        "[[공제]]·[[불공제]]·[[미판정]]은 부가세 공제 판정입니다. 계정과목과 별개로, 근거 봉인 전에 신고 근거 탭의 카드 공제 증빙 검토에서 정합니다.",
      ] },
    ],
    more: { article: "finance.ledger", section: "store-rule" },
    sources: ["components/finance/FinanceBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "finance.tax-invoice",
    label: "전자세금계산서·수정발행 도움말",
    blocks: [
      { kind: "list", items: [
        "발행은 계약 상세의 청구·수금 단계에서 합니다. 국세청 전송은 발행 다음 날 일괄 처리됩니다.",
        "발급된 계산서는 취소할 수 없습니다. [[전송완료]]가 되고 승인번호가 붙으면 [[수정발행]]으로 바로잡습니다.",
        "[[환입]]·[[계약의 해제]]·[[착오에 의한 이중발급]]은 자동으로 음수(마이너스) 발행됩니다. [[공급가액 변동]]은 [[증액]]·[[감액]]을 고르고, 감액이면 음수로 발행됩니다.",
        "세액은 공급가액의 10%이고, 원본이 영세율·면세면 0원입니다.",
      ] },
      { kind: "warn", text: "수정 발행도 즉시 발급되어 되돌릴 수 없고, 계약 단계 금액은 자동으로 바뀌지 않습니다." },
    ],
    more: { article: "finance.invoice", section: "modify" },
    sources: ["components/finance/FinanceBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "finance.recon",
    label: "수금 자동대조 도움말",
    blocks: [
      { kind: "list", items: [
        "입금자명으로 계약 거래처를 찾고, 금액(1원 이내)·어음 만기일(±5일)·합계·부분입금을 맞춰 제안합니다. 거래처를 모르는 입금은 제안하지 않습니다.",
        "[[승인]]하면 계약 단계에 수금이 기록되고 수금률·수금 완료가 다시 계산되며, 입금자명을 학습합니다.",
        "[[수동 매칭]]은 저장 즉시 반영됩니다.",
        "부분입금은 입금액을 부가세 포함액으로 보고 공급가액(÷1.1)만큼 배분합니다.",
        "[[되돌리기]]는 이 대조로 들어간 수금만 빼고, 다음 [[대조 실행]] 때 다시 제안됩니다.",
      ] },
    ],
    more: { article: "finance.invoice", section: "recon" },
    sources: ["components/finance/FinanceBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "finance.card-sum",
    label: "카드 매입 집계 기준 도움말",
    blocks: [
      {
        kind: "table",
        head: ["기준", "내용"],
        rows: [
          ["귀속일", "공제 검토에서 정한 신고 귀속일, 없으면 승인일"],
          ["취소·환불", "음수로 합산. 거절·제외 건은 빠짐"],
          ["공제 판정", "자동 판정 없음. 사유·증빙으로 검토한 건만 공제·불공제, 세액 0원은 자동 불공제, 나머지는 [[미판정]]"],
          ["[[계산서로 반영]]", "거래 연결로 계산서에 묶은 금액은 카드 공제에서 빠짐"],
        ],
      },
      { kind: "p", text: "[[미판정]]이 남으면 신고서를 내부 확정할 수 없습니다." },
    ],
    more: { article: "finance.vat-data", section: "card-sum" },
    sources: ["components/finance/FinanceBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "finance.vat-stages",
    label: "부가세 신고 단계 도움말",
    blocks: [
      { kind: "steps", items: [
        "**근거 봉인** — 신고 근거 탭에서 주체·기간·외부 사실·원문을 확정합니다. 해제할 수 없습니다.",
        "**내부 확정** — 봉인 근거로 계산한 신고서를 [[초안 저장]] 후 [[내부 확정]]합니다. 확정 취소는 없습니다.",
        "**접수·납부** — 홈택스에서 직접 신고·납부한 뒤 접수·납부 탭에 결과를 기록합니다.",
      ] },
      { kind: "warn", text: "봉인한 기간은 카드·계산서 공제 판정을 바꿀 수 없습니다. 판정을 먼저 끝낸 뒤 봉인하세요." },
    ],
    more: { article: "finance.vat-filing", section: "stages" },
    sources: ["components/finance/VatReturnPanels.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "finance.journal",
    label: "자동분개·재생성 도움말",
    blocks: [
      { kind: "list", items: [
        "[[재생성]]은 고른 기간의 [[자동]]·[[확정 필요]] 전표를 지우고 원장·결재·급여·상각에서 다시 만듭니다. [[확정됨]]·[[제외]] 전표는 보존됩니다.",
        "[[확정 필요]]는 가지급금·가수금으로 잡힌 건입니다. 계정을 골라 [[확정]]해야 손익·시산표에 들어갑니다.",
        "[[되돌리기]]는 확정·제외를 풀고, 다음 재생성 때 자동 규칙으로 다시 계산합니다.",
      ] },
      { kind: "warn", text: "기간이 결산 마감된 연도에 걸리면 재생성·확정이 모두 거절됩니다." },
    ],
    more: { article: "finance.journal", section: "regen" },
    sources: ["components/finance/JournalPanels.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "finance.closing",
    label: "연차 마감 도움말",
    blocks: [
      { kind: "list", items: [
        "확정 필요 전표가 0건이고 원천 점검을 통과해야 마감할 수 있습니다.",
        "마감하면 그 연도의 전표 재생성·확정과 기초 잔액 저장이 잠기고, 재무상태표가 마감 당시 모습으로 보존됩니다.",
        "고쳐야 하면 [[마감 해제 사유]]를 적고 [[마감 해제]]합니다. 사유는 감사 기록에 남습니다.",
        "세무조정 후보는 자동 감지 결과이므로 신고 전에 따로 검토합니다.",
      ] },
      { kind: "warn", text: "마감·해제는 확인 창 없이 바로 처리됩니다." },
    ],
    more: { article: "finance.closing", section: "close" },
    sources: ["components/finance/ClosingPanels.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "finance.depreciation",
    label: "고정자산 상각 도움말",
    blocks: [
      { kind: "list", items: [
        "[[정액법]]: 취득가액 ÷ 내용연수를 12개월로 나눕니다. [[정률법]]: 연초 미상각잔액 × 상각률. 건물은 정액법만 됩니다.",
        "취득한 달부터 상각하고(기초 기준일이 있으면 그다음 달부터), 장부가 1,000원에서 멈춥니다.",
        "끝난 달만 월말 날짜로 기표되며, 전표·장부에서 [[재생성]]해야 반영됩니다.",
        "[[처분]]은 처분한 달부터 상각을 멈춥니다. 처분 손익과 취득 분개는 자동으로 만들지 않습니다.",
      ] },
    ],
    more: { article: "finance.assets", section: "fixed" },
    sources: ["components/finance/AssetBudgetPanels.tsx", "components/finance/JournalPanels.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "finance.expsettle",
    label: "개인카드 경비 정산 도움말",
    blocks: [
      { kind: "list", items: [
        "대상: 승인된 지출 결의서(개인카드)의 금액 행과, 영수증이 연결된 출장보고서 개인카드 행. 불지급 식대는 빠집니다.",
        "[[일괄 정산 실행]]은 기간 구분 없이 **미정산 전건**을 정산합니다.",
        "[[정산 이력]]에서 [[CMS 생성]] → [[다운로드]]한 파일(KB 일괄이체 양식)을 은행에 직접 올립니다.",
      ] },
      { kind: "warn", text: "일괄 정산과 [[부가세 자료 발송]]은 되돌릴 수 없습니다. 정산 전에는 같은 행이 경비 환급 목록에도 보이니 이중 이체에 주의하세요." },
    ],
    more: { article: "finance.expsettle", section: "run" },
    sources: ["components/finance/ExpenseSettlementPanel.tsx"],
    reviewedAt: "2026-10-20",
  },
];
