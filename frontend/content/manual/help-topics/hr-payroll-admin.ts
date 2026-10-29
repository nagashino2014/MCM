import type { HelpTopic } from "../types";

/** 급여·근로계약 관리 + 근태·휴가 관리(관리자용) 화면의 ? 도움말. sources[0] 에 topic="id" 가 있어야 한다. */
export const HR_PAYROLL_ADMIN_HELP: HelpTopic[] = [
  // ── 급여대장 ──
  {
    id: "payroll.ledger",
    label: "급여대장 도움말",
    blocks: [
      { kind: "list", items: [
        "순서: 새 대장(작성 중) → 행별 수정·세액 확인 → 확정 → 명세서 발송.",
        "작성 중 대장만 고칠 수 있습니다. **확정하면 되돌릴 수 없습니다.**",
        "확정과 명세서 발행에는 급여 확정 권한이 따로 필요합니다.",
        "명절 상여는 ‘상여금 지급 계획’을 결재받으면 상여대장이 자동으로 만들어집니다.",
        "과거 엑셀 대장은 ‘엑셀 가져오기’로, 직원별 연간 명세서(퇴직금 적립·추계 포함)는 직원별 연간 탭의 엑셀·PDF 아이콘으로 받습니다.",
      ] },
    ],
    more: { article: "payroll.ledger", section: "flow" },
    sources: ["components/payroll/PayrollLedgerBoard.tsx"],
    reviewedAt: "2026-10-29",
  },
  {
    id: "payroll.ledger-create",
    label: "새 대장 생성 도움말",
    blocks: [
      { kind: "list", items: [
        "지급: 직전 급여대장을 복사하고(신규 입사자는 최신 근로계약), 수당 규칙이 있으면 규칙이 우선합니다.",
        "초과근무수당·숙박출장수당은 **전월 26일~이번 달 25일**에 승인된 문서로 자동 계산됩니다. 초과근무는 주 12시간까지만 수당이고, 넘는 시간은 대체휴가로 부여됩니다. 연차수당·성과급 등은 생성 후 직접 입력합니다.",
        "국민연금·건강·요양은 업로드한 EDI 고지액, 고용보험·소득세·지방소득세는 자동 계산입니다. EDI가 없으면 비어 있습니다.",
        "같은 달 급여대장이 있으면 만들 수 없습니다. 작성 중이면 삭제 후 다시 만듭니다.",
      ] },
    ],
    more: { article: "payroll.ledger", section: "create" },
    sources: ["components/payroll/LedgerCreateModal.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "payroll.ledger-import",
    label: "엑셀 가져오기 도움말",
    blocks: [
      { kind: "list", items: [
        "사원번호·성명 / 입사일·직급 / 퇴사일·부서 3단 양식의 급상여대장을 확정 대장으로 들여옵니다. 여러 파일을 함께 골라도 됩니다.",
        "귀속 연·월·종류는 파일 이름·제목에서 자동으로 채워지며 줄마다 고칠 수 있습니다.",
        "지급·공제·차인 합계가 맞지 않는 파일, 앱에서 만든 대장과 겹치는 달, 명세서 발행·전표 확정된 대장은 들어가지 않습니다.",
        "예전에 엑셀로 들여온 대장은 **덮어쓰기**를 체크해야 바뀝니다. 가져오기에는 급여 확정 권한이 필요합니다.",
      ] },
    ],
    more: { article: "payroll.ledger", section: "import" },
    sources: ["components/payroll/LedgerImportModal.tsx"],
    reviewedAt: "2026-10-29",
  },
  {
    id: "payroll.ledger-severance",
    label: "퇴직금 추계 도움말",
    blocks: [
      { kind: "list", items: [
        "퇴직금 적립: 매달 임금총액의 1/12 입니다(급여대장에는 없지만 매달 쌓이는 금액).",
        "추계 퇴직금 = 1일 평균임금 × 30일 × 재직일수 ÷ 365. 기준일은 그해 마지막 급여월 말일, 그해 퇴사했으면 퇴사일입니다.",
        "1일 평균임금 = (기준일 이전 3개월 임금 + 직전 1년 상여·연차수당 × 3/12) ÷ 3개월 일수. 정산 경비·출장수당·출장숙박수당은 뺍니다.",
        "재직 1년 미만은 지급 대상이 아닙니다. 실제 지급액은 재무의 퇴직 정산에서 확정합니다.",
        "급여일 외 지급: 급여일 전에 먼저 받은 상여·성과급(선지급분공제, 그달 상여·성과급 이내의 기타공제). 연간 실수령액 = 차인지급액 + 급여일 외 지급.",
      ] },
    ],
    more: { article: "payroll.ledger", section: "annual" },
    sources: ["components/payroll/PayrollLedgerBoard.tsx", "lib/payroll/annual-statement.ts"],
    reviewedAt: "2026-10-29",
  },
  {
    id: "payroll.ledger-tax",
    label: "세액 확인 도움말",
    blocks: [
      { kind: "list", items: [
        "모든 행의 세액을 확인해야 대장을 확정할 수 있습니다.",
        "재계산은 간이세액표(가족수·자녀 수·원천징수 비율)로 두 세액을 자동 계산합니다.",
        "월 과세급여가 1,000만 원을 넘어 표 범위 밖이거나 0원을 적용할 때는 두 세액과 근거(5자 이상)를 직접 넣습니다.",
        "확인 후 지급액이나 세액 설정이 바뀌면 다시 확인해야 합니다.",
      ] },
    ],
    more: { article: "payroll.ledger", section: "tax" },
    sources: ["components/payroll/PayrollLedgerBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  // ── 근로계약 ──
  {
    id: "payroll.contracts",
    label: "연봉·근로계약 도움말",
    blocks: [
      { kind: "list", items: [
        "조직도의 숫자는 직원별 계약 건수입니다.",
        "‘검수 필요’ 계약은 원본 PDF와 대조해 값을 고치고 검수 완료로 저장합니다.",
        "**서명이 끝난 계약은 고치거나 지울 수 없습니다.** 앱에서 만든 서명 전 계약만 삭제할 수 있고, 삭제는 되돌릴 수 없습니다.",
      ] },
    ],
    more: { article: "payroll.contracts", section: "history" },
    sources: ["components/payroll/LaborContractBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "payroll.contract-annual",
    label: "일괄 갱신 산식 도움말",
    blocks: [
      { kind: "list", items: [
        "갱신 월 급여 = 현행 연봉 × (1 + (물가상승률 + 추가 보정) ÷ 100) ÷ 12, 천 원 미만 버림. 갱신 연봉 = 월 급여 × 12.",
        "고정수당은 그대로 두고 늘어난 금액은 기본급에 반영합니다.",
        "‘예외’를 체크한 사람은 산정에서 넣은 인상률 또는 연봉 인상액으로 같은 방식(월 천 원 미만 버림)으로 계산합니다.",
        "현행 계약(연봉)이 없는 직원은 일괄 대상에서 빠집니다.",
      ] },
    ],
    more: { article: "payroll.contracts", section: "annual" },
    sources: ["components/payroll/ContractRoundPanel.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "payroll.contract-rounds",
    label: "결재·발송 진행 도움말",
    blocks: [
      { kind: "list", items: [
        "작성됨 → 기안 생성(기안 화면에서 직접 상신, 결재자 대표이사) → 결재 진행중 → 결재 완료 → 발송 → 직원 서명.",
        "결재가 끝나도 상태가 저절로 바뀌지 않습니다. **결재 확인**을 누르세요. 반려되면 작성됨으로 돌아갑니다.",
        "결재 완료 전에는 발송할 수 없습니다. 직원은 메일 링크나 홈의 내 근로계약 카드에서 서명합니다.",
        "라운드 삭제는 서명이 하나도 없을 때만 되며, 계약서가 모두 함께 지워집니다.",
      ] },
    ],
    more: { article: "payroll.contracts", section: "rounds" },
    sources: ["components/payroll/ContractRoundPanel.tsx"],
    reviewedAt: "2026-10-20",
  },
  // ── 연말정산·설정 ──
  {
    id: "payroll.yearend",
    label: "연말정산 관리 도움말",
    blocks: [
      { kind: "list", items: [
        "총급여·기납부 소득세·4대보험은 확정 급여대장에서 자동 집계됩니다. 간소화 납부액을 넣으면 그 값을 씁니다.",
        "계산할 때마다 표준세액공제와 특별공제를 모두 계산해 **결정세액이 작은 쪽을 자동으로 고릅니다**(같으면 특별공제).",
        "원천징수영수증은 등록한 원본이 있으면 원본이 우선입니다(직원 화면·증명서 발급).",
        "확정한 뒤 고치려면 확정 취소 후 다시 계산합니다.",
      ] },
    ],
    more: { article: "payroll.yearend", section: "calc" },
    sources: ["components/payroll/YearendBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "payroll.settings",
    label: "급여 항목·설정 도움말",
    blocks: [
      { kind: "list", items: [
        "여기서 바꾼 값은 **다음에 만드는 급여대장부터** 반영됩니다. 이미 만든 대장은 바뀌지 않습니다.",
        "통상임금 체크 항목이 초과근무 시급(월 통상임금 ÷ 209) 계산에 들어갑니다.",
        "수당 규칙은 전월 복사보다 우선하고, 0원 규칙은 그 항목을 멈춥니다.",
        "세액 설정의 가족수·자녀 수·원천징수 비율로 소득세가 계산됩니다.",
      ] },
    ],
    more: { article: "payroll.settings", section: "rules" },
    sources: ["components/payroll/PayrollSettingsBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  // ── 근태·휴가 관리 ──
  {
    id: "hr.leave-admin",
    label: "직원별 휴가 관리 도움말",
    blocks: [
      { kind: "list", items: [
        "연차는 매년 자동으로 부여되지 않습니다. 행을 펼쳐 ‘부여 · 조정’에서 직접 넣습니다. ‘규정 발생’은 법 기준 참고값입니다.",
        "휴가신청서가 승인되면 사용이 자동으로 기록되고, 결재가 취소·삭제되면 되돌아갑니다.",
        "연차 발생 기준을 바꾸면 회사 전체 설정이 즉시 바뀝니다.",
      ] },
    ],
    more: { article: "hr.leave-admin", section: "record" },
    sources: ["components/approval/ApprovalLeaveBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "hr.attendance",
    label: "근태·초과근무 관리 도움말",
    blocks: [
      { kind: "list", items: [
        "근태 엑셀은 ‘산정 정책’ 탭에서 올립니다. 직원과 연결되지 않은 기록은 ‘미매칭 매핑’에서 연결합니다.",
        "‘주별 초과근무’의 수당은 근태 기준 참고값입니다. 급여에는 ‘신청 대조’에서 인정된 시간만 들어갑니다.",
        "급여 구간은 전월 26일~이번 달 25일입니다.",
      ] },
    ],
    more: { article: "hr.attendance-admin", section: "upload" },
    sources: ["components/approval/AttendanceBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "hr.attendance-match",
    label: "신청 대조 도움말",
    blocks: [
      { kind: "list", items: [
        "인정 시간 = 소정근로 종료 시각(휴일은 출근 시각) 이후 실제 재실 시간 중 **신청한 시간까지**. 22:00~06:00은 야간(2.0배).",
        "근태가 아직 올라오지 않은 기간은 ‘근태 없음’으로 신청 시간을 그대로 인정합니다.",
        "미근무·조기 퇴근 건은 확인 후 승인(전량 인정) 또는 반려(전량 불인정)하고, 해제로 되돌립니다.",
        "인원별 산정 결과가 급여대장 초과근무수당이 됩니다. 한 주 인정 시간이 12시간을 넘으면 넘는 시간은 수당에서 빠지고 대체휴가로 부여됩니다(‘휴가 ○h’).",
        "이미 만든 작성 중 대장에는 다시 생성해야 반영됩니다.",
      ] },
    ],
    more: { article: "hr.attendance-admin", section: "match" },
    sources: ["components/approval/AttendanceBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "hr.leave-promotion",
    label: "연차 고지 발송 도움말",
    blocks: [
      { kind: "list", items: [
        "1차: **7월 1일~20일**에만 발송합니다. 잔여 연차가 있고 1차를 받지 않은 직원 전원이 대상입니다.",
        "2차: 7월 20일 이후 1차 미제출자에게 회사가 사용일을 지정합니다. 잔여일수가 0이 되게 날짜를 채워야 발송됩니다.",
        "서면으로 한 1차 고지는 ‘서면 고지 사후 등록’으로 계획서 스캔본과 예정일을 등록합니다.",
        "보낸 고지는 취소할 수 없습니다.",
      ] },
    ],
    more: { article: "hr.leave-promotion", section: "first" },
    sources: ["components/approval/LeavePromotionBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "hr.holidays",
    label: "휴무일 지정 도움말",
    blocks: [
      { kind: "list", items: [
        "법정공휴일·명절·근로자의 날은 자동이라 지정하지 않아도 됩니다.",
        "지정한 휴무일에 출근하면 재실 시간 전체가 초과근무 대상이 됩니다.",
        "‘전체연차 사용’으로 지정해도 연차는 자동으로 차감되지 않습니다.",
      ] },
    ],
    more: { article: "hr.holidays", section: "set" },
    sources: ["components/approval/HolidayBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "hr.leave-types",
    label: "휴가 종류 규정 도움말",
    blocks: [
      { kind: "list", items: [
        "차감이 ‘연차 1일/0.5일’인 종류만 연차에서 빠집니다. 비차감은 기록만 남습니다.",
        "부여일수를 비우면 실제 사용 기간만큼 처리합니다.",
        "키는 기존 문서가 참조하므로 바꾸지 마세요. 쓰지 않는 항목은 삭제 대신 사용을 해제합니다.",
        "저장을 눌러야 반영됩니다.",
      ] },
    ],
    more: { article: "hr.leave-types", section: "edit" },
    sources: ["components/approval/ApprovalLeaveTypesBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
];
