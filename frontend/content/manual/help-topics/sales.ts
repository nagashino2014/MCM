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
        "[[발행본]] 표에서 대외 배포용 회사소개서를 받습니다. 발행본은 발행한 때의 파일 그대로입니다.",
        "회사소개서의 숫자는 모두 [[지표 사전]]에서 계산합니다. 계약·인사가 바뀌면 초안에는 바로 들어가고, 발행본에는 검토 후 발행해야 들어갑니다.",
        "관리 권한이 있으면 위쪽 카드로 관리 화면·스튜디오에 가고, 반영 대기와 PDF 만들기를 씁니다.",
      ] },
    ],
    more: { article: "sales.catalog", section: "editions" },
    sources: ["components/sales/catalog/CatalogHomeBoard.tsx"],
    reviewedAt: "2026-10-26",
  },
  {
    id: "catalog.editions",
    label: "회사소개서 발행본 도움말",
    blocks: [
      { kind: "list", items: [
        "대외 배포용으로 확정한 판입니다. [[받기]]로 내려받은 파일을 그대로 보내면 됩니다.",
        "발행본은 발행한 때의 파일 그대로라, 이후 데이터가 바뀌어도 같은 PDF 를 받습니다.",
        "마스킹판은 전 직원이, 실명판은 관리·발행 담당만 받습니다. 실명판 열람·받기는 접속기록에 남습니다.",
        "관리·발행 담당은 배포 기록 칸에서 누구에게 냈는지 남깁니다.",
      ] },
    ],
    more: { article: "sales.catalog", section: "editions" },
    sources: ["components/sales/catalog/CatalogEditionsPanel.tsx"],
    reviewedAt: "2026-10-26",
  },
  {
    id: "catalog.pending",
    label: "반영 대기 도움말",
    blocks: [
      { kind: "list", items: [
        "최근 발행본과 지금 데이터(계약·인물·회사 정보·연혁·인증·인사말/조직도)가 달라진 점입니다.",
        "초안(스튜디오·PDF 만들기)에는 이미 들어 있습니다. 발행하면 발행본에 반영되고 목록이 비워집니다.",
        "1시간마다 저절로 점검하고, 새 항목이 생기면 하루 한 번 담당자에게 알립니다. [[지금 다시 점검]]으로 바로 확인합니다.",
      ] },
    ],
    more: { article: "sales.catalog", section: "pending" },
    sources: ["components/sales/catalog/CatalogPending.tsx"],
    reviewedAt: "2026-10-26",
  },
  {
    id: "catalog.publish",
    label: "회사소개서 발행 도움말",
    blocks: [
      { kind: "list", items: [
        "범위(풀버전·요약본)와 이름 표기(마스킹판·실명판)를 골라 [[발행]]합니다. 지금 데이터와 스튜디오 편집본으로 만듭니다.",
        "마스킹판은 모든 쪽에서 이름 가운데 글자를 ○ 로 바꾸고 사람 사진을 뺍니다. 대표이사만 실명·사진을 그대로 둡니다.",
        "넘침 경고가 있으면 확인을 받습니다([[그래도 발행]]). 발행본은 고치거나 지울 수 없습니다.",
        "배포처를 적으면 배포 기록이 함께 남습니다.",
      ] },
    ],
    more: { article: "sales.catalog", section: "publish" },
    sources: ["components/sales/catalog/CatalogPublishModal.tsx"],
    reviewedAt: "2026-10-26",
  },
  {
    id: "catalog.studio",
    label: "회사소개서 스튜디오 도움말",
    blocks: [
      { kind: "list", items: [
        "왼쪽에서 쪽을 고르고, 가운데 캔버스에서 요소를 눌러 고칩니다. 글은 바로 고칩니다.",
        "고친 것은 자동 저장되고 데이터가 바뀌어도 남습니다. 고치지 않은 숫자·목록은 계속 새 데이터로 바뀝니다.",
        "[[미리보기]]·[[PDF 받기]]는 저장된 편집본으로 만듭니다.",
      ] },
    ],
    more: { article: "sales.catalog-studio", section: "layout" },
    sources: ["components/sales/catalog/studio/CatalogStudio.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.studio-levels",
    label: "고칠 수 있는 범위 도움말",
    blocks: [
      { kind: "list", items: [
        "내용 = 글·사진·목록, 구조 = 숨김·인포그래픽 유형·쪽 변형·열 수, 자유 배치 = 옮기기·크기·글자 크기·색·요소 추가.",
        "자동으로 채우는 쪽은 구조까지, 부록은 글만 고칩니다.",
        "데이터 영역(대표 실적·명단·표 등)의 행은 데이터 화면에서 고칩니다.",
      ] },
    ],
    more: { article: "sales.catalog-studio", section: "levels" },
    sources: ["components/sales/catalog/studio/PanelContent.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.studio-infographic",
    label: "인포그래픽 유형 도움말",
    blocks: [
      { kind: "list", items: [
        "후보는 지금 내용으로 그린 미리보기입니다. 점수가 높을수록 내용·자리에 잘 맞습니다.",
        "'자리 넘침' 후보는 그 자리에 다 들어가지 않습니다. 지금 유형이 넘치면 [[AI로 줄이기]]로 라벨·설명을 줄인 제안을 봅니다.",
        "AI 를 쓸 수 있으면 AI 가 내용의 뜻으로 순서를 다시 매기고 이유를 한 줄 답니다(✦). 아니면 규칙 점수 순입니다.",
        "유형을 바꿔도 항목 내용은 그대로입니다. 목록 ↔ 수치형처럼 모양이 다른 변환은 막습니다.",
      ] },
    ],
    more: { article: "sales.catalog-studio", section: "infographic" },
    sources: ["components/sales/catalog/studio/PanelDesign.tsx", "components/sales/catalog/studio/PanelContent.tsx"],
    reviewedAt: "2026-10-24",
  },
  {
    id: "catalog.studio-ai",
    label: "AI로 수정 도움말",
    blocks: [
      { kind: "list", items: [
        "AI 는 이 쪽의 글·목록·인포그래픽 내용만 바꿉니다. 배치·색·글자 크기는 그대로입니다.",
        "숫자는 지표 칩으로만 씁니다. 지표에 없는 숫자·근거 없는 최상급에는 '검토' 표시가 붙고 기본으로 고르지 않습니다.",
        "채택 전 넘침을 재고, 넘치면 한두 번 자동으로 줄입니다. 고른 곳만 채택되고 버전이 남습니다.",
        "AI 를 쓸 수 없으면 규칙 초안(유형 바꾸기·단계·줄이기)만 만듭니다.",
      ] },
    ],
    more: { article: "sales.catalog-studio", section: "ai" },
    sources: ["components/sales/catalog/studio/AiEditModal.tsx", "components/sales/catalog/studio/AiAreaPanel.tsx"],
    reviewedAt: "2026-10-24",
  },
  {
    id: "catalog.studio-design",
    label: "디자인 탭 도움말",
    blocks: [
      { kind: "list", items: [
        "색 컨셉은 문서 전체의 색 묶음입니다(기본 A 네이비).",
        "색은 디자인 시스템 색, 글자 크기는 디자인 시스템 단계, 폭은 12열 묶음으로만 고릅니다.",
        "옮기기·크기는 그리드에 맞춰 붙습니다. 방향키는 가로 1열·세로 4pt 씩 옮깁니다.",
      ] },
    ],
    more: { article: "sales.catalog-studio", section: "levels" },
    sources: ["components/sales/catalog/studio/PanelDesign.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.studio-fonts",
    label: "서체 세트 도움말",
    blocks: [
      { kind: "list", items: [
        "세트는 제목·본문·숫자 서체 묶음입니다. [[이 세트 적용]]은 문서 전체에 적용합니다.",
        "적용 뒤 문서 전체 넘침과 빠진 글자(라이브러리 세트)를 다시 검사합니다. 넘치거나 빠진 글자가 많으면 [[원래 서체로]] 되돌릴 수 있습니다.",
        "서체 파일은 PDF 에 쓴 글자만 들어가 다른 PC 에서도 같은 모양으로 열립니다.",
      ] },
    ],
    more: { article: "sales.catalog-studio", section: "fonts" },
    sources: ["components/sales/catalog/studio/PanelFonts.tsx"],
    reviewedAt: "2026-10-23",
  },
  {
    id: "catalog.studio-data",
    label: "데이터 탭 도움말",
    blocks: [
      { kind: "list", items: [
        "숫자는 지표 사전에서만 옵니다. 칩으로 묶인 숫자는 데이터가 바뀌면 함께 바뀝니다.",
        "[[지표 넣기]](글 고치는 중 Ctrl+K)로 지표나 회사 정보·기준월 같은 글 항목을 칩으로 넣습니다. 소수 자리·단위를 고를 수 있습니다.",
        "바인딩을 풀면 그 숫자만 지금 값으로 고정됩니다.",
        "데이터 영역은 원천 화면에서 고칩니다.",
      ] },
    ],
    more: { article: "sales.catalog-studio", section: "data" },
    sources: ["components/sales/catalog/studio/PanelData.tsx", "components/sales/catalog/studio/BindPicker.tsx"],
    reviewedAt: "2026-10-26",
  },
  {
    id: "catalog.studio-checks",
    label: "검사 도움말",
    blocks: [
      { kind: "list", items: [
        "넘침 = 글자가 쪽 여백·칸을 넘거나 잘림(PDF 와 같은 검사), 대비 = 글자와 바탕 대비 4.5:1 미만, 해상도 = 인쇄 150dpi 미만(300dpi 권장), 글자 크기 = 7pt 미만.",
        "자동 분쪽 쪽은 캔버스에서 나누지 않으므로 [[전체 쪽 검사]]·미리보기로 봅니다.",
      ] },
    ],
    more: { article: "sales.catalog-studio", section: "layout" },
    sources: ["components/sales/catalog/studio/CatalogStudio.tsx"],
    reviewedAt: "2026-10-22",
  },
  {
    id: "catalog.pdf",
    label: "회사소개서 PDF 도움말",
    blocks: [
      { kind: "list", items: [
        "[[PDF 만들기]]는 지금 데이터로 마스터본을 만듭니다. 보통 1분 안에 끝납니다. 요약본은 부록을 뺍니다.",
        "인쇄·배포본은 검토용 안내문을 숨기고, 작업본은 그대로 보여 줍니다. 실명판에만 부록 C(수행인력 상세 이력)가 붙습니다.",
        "여기서 만든 PDF 는 검토용입니다. 넘침 경고가 0건인지 확인한 뒤 인쇄·배포본 줄의 [[발행]]으로 그대로 발행본이 됩니다(발행 담당).",
      ] },
    ],
    more: { article: "sales.catalog", section: "pdf" },
    sources: ["components/sales/catalog/CatalogRenderPanel.tsx"],
    reviewedAt: "2026-10-26",
  },
  {
    id: "catalog.reference",
    label: "현행 카탈로그 대조 도움말",
    blocks: [
      { kind: "list", items: [
        "현행 카탈로그(2026.06판)에 적힌 수치와 지금 자동 집계를 나란히 봅니다.",
        "차이가 나면 계약 데이터(분류·세분류·허가일)나 인사 데이터를 확인하거나, 정의가 다른 것인지 판단합니다.",
      ] },
    ],
    more: { article: "sales.catalog", section: "reference" },
    sources: ["components/sales/catalog/CatalogReferencePanel.tsx"],
    reviewedAt: "2026-10-22",
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
    id: "catalog.project-label-ai",
    label: "대외 표기 제안 도움말",
    blocks: [
      { kind: "list", items: [
        "자동 표기가 어색한 행만 모읍니다. 직접 정한 표기·검토 완료·통합환경허가 행은 빠집니다.",
        "AI 는 원래 계약명에 없던 숫자나 새 사실을 더하지 않습니다. 걸리면 '확인' 표시가 붙습니다.",
        "비공개 고객은 이름 대신 '○○사'로 보냅니다.",
        "제안 칸을 고쳐 체크한 뒤 확정하면 대외 표기로 저장되고 검토 완료가 됩니다.",
      ] },
    ],
    more: { article: "sales.catalog-projects", section: "list" },
    sources: ["components/sales/catalog/CatalogLabelSuggest.tsx"],
    reviewedAt: "2026-10-24",
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
    id: "catalog.illustrations",
    label: "일러스트 라이브러리 도움말",
    blocks: [
      { kind: "list", items: [
        "보유 스톡 인포그래픽 일러스트를 올려 두면 스튜디오에서 인포그래픽 모양으로 고르거나 쪽 위에 넣습니다.",
        "[[묶음 폴더 가져오기]]는 관리자 PC 매처가 만든 폴더를 통째로, [[SVG 한 장 올리기]]는 정리한 SVG 한 장을 올립니다.",
        "쓰는 쪽이 있는 일러스트는 빼도 지우지 않고 보관합니다.",
      ] },
    ],
    more: { article: "sales.catalog-illustrations", section: "import" },
    sources: ["components/sales/catalog/illustrations/CatalogIllustrationsBoard.tsx"],
    reviewedAt: "2026-10-26",
  },
  {
    id: "catalog.illustrations-use",
    label: "일러스트와 기본 인포그래픽 도움말",
    blocks: [
      { kind: "list", items: [
        "일러스트는 인포그래픽의 모양 하나입니다. 유형은 기본 인포그래픽 16종 중 어느 것과 같은 뜻인지를 나타냅니다.",
        "그림에 항목 수가 고정돼 있어, 스튜디오에서는 항목 수가 같은 인포그래픽 자리에만 후보로 나옵니다.",
        "'추천 자리'는 매처가 매긴 회사소개서 쪽 적합도입니다(상·중·하).",
      ] },
    ],
    more: { article: "sales.catalog-illustrations", section: "studio" },
    sources: ["components/sales/catalog/illustrations/CatalogIllustrationsBoard.tsx"],
    reviewedAt: "2026-10-26",
  },
  {
    id: "catalog.illustrations-import",
    label: "묶음 폴더 도움말",
    blocks: [
      { kind: "list", items: [
        "관리자 PC 에서 asset_matcher.py export 로 만든 폴더를 고릅니다. 영역마다 meta.json·illust.svg·thumb.png 가 있어야 합니다.",
        "같은 일러스트를 다시 올리면 새 판으로 바뀌고, 쪽에서 쓰던 이전 판은 보관됩니다. 이전 판에서 직접 고친 글자 자리·이름·라이선스 메모는 새 판에 이어 붙습니다.",
        "SVG 는 3MB 이하만 받습니다. 넘으면 매처에서 영역을 더 좁히거나(crop) 효과를 걷어 냅니다.",
      ] },
    ],
    more: { article: "sales.catalog-illustrations", section: "import" },
    sources: ["components/sales/catalog/illustrations/IllustrationImportModal.tsx"],
    reviewedAt: "2026-10-26",
  },
  {
    id: "catalog.illustrations-slots",
    label: "글자 자리 도움말",
    blocks: [
      { kind: "list", items: [
        "글자 자리는 스튜디오가 항목 글을 얹는 상자입니다. 역할(제목·설명·번호·숫자·중심)과 항목 번호로 내용과 짝짓고, '내용'에서 얹을 칸(항목 이름·설명·머리글·시점·숫자·중심 문구·제목·비움)을 따로 고를 수 있습니다.",
        "끌어 옮기고 모서리로 크기를 바꿉니다. 방향키 0.5%, Shift 2%, Alt+방향키 크기, Delete 지우기.",
        "글자 크기는 그림 폭에 비례하되 쪽에서 7pt 아래로 내려가지 않습니다.",
        "직접 고친 자리(●)는 같은 일러스트를 다시 가져와도 새 판에 이어 붙습니다. 이름·구입일·메모도 새 판에 값이 없으면 유지됩니다.",
      ] },
    ],
    more: { article: "sales.catalog-illustrations", section: "slots" },
    sources: ["components/sales/catalog/illustrations/IllustrationDetailDrawer.tsx"],
    reviewedAt: "2026-10-26",
  },
  {
    id: "catalog.illustrations-license",
    label: "일러스트 라이선스 도움말",
    blocks: [
      { kind: "list", items: [
        "출처·스톡 번호·라이선스 종류·구입일을 적어 둡니다. Adobe Stock Standard 는 인쇄 50만 부까지의 마케팅 인쇄물·디지털 문서에 쓸 수 있습니다.",
        "구입한 원본 파일은 저작물이라 저장소나 외부에 올리지 않습니다.",
      ] },
    ],
    more: { article: "sales.catalog-illustrations", section: "import" },
    sources: ["components/sales/catalog/illustrations/IllustrationDetailDrawer.tsx"],
    reviewedAt: "2026-10-26",
  },
  {
    id: "catalog.studio-illustration",
    label: "일러스트로 그리기 도움말",
    blocks: [
      { kind: "list", items: [
        "보유 일러스트로 인포그래픽을 그립니다. 항목 수가 같은 일러스트만 후보로 나오고, 같은 유형·이 쪽 추천이 앞에 옵니다.",
        "글자 자리를 캔버스에서 눌러 바로 고칩니다. 숫자 자리는 지표에 묶으면 데이터가 바뀌어도 최신 값입니다.",
        "색은 KESI 토큰·분야 색으로 다시 칠합니다. [[기본 도식으로]] 누르면 원래 인포그래픽으로 돌아갑니다.",
      ] },
    ],
    more: { article: "sales.catalog-illustrations", section: "studio" },
    sources: ["components/sales/catalog/studio/PanelIllustration.tsx"],
    reviewedAt: "2026-10-26",
  },
  {
    id: "catalog.fonts",
    label: "서체 라이브러리 도움말",
    blocks: [
      { kind: "list", items: [
        "회사소개서에 쓸 서체를 올리고 견본을 본 뒤, 제목·본문·숫자 세트를 만듭니다.",
        "[[서체 올리기]]는 분석 → 라이선스 확인 → 등록 순서입니다. 포함 제한 서체는 등록되지 않습니다.",
        "세트 적용은 스튜디오 서체 탭에서 합니다. 서체는 지우지 않고 비활성화합니다.",
      ] },
    ],
    more: { article: "sales.catalog-fonts", section: "upload" },
    sources: ["components/sales/catalog/fonts/CatalogFontsBoard.tsx"],
    reviewedAt: "2026-10-23",
  },
  {
    id: "catalog.fonts-verdict",
    label: "본문 가능·제목 전용 도움말",
    blocks: [
      { kind: "list", items: [
        "본문 가능 = 보통(400)과 굵게(600·700)가 있고 한글 완성형 2,350자를 모두 가진 서체.",
        "제목 전용 = 굵기가 하나뿐이거나 한글이 빠졌거나 장식·손글씨체. 제목·숫자에만 씁니다.",
        "포함 허용은 서체 파일 안 표시(fsType)입니다. 포함 제한이면 PDF 에 넣을 수 없어 등록하지 않습니다.",
      ] },
    ],
    more: { article: "sales.catalog-fonts", section: "verdict" },
    sources: ["components/sales/catalog/fonts/CatalogFontsBoard.tsx", "components/sales/catalog/fonts/FontUploadModal.tsx"],
    reviewedAt: "2026-10-23",
  },
  {
    id: "catalog.fonts-upload",
    label: "서체 올리기 도움말",
    blocks: [
      { kind: "list", items: [
        "같은 서체의 굵기별 파일(보통·굵게 등)을 한 번에 고르면 한 서체로 묶입니다.",
        "고르면 바로 분석만 하고 저장하지 않습니다. 라이선스를 확인한 뒤 [[등록]]해야 저장됩니다.",
        "CFF(OTF)·가변 서체는 PDF 용 파일로 바꾸느라 한 굵기에 1분 안팎 걸립니다.",
      ] },
    ],
    more: { article: "sales.catalog-fonts", section: "upload" },
    sources: ["components/sales/catalog/fonts/FontUploadModal.tsx"],
    reviewedAt: "2026-10-23",
  },
  {
    id: "catalog.fonts-license",
    label: "서체 라이선스 도움말",
    blocks: [
      { kind: "list", items: [
        "회사소개서는 PDF 로 배포하므로 'PDF 포함(임베딩)'이 허용된 서체만 등록할 수 있습니다.",
        "구매 서체는 구입처·계약 번호·허용 범위를 증빙 메모로 남겨야 합니다.",
        "서체 파일 안 라이선스 문구가 OFL 이면 미리 채워 두지만, 확인은 올리는 사람이 합니다.",
      ] },
    ],
    more: { article: "sales.catalog-fonts", section: "upload" },
    sources: ["components/sales/catalog/fonts/FontUploadModal.tsx"],
    reviewedAt: "2026-10-23",
  },
  {
    id: "catalog.fonts-specimen",
    label: "서체 견본 도움말",
    blocks: [
      { kind: "list", items: [
        "굵기별 한글·영문·숫자와 본문 단락·표·큰 숫자를 문서와 같은 크기 보정으로 그립니다.",
        "빨간 줄이 그어진 문서 기호는 이 서체에 없어 대체 서체로 그려집니다.",
        "견본 위에 읽기 실패 알림이 나오면 서체 파일을 다시 올려 주세요.",
      ] },
    ],
    more: { article: "sales.catalog-fonts", section: "specimen" },
    sources: ["components/sales/catalog/fonts/FontDetailDrawer.tsx"],
    reviewedAt: "2026-10-23",
  },
  {
    id: "catalog.fonts-sets",
    label: "서체 세트 만들기 도움말",
    blocks: [
      { kind: "list", items: [
        "세트 = 제목·본문·숫자 서체 + 디자인 굵기(400·500·600·700)마다 쓸 파일 굵기.",
        "본문에는 '제목 전용' 서체와 Light·Thin 굵기를 쓸 수 없습니다. 명조 본문은 화면에서 읽기 어렵다고 알려 줍니다.",
        "만든 세트는 스튜디오 서체 탭에서 실제 쪽으로 비교하고 적용합니다.",
      ] },
    ],
    more: { article: "sales.catalog-fonts", section: "sets" },
    sources: ["components/sales/catalog/fonts/CatalogFontsBoard.tsx", "components/sales/catalog/fonts/FontSetEditor.tsx", "components/sales/catalog/studio/PanelFonts.tsx"],
    reviewedAt: "2026-10-23",
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
