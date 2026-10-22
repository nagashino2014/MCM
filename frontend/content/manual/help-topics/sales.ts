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
  // ── 회사소개서 ──
  {
    id: "catalog.home",
    label: "회사소개서 도움말",
    blocks: [
      { kind: "list", items: [
        "회사소개서의 숫자는 모두 [[지표 사전]]에서 계산합니다. 계약·인사가 바뀌면 화면을 다시 열 때 바로 반영됩니다.",
        "아래 표에서 통합환경허가 최초허가가 어떤 계약으로 셈해졌는지 확인합니다.",
        "관리 권한이 있으면 위쪽 카드로 실적·인물·고객사 로고 관리 화면에 갑니다.",
      ] },
    ],
    more: { article: "sales.catalog", section: "metrics" },
    sources: ["components/sales/catalog/CatalogHomeBoard.tsx"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "catalog.cover",
    label: "표지 디자인 도움말",
    blocks: [
      { kind: "list", items: [
        "표지 4안 중 하나를 누르면 바로 저장됩니다. 기본은 A 잎 창입니다.",
        "'확정 전' 안(B·C)은 디자인 확정 전이라 이름·모양이 바뀔 수 있습니다.",
        "[[사진 없는 변형으로 만들기]]는 사진 자리를 비운 변형입니다. C 는 원래 사진이 없습니다.",
        "이미 발행한 소개서의 표지는 바뀌지 않습니다.",
      ] },
    ],
    more: { article: "sales.catalog", section: "cover" },
    sources: ["components/sales/catalog/CatalogCoverPicker.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.metrics",
    label: "지표 사전 도움말",
    blocks: [
      { kind: "list", items: [
        "지표는 소개서에 찍히는 숫자의 단일 원천입니다. 본문·인포그래픽은 숫자를 직접 쓰지 않고 지표를 연결합니다.",
        "'완료'는 허가일이 있거나 마지막 대금 단계 계산서가 발행된 계약입니다.",
        "수행 비율의 분모(환경부 통합허가 완료 사업장 수)는 외부 수치라 출처·기준일과 함께 따로 관리합니다.",
      ] },
    ],
    more: { article: "sales.catalog", section: "metrics" },
    sources: ["components/sales/catalog/CatalogHomeBoard.tsx"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "catalog.initial-permit",
    label: "최초허가 집계 도움말",
    blocks: [
      { kind: "list", items: [
        "통합환경허가 분류에서 세분류가 최초허가(구 표기 '통합허가', 2017 시범사업 포함)인 계약입니다.",
        "완료 계약의 사업장 수를 더합니다. 실적 노출 관리에서 지정한 허가 사업장 수가 우선이고, 없으면 결정번호 수, 결정번호도 없으면 1개소로 셉니다.",
        "허가 사업장 수를 0으로 지정한 계약은 '집계 제외'로 표시되고 더하지 않습니다.",
        "업종군(1~5차년도)은 사업장 업종으로 묶습니다. 20개 업종 밖이면 '업종 미판정'입니다.",
      ] },
    ],
    more: { article: "sales.catalog", section: "initial-permit" },
    sources: ["components/sales/catalog/CatalogHomeBoard.tsx"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "catalog.projects",
    label: "실적 노출 관리 도움말",
    blocks: [
      { kind: "list", items: [
        "모든 계약이 나오고, 대외 표기는 규칙으로 자동 생성됩니다. 줄을 눌러 고칩니다.",
        "새 계약은 [[미검토]]로 표시됩니다. 확인했으면 [[검토 완료로 저장]] 또는 일괄 [[검토 완료]]를 누릅니다.",
        "부록에 실을 범위(금액·기간·상태)는 [[표시 범위]] 탭에서 정합니다.",
      ] },
    ],
    more: { article: "sales.catalog-projects", section: "list" },
    sources: ["components/sales/catalog/CatalogProjectsBoard.tsx"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "catalog.display-title",
    label: "대외 표기 도움말",
    blocks: [
      { kind: "list", items: [
        "대외 표기명을 비워 두면 회색 글씨의 자동 표기를 씁니다. 계약명·허가일·결정번호가 바뀌면 자동 표기도 따라 바뀝니다.",
        "직접 적으면 그 문장이 그대로 실립니다(자동으로 바뀌지 않습니다).",
        "비공개 고객으로 두면 목록에 '○○사'로 나오고 결정번호는 빠집니다.",
        "묶음 행 이름이 같은 계약은 같은 분류·연도 안에서 한 줄로 합쳐집니다.",
        "허가 사업장 수는 한 용역에 여러 사업장 허가가 묶인 통합환경허가 계약에만 적습니다(비우면 결정번호 수). 0은 최초허가 집계 제외입니다.",
      ] },
    ],
    more: { article: "sales.catalog-projects", section: "list" },
    sources: ["components/sales/catalog/CatalogProjectsBoard.tsx"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "catalog.appendix-rules",
    label: "표시 범위 도움말",
    blocks: [
      { kind: "list", items: [
        "금액 기준은 '이 금액 이하 미표시'입니다. 0이면 그 분류는 전부 싣습니다. 변경계약 반영 금액으로 판정합니다.",
        "항상 표시·대표 실적으로 지정한 계약은 금액 기준과 관계없이 실립니다.",
        "총괄표·본편 숫자는 기본으로 전체 실적을 셉니다. '부록에 표시된 실적만'을 고르면 숫자가 줄어듭니다.",
        "예상 쪽 수는 A4 가로 부록 표 한 쪽 26줄 기준의 어림값입니다.",
      ] },
    ],
    more: { article: "sales.catalog-projects", section: "rules" },
    sources: ["components/sales/catalog/CatalogProjectsBoard.tsx", "lib/catalog/appendix.ts"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "catalog.manual-projects",
    label: "계약 없는 실적 도움말",
    blocks: [
      { kind: "list", items: [
        "정식 계약 없이 수행한 실적(예: 위임받아 수행하고 대금만 받은 건)을 회사소개서 지표·부록에만 넣습니다.",
        "계약 관리의 수주·매출·수금 집계에는 들어가지 않습니다.",
        "실적 목록에는 '계약 없음' 표시로 나오며, 줄을 누르면 이 편집 창이 열립니다.",
      ] },
    ],
    more: { article: "sales.catalog-projects", section: "manual" },
    sources: ["components/sales/catalog/CatalogManualProjects.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.manual-project-form",
    label: "계약 없는 실적 입력 도움말",
    blocks: [
      { kind: "list", items: [
        "분류·실적 이름은 꼭 적습니다. 통합환경허가는 세분류(최초허가 등)·허가일·결정번호를 적어야 최초허가 건수에 들어갑니다.",
        "허가 사업장 수는 한 건에 여러 사업장 허가가 묶였을 때만 적습니다(비우면 결정번호 수, 없으면 1).",
        "날짜는 2020-12-03 또는 2020-12 형식으로 적습니다.",
        "대외 표기명을 비우면 사업장·허가일·결정번호로 자동 표기합니다.",
      ] },
    ],
    more: { article: "sales.catalog-projects", section: "manual" },
    sources: ["components/sales/catalog/CatalogManualProjects.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.people",
    label: "인물 노출 관리 도움말",
    blocks: [
      { kind: "list", items: [
        "사용자관리에 등록된 재직자만 나오며 퇴사하면 바로 빠집니다. 직급이 부장보다 높으면 임원, 부장 이하는 직원입니다.",
        "구획·게재·사진 칸은 바꾸는 즉시 저장됩니다. 연필 아이콘으로 순서·직함·약력을 적습니다.",
        "고문 등 촉탁 임원은 임원진 탭의 [[임원 직접 추가]]로, 자문위원은 [[자문위원]] 탭에서 등록합니다.",
      ] },
    ],
    more: { article: "sales.catalog-people", section: "rules" },
    sources: ["components/sales/catalog/CatalogPeopleBoard.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.people-rules",
    label: "임원진·기술인력 판정 도움말",
    blocks: [
      { kind: "table", head: ["구분", "자동 판정"], rows: [
        ["임원진", "직급이 부장보다 높은 재직자(사용자관리 기준). 사진은 거부가 아니면 게재"],
        ["기술인력", "부장 이하 재직자 중 대행업·엔지니어링 등급 보유자. 사진은 동의자만"],
      ] },
      { kind: "p", text: "구획 칸에서 사람별로 바꿀 수 있고, 게재 칸의 [[항상 싣기]]·[[빼기]]로 고정합니다." },
    ],
    more: { article: "sales.catalog-people", section: "rules" },
    sources: ["components/sales/catalog/CatalogPeopleBoard.tsx", "lib/catalog/people.ts"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.extra-people",
    label: "촉탁 임원 직접 입력 도움말",
    blocks: [
      { kind: "list", items: [
        "고문처럼 근로계약 없이 자문(촉탁) 계약을 맺어 사용자관리에 없는 임원을 넣습니다.",
        "임원진 쪽에 자동 판정 임원과 함께 순서대로 실립니다.",
        "'인원 포함'이면 임원·임직원 수에 더해집니다.",
      ] },
    ],
    more: { article: "sales.catalog-people", section: "extra" },
    sources: ["components/sales/catalog/CatalogPeopleBoard.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.extra-person-form",
    label: "촉탁 임원 입력 도움말",
    blocks: [
      { kind: "list", items: [
        "사진은 PNG·JPG·WebP, 10MB 이하입니다. 3:4 세로 사진이 잘 맞습니다.",
        "약력 요약은 3~4줄로 줄바꿈해 적습니다. 상세 경력은 이력 쪽에 쓰입니다.",
        "[[임원 인원 수에 포함]]을 끄면 임원진 쪽에만 실리고 인원 수에는 들어가지 않습니다.",
      ] },
    ],
    more: { article: "sales.catalog-people", section: "extra" },
    sources: ["components/sales/catalog/CatalogPeopleBoard.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.org",
    label: "조직도 도움말",
    blocks: [
      { kind: "list", items: [
        "처음에는 MCM 조직(부서·부서장·인원)으로 만든 기본안이 나옵니다. 소개서용으로 고쳐도 인사 조직은 바뀌지 않습니다.",
        "[[임시 저장]]은 편집 중 내용만 남기고, [[확정]]하면 새 판으로 기록됩니다. 소개서는 최신 확정판을 씁니다.",
      ] },
    ],
    more: { article: "sales.catalog-org", section: "edit" },
    sources: ["components/sales/catalog/CatalogOrgChartBoard.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.org-edit",
    label: "조직도 상자 편집 도움말",
    blocks: [
      { kind: "list", items: [
        "왼쪽부터 이름, 아래 줄(책임자·인원 등), 표시(촉탁·자문·외부)입니다.",
        "화살표 = 같은 단계 안 순서, + = 하위 조직 추가, 휴지통 = 삭제(하위 조직 포함).",
        "[[MCM 조직에서 다시 불러오기]]는 편집 칸만 다시 채웁니다(확정판은 그대로).",
      ] },
    ],
    more: { article: "sales.catalog-org", section: "edit" },
    sources: ["components/sales/catalog/CatalogOrgChartBoard.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.org-versions",
    label: "조직도 판 기록 도움말",
    blocks: [
      { kind: "list", items: [
        "맨 위 판이 회사소개서에 쓰는 판입니다.",
        "[[불러오기]]는 그 판을 편집 칸으로 가져옵니다. 고친 뒤 확정하면 새 판이 됩니다.",
      ] },
    ],
    more: { article: "sales.catalog-org", section: "versions" },
    sources: ["components/sales/catalog/CatalogOrgChartBoard.tsx", "components/sales/catalog/ContentVersions.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.message",
    label: "대표이사 인사말 도움말",
    blocks: [
      { kind: "list", items: [
        "[[임시 저장]]은 편집 중 내용만 남깁니다. 소개서에는 [[확정]]한 판이 쓰입니다.",
        "확정할 때마다 새 판으로 기록되고, 지난 판은 지워지지 않습니다.",
        "본문은 빈 줄로 문단을 나눕니다.",
      ] },
    ],
    more: { article: "sales.catalog-message", section: "edit" },
    sources: ["components/sales/catalog/CatalogMessageBoard.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.message-versions",
    label: "인사말 판 기록 도움말",
    blocks: [
      { kind: "list", items: [
        "맨 위 판이 회사소개서에 쓰는 판입니다.",
        "[[불러오기]]는 그 판을 편집 칸으로 가져옵니다. 고친 뒤 확정하면 새 판이 됩니다.",
      ] },
    ],
    more: { article: "sales.catalog-message", section: "versions" },
    sources: ["components/sales/catalog/CatalogMessageBoard.tsx", "components/sales/catalog/ContentVersions.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.clients",
    label: "고객사 로고 도움말",
    blocks: [
      { kind: "list", items: [
        "소개서 '주요 고객사·협력 기관' 쪽에 실릴 목록입니다. 분류(공공·민간·협회)와 순서대로 놓입니다.",
        "로고는 PNG·JPG·WebP, 5MB 이하입니다. 흰 바탕 로고가 가장 잘 보입니다.",
        "[[싣기]]를 끄면 목록에만 남습니다.",
      ] },
    ],
    more: { article: "sales.catalog-assets", section: "list" },
    sources: ["components/sales/catalog/CatalogAssetsBoard.tsx"],
    reviewedAt: "2026-10-21",
  },
  {
    id: "catalog.clients-add",
    label: "고객사 추가 도움말",
    blocks: [
      { kind: "list", items: [
        "아래 목록은 아직 추가하지 않은 계약 거래처를 계약 많은 순으로 보여 줍니다. [[목록에 추가]]로 넣습니다.",
        "계약이 없는 협회·공공기관은 위 입력란에 이름을 적고 [[추가]]를 누릅니다.",
      ] },
    ],
    more: { article: "sales.catalog-assets", section: "list" },
    sources: ["components/sales/catalog/CatalogAssetsBoard.tsx"],
    reviewedAt: "2026-10-21",
  },
];
