import type { HelpTopic } from "../types";

/** 영업/마케팅·공공입찰·견적서 화면의 ? 도움말. sources[0] 파일에 topic="id" 가 있어야 한다(test:manual). */
export const SALES_HELP: HelpTopic[] = [
  // ── 견적서 ──
  {
    id: "quote.write-page",
    label: "견적서 작성 도움말",
    blocks: [
      { kind: "list", items: [
        "흐름: 기본 정보·수신처 입력 → 사업장별 제출 견적가 입력 → [[MD 역산 실행]] → [[미리보기]] → 결재선 지정 후 [[상신]].",
        "내용이 바뀌면 5분마다 자동 저장되고, 위쪽 [[저장]]으로 바로 임시저장할 수도 있습니다.",
        "견적번호는 용역 분류별로 따로 매겨지며 상신할 때 확정됩니다. 화면의 번호는 예정 번호입니다.",
        "결재가 승인되면 견적서 파일이 만들어지고, 메일 발송을 골랐다면 참조 담당자에게 PDF가 자동 발송됩니다.",
      ] },
    ],
    more: { article: "quote.write", section: "flow" },
    sources: ["components/approval/QuoteBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "quote.price",
    label: "제출 견적가·금액 요약 도움말",
    blocks: [
      { kind: "list", items: [
        "제출 견적가(부가세 별도)를 넣고 [[MD 역산 실행]]을 누르면 업무 항목의 표준 MD 비중대로 등급별 MD를 나눠 금액을 계산합니다.",
        "합계(직접인건비+제경비+기술료+직접경비)는 견적가보다 커야 하고, 초과폭이 아래 상한 미만이어야 상신됩니다.",
        "MD는 견적가 1천만원 이상이면 0.5 단위, 미만이면 0.1 단위로 맞춥니다(스냅). 그래도 안 맞으면 한 칸만 0.01 단위로 조정됩니다.",
        "견적가·요율·직접경비·업무 항목을 바꾸면 역산을 다시 실행하세요. MD 칸을 직접 고쳐도 같은 제약을 지켜야 합니다.",
      ] },
      { kind: "table", head: ["제출 견적가", "초과폭 상한"], rows: [
        ["500만원 이하", "10만원"],
        ["1천만원 이하", "20만원"],
        ["5천만원 이하", "30만원"],
        ["1억원 이하", "50만원"],
        ["2억원 이하", "100만원"],
        ["2억원 초과", "200만원"],
      ] },
    ],
    more: { article: "quote.write", section: "price" },
    sources: ["components/approval/QuoteBoard.tsx", "lib/quote/types.ts", "lib/quote/rates.ts"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "quote.direct-cost",
    label: "직접경비 도움말",
    blocks: [
      { kind: "list", items: [
        "출장비 = 일단가 × 인원 × 출장 횟수, 인쇄비 = 부당 단가 × 총 부수입니다. 금액을 직접 입력하지 않습니다.",
        "[[엔지니어링공제료]]를 켜면 1단계 + 2단계 금액(천원 미만 절사)이 직접경비에 더해집니다. 1단계 = 견적가 × (기본요율 + 가산요율 × 담보기간 초과일수 ÷ 365), 2단계 = 견적가 × 0.16%.",
        "기본요율 0.599%·가산요율 0.096%가 기본값입니다. 요율을 고치지 않으면 5억원 초과분에는 구간별 요율이 자동 적용되고, 고치면 그 요율 하나로 계산합니다.",
        "직접경비는 역산할 때 견적가에서 먼저 빠지고 남은 금액으로 MD를 나눕니다. 직접경비가 견적가 이상이면 역산되지 않습니다.",
        "직접경비 요율 칸은 견적가 대비 비중을 보여 주는 칸이라 입력할 수 없습니다.",
      ] },
    ],
    more: { article: "quote.write", section: "direct" },
    sources: ["components/approval/QuoteBoard.tsx", "lib/quote/types.ts"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "quote.rate-set",
    label: "기준 세트 도움말",
    blocks: [
      { kind: "list", items: [
        "기준 세트는 용역 세분류별 업무 항목·등급별 표준 MD·요율 묶음입니다. 표준 MD는 역산 때 MD를 나누는 비중으로 쓰입니다.",
        "수신처 사업장에 전용 기준 세트가 있으면 전용 세트가 먼저 적용됩니다. [[표준 기준으로 전환]] / [[전용 기준으로 전환]]으로 바꾼 뒤에는 [[MD 역산 실행]]을 다시 누르세요.",
        "기준 세트가 없는 세분류는 품목과 금액을 직접 입력하는 자유형으로 작성합니다.",
        "기준 세트를 고쳐도 이미 작성한 견적서는 산정 당시 값이 그대로 유지됩니다.",
      ] },
    ],
    more: { article: "quote.write", section: "rate-set" },
    sources: ["components/approval/QuoteBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "quote.settings-page",
    label: "견적 기준 관리 도움말",
    blocks: [
      { kind: "table", head: ["탭", "하는 일"], rows: [
        ["기준 세트(표준)", "세분류별 업무 항목·표준 MD·요율·특이사항 기본 문구"],
        ["기준 세트(개별)", "특정 사업장 전용 세트. 그 사업장이 수신처일 때 표준보다 먼저 적용"],
        ["노임단가", "연도별·등급별 일 단가. 매년 1월 자동 수집을 시도"],
        ["상황 변수", "견적서 작성의 상황 변수 목록"],
        ["수주 분석", "발송된 견적의 수주율 집계"],
      ] },
      { kind: "p", text: "세트를 고쳐도 이미 작성한 견적서는 산정 당시 값이 유지됩니다. 세트를 삭제하면 그 세분류는 자유 입력형(개별 세트는 표준 세트)으로 돌아갑니다." },
    ],
    more: { article: "quote.settings" },
    sources: ["components/approval/QuoteSettingsBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  // ── 영업 상세 ──
  {
    id: "sales.stage",
    label: "진행 단계 도움말",
    blocks: [
      { kind: "list", items: [
        "진행 단계는 스케쥴 날짜로 자동으로 정해지며 직접 바꿀 수 없습니다. 날짜가 지나면 저절로 바뀝니다.",
        "지금 기간 중인 스케쥴(여럿이면 가장 늦게 시작한 것), 없으면 가장 최근에 끝난 스케쥴의 종류로 정합니다. 스케쥴이 모두 앞으로의 일정이면 리드입니다.",
        "전화·메일 → 컨택, 방문·현장설명회 → 제안, 견적·제안발표·투찰·결과 → 입찰.",
        "영업 결과가 낙찰이면 수주, 탈락·사업장 거절·사업 추진 중단이면 실주로 고정됩니다.",
        "경과 입력 여부와는 관계없습니다.",
      ] },
    ],
    more: { article: "sales.project", section: "stage" },
    sources: ["components/sales/ProjectDetail.tsx", "lib/sales/queries.ts"],
    reviewedAt: "2026-10-20",
  },
  // ── API & 스크래핑 ──
  {
    id: "intel.grade",
    label: "등급·관련성 도움말",
    blocks: [
      { kind: "list", items: [
        "등급은 투자 신호로서의 확실성입니다. 확정(설비 신설·증설이 분명) · 후보(정황이 있음) · 관찰(계열사 거래·공급계약 등 사람이 검토할 건) · 제외(지분 취득·단순 토지 매입 등).",
        "기본 목록은 확정·후보만 보여 줍니다. 관찰·제외는 등급 필터에서 고릅니다.",
        "관련성은 등급과 별개로, 통합허가 대상 업종과의 상관도입니다(직접 · 공급망 · 낮음 · 무관).",
        "회사명 옆 ‘거래상대’ 표시는 공시한 회사가 아니라 거래상대방(발주처)이 대상인 신호입니다.",
      ] },
    ],
    more: { article: "sales.intel", section: "grade" },
    sources: ["components/sales/intel/IntelBoard.tsx", "components/sales/intel/intel-shared.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "intel.delete",
    label: "신호 삭제 도움말",
    blocks: [
      { kind: "list", items: [
        "한 건씩 삭제할 때는 사유를 골라야 합니다. 그 건(기사·공시 1건)은 다시 수집되지 않고, 사유는 수집 로직 개선에 쓰입니다.",
        "같은 회사·업종의 다른 정보는 계속 수집됩니다. 상세 이유를 적어 두면 정상 신호까지 걸러지는 것을 막는 데 쓰입니다.",
        "목록 아래 [[제외 일괄 삭제]]·[[관찰 일괄 삭제]]·[[선택 일괄 삭제]]는 사유가 남지 않아, 지운 건이 다음 수집 때 다시 들어올 수 있습니다.",
      ] },
    ],
    more: { article: "sales.intel", section: "delete" },
    sources: ["components/sales/intel/IntelBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  // ── 공공입찰 ──
  {
    id: "bid.notify",
    label: "매칭 알림 도움말",
    blocks: [
      { kind: "list", items: [
        "발송 조건마다 발송 대상 종류·용역 분류·지역권·수신자·발송 시각을 따로 정합니다. 바꾼 뒤 [[저장]]을 눌러야 반영됩니다.",
        "발송 시각(최대 4개)마다 매칭 범위(발송일 기준 N일 전 0시 이후 게시분)에서 조건에 맞는 공고를 찾아 보냅니다. 각 시각 10분 전에 최신 정보를 먼저 수집합니다.",
        "이미 보낸 공고는 다시 보내지 않고, 새로 맞는 공고가 없으면 발송하지 않습니다. 한 번에 30건까지 목록으로 보내고 나머지는 건수만 알립니다.",
        "[[마감 알림]]을 체크한 수신자는 입찰 서류 생성 진행 건 중 마감이 [[마감 임박 알림]]에서 고른 날수 이내인 건의 알림을 받습니다.",
        "[[테스트 전송]]은 지금 조건으로 즉시 1회 보내며 발송 이력에 남지 않습니다.",
      ] },
    ],
    more: { article: "sales.bids", section: "notify" },
    sources: ["components/sales/bid/BidBoard.tsx"],
    reviewedAt: "2026-10-20",
  },
  {
    id: "bid.package-save",
    label: "작업 상태 저장 도움말",
    blocks: [
      { kind: "list", items: [
        "[[작업 상태 저장]]은 선택한 실적 계약·수행인력·참여직위·담당파트·수행실적 설정을 저장합니다. 저장하지 않고 화면을 떠나면 사라집니다.",
        "[[문서 생성 (HWPX)]]을 누르면 지금 화면 상태를 먼저 저장한 뒤 생성합니다.",
        "양식 항목 매핑을 고쳤다면 [[매핑 저장]]을 따로 눌러야 생성·미리보기에 반영됩니다.",
        "미리보기는 저장 전 화면 상태로 만들며 보관되지 않습니다. 생성본(zip)은 가장 최근 1건만 보관됩니다.",
      ] },
    ],
    more: { article: "sales.bid-package", section: "save" },
    sources: ["components/sales/bid/BidPackageBoard.tsx", "components/sales/bid/FormProfilePanel.tsx"],
    reviewedAt: "2026-10-20",
  },
];
