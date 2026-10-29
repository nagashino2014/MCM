/*
 * 회사소개서 마스터본 작성 콘텐츠 기본안 — 클라이언트 안전(상수만).
 * 숫자는 여기에 쓰지 않는다(지표·데이터에서 채운다). 여기 있는 것은 사람이 쓰는 문안·목록·도식 내용이다.
 * 출처: P2 쪽 유형 목업(https://claude.ai/artifact/2bMEZ7oMfZbNUfCtswStMb, 현행 카탈로그 2026.06·2026.09.08 문안을 다듬은 것).
 *   장외·화관법·HAPs·환경 인허가·연구·교육 쪽은 목업이 없어 현행 카탈로그 3·11쪽 사업 목록으로 쓴 초안이다(draft: true → 작업본에 초안 표시).
 * 스튜디오(P5)·LLM 편집(P6)이 생기면 이 기본안은 문서별 편집본(catalog_pages)의 초깃값이 된다.
 */

export interface AreaContent {
  /** 분야 아이콘(lucide 이름, 디자인 시스템 README §아이콘) */
  icon: string;
  lead: string;
  services: string[];
  processTitle: string;
  process: Array<{ label: string; desc: string }>;
  /** 사업 분야 개관(C08) 카드의 세 줄 */
  overview: string[];
  /** 대표 실적 머리 오른쪽 말 */
  casesAside: string;
  /** 사진 없는 변형의 큰 숫자 설명 */
  heroCaption: string;
  /** 사진 없는 변형의 큰 숫자를 지표 대신 작성 수치로(근거가 있는 사례 수치) */
  heroFigure?: { value: string; unit: string };
  /** 목업 없이 쓴 초안 */
  draft?: boolean;
  /** 대표 성과(전후 비교) — ESG */
  compare?: { title: string; aside: string; rows: Array<{ label: string; before: string; after: string; beforePct: number; afterPct: number }> };
  /** 분야 KPI 중 지표가 없는 작성 수치(근거가 있는 것만) */
  extraKpis?: Array<{ label: string; value: string; unit: string }>;
  footnote?: string;
}

export const AREA_CONTENT: Record<string, AreaContent> = {
  통합환경허가: {
    icon: "factory",
    lead: "배출시설이 있는 사업장이 환경오염시설법에 따라 받는 통합환경허가를 사전 진단과 계획서 작성부터 허가 취득, 사후관리와 재검토까지 대행합니다.",
    services: [
      "통합환경관리계획서 작성·허가 신청",
      "사전협의와 허가조건(배출기준·측정 주기) 협의",
      "변경허가·변경신고",
      "허가 재검토 대응",
      "정기검사 대응·현장 진단",
      "사후관리 가이드북·실무 교육",
      "소규모 사업장 지원사업 대행",
    ],
    processTitle: "수행 절차",
    process: [
      { label: "사전 진단", desc: "공정·물질수지와 배출시설 현황 파악" },
      { label: "계획서 작성", desc: "통합환경관리계획서·배출영향분석" },
      { label: "사전협의·신청", desc: "허가조건 협의, 보완 대응" },
      { label: "허가 취득", desc: "허가 결정·결정번호 발급" },
      { label: "사후관리", desc: "정기검사·변경·재검토 대응" },
    ],
    overview: ["통합환경허가 최초허가·변경허가·변경신고", "허가 재검토·정기검사 대응", "사후관리 컨설팅(연간 가이드북·교육)"],
    casesAside: "허가일 · 결정번호",
    heroCaption: "통합환경허가 누적 수행(최초·변경·재검토)",
  },
  "장외·화관법": {
    icon: "flask-conical",
    lead: "화학물질관리법에 따라 유해화학물질을 다루는 사업장이 갖춰야 하는 화학사고 예방관리계획서와 영업허가·설치검사·정기검사를 대행합니다.",
    services: [
      "화학사고 예방관리계획서 작성·이행 점검 대응",
      "유해화학물질 영업허가(제조·사용·판매·보관저장)",
      "취급시설 설치검사·정기검사 대행",
      "공정안전보고서(PSM)·유해위험방지계획서",
      "화학물질 확인·통계조사·배출량조사 대응",
    ],
    processTitle: "수행 절차",
    process: [
      { label: "현황 조사", desc: "취급 물질·시설 목록과 사용량 확인" },
      { label: "위험도 분석", desc: "사고 시나리오·영향 범위 산정" },
      { label: "계획서 작성", desc: "예방관리계획서·영업허가 서류" },
      { label: "제출·심사", desc: "화학물질안전원 검토 보완 대응" },
      { label: "검사·이행", desc: "설치·정기검사, 이행 점검" },
    ],
    overview: ["화학사고 예방관리계획서", "유해화학물질 영업허가·설치검사·정기검사", "공정안전보고서(PSM)·유해위험방지계획서"],
    casesAside: "고객 · 수행 기간",
    heroCaption: "장외·화관법 누적 수행",
    draft: true,
  },
  "HAPs 용역": {
    icon: "wind",
    lead: "대기환경보전법의 비산배출시설 관리 기준에 따라 신고서와 정기점검 보고서를 작성하고, 사업장의 누출 관리 체계를 함께 만듭니다.",
    services: [
      "비산배출시설 설치신고·변경신고",
      "정기점검 결과보고서 작성",
      "비산누출시설 관리 체계(LDAR) 구축",
      "공정·저장시설 배출량 산정",
      "화학물질 배출량 진단·저감 방안",
    ],
    processTitle: "수행 절차",
    process: [
      { label: "대상 확인", desc: "업종·물질·시설 기준 검토" },
      { label: "시설 조사", desc: "공정·저장·누출시설 목록 작성" },
      { label: "신고서 작성", desc: "비산배출시설 설치·변경신고" },
      { label: "정기점검", desc: "측정·누출 점검 결과 정리" },
      { label: "보고·개선", desc: "점검보고서 제출, 저감 방안" },
    ],
    overview: ["비산배출시설 신고·정기점검 보고서", "비산누출시설 구축", "화학물질 배출량 진단"],
    casesAside: "고객 · 수행 기간",
    heroCaption: "HAPs 신고·점검보고 누적 수행",
    draft: true,
  },
  "ESG·탄소중립": {
    icon: "leaf",
    lead: "ESG 경영보고서와 공급망 실사 대응, 온실가스 산정과 감축사업, 탄소중립 로드맵까지 통합환경허가에서 쌓은 환경 진단 경험으로 수행합니다.",
    services: [
      "ESG 경영보고서(국·영문) 작성·공시 지원",
      "공급망 ESG 실사·평가 대응",
      "탄소국경조정제도(CBAM) 대응",
      "온실가스 배출량 산정·명세서 작성",
      "감축사업 발굴·외부사업 배출권 인증",
      "녹색인증·탄소발자국·환경성적표지·LCA",
    ],
    processTitle: "ESG 경영보고서 수행 절차",
    process: [
      { label: "현황 진단", desc: "K-ESG 지표 기준 경영 수준 진단" },
      { label: "중대성 평가", desc: "내·외부 환경 분석, 이중 중대성" },
      { label: "목표·로드맵", desc: "Scope 1·2 감축량, 2050 탄소중립" },
      { label: "보고서 작성", desc: "국·영문 보고서, 자체 플랫폼" },
      { label: "검증·공시", desc: "제3자 검증(온실가스·보고서)" },
    ],
    overview: ["ESG 경영보고서·공급망 실사·CBAM 대응", "온실가스 산정·감축사업 발굴·배출권 인증", "탄소중립 시나리오·로드맵 연구"],
    casesAside: "발주 기관 · 수행 기간",
    heroCaption: "공급망 ESG 평가 총점(고객사, 2023 → 2024)",
    heroFigure: { value: "58.4 → 87.0", unit: "점" },
    compare: {
      title: "대표 성과",
      aside: "자동차부품 중견기업 S·P사",
      rows: [
        { label: "공급망 평가 총점", before: "2023 58.4", after: "2024 87.0점", beforePct: 67, afterPct: 100 },
        { label: "평가 순위", before: "2023 상위 69%", after: "상위 3%", beforePct: 100, afterPct: 34 },
      ],
    },
    extraKpis: [
      { label: "S·G 분야 전문가", value: "6", unit: "명" },
      { label: "감축 활용 특허", value: "1", unit: "건" },
    ],
    footnote: "2025 한국ESG경영대상 'THE BEST ESG' 최우수상(2025.08). 고객사 이름은 공개 동의를 받은 경우에만 실명으로 표기합니다.",
  },
  "기타 용역": {
    icon: "graduation-cap",
    lead: "대기·수질·폐기물 배출시설의 개별 인허가와 대기총량 신고, 정부·공공기관 연구 용역과 사업장 환경교육을 수행합니다.",
    services: [
      "대기·수질·폐기물 배출시설 설치허가·신고 대행",
      "대기오염물질 총량관리사업장 신고 대행",
      "스마트 생태공장 등 국고지원사업 대행",
      "정부·공공기관 발주 연구 용역",
      "사업장·협회 환경 실무 교육",
      "환경법률 컨설팅(내·외부 전문가)",
    ],
    processTitle: "수행 절차",
    process: [
      { label: "요구 정리", desc: "사업장 여건·일정·대상 시설 확인" },
      { label: "기준 검토", desc: "법령·지침·허가 기준 검토" },
      { label: "서류·연구", desc: "인허가 서류 작성, 연구 수행" },
      { label: "협의·제출", desc: "관할 기관 협의, 보완 대응" },
      { label: "교육·지원", desc: "실무 교육, 사후 문의 대응" },
    ],
    overview: ["대기·수질·폐기물 개별 배출시설 인허가", "대기총량관리 사업장 신고", "환경 R&D·국고지원사업 대행·환경교육"],
    casesAside: "발주처 · 수행 기간",
    heroCaption: "환경 인허가·연구·교육 누적 수행",
    draft: true,
  },
};

export const COVER_CONTENT = {
  eyebrow: "환경컨설팅 · 연구전문기관",
  title: "회사소개서",
  titleEn: "Company Profile",
  tagline: "환경개선, 기후변화 대응 및 적응을 아우르는 종합 환경컨설팅으로 사업장 여건에 맞는 환경관리 체계를 함께 만듭니다.",
  photoAlt: "본사 사옥(에이스골드타워)",
  photoCaption: "본사 사옥 · 서울 가산 에이스골드타워",
  /** G 연구소형 표지(research 템플릿)의 머리말·부제(부설연구소 이름) */
  researchEyebrow: "COMPANY INTRODUCTION",
  researchSub: "탄소중립 미래연구소",
};

export const VISION_CONTENT = {
  statement: ["고객에게 최고의 가치를", "제공하는 기업"],
  lead: "환경개선, 기후변화 대응 및 적응을 아우르는 종합 환경컨설팅 기업입니다. 허가 취득부터 사후관리까지 사업장 여건에 맞는 환경관리 체계를 함께 만듭니다.",
  philosophy: [
    { title: "신뢰", en: "Trust", desc: "고객과 한 번 약속한 사항은 반드시 지키는 책임경영을 실천하겠습니다." },
    { title: "혁신", en: "Innovation", desc: "변화에 신속히 대응해 새로운 업무 방식과 문제해결 능력을 키우겠습니다." },
    { title: "소통", en: "Communication", desc: "직원 간, 고객과 열린 마음으로 소통해 이해와 협조를 높이겠습니다." },
    { title: "노력", en: "Effort", desc: "기술과 경험을 쏟아 고객이 원하는 문제를 해결해 드리겠습니다." },
  ],
  research: "탄소중립 미래연구소(기업부설연구소)",
  backSub: ["환경개선 · 기후변화 대응 및 적응 종합 환경컨설팅", "허가 취득부터 사후관리까지 사업장 여건에 맞는 환경관리 체계를 함께 만듭니다."],
  nameEn: "Korean Environment Safety Institute Co., Ltd.",
  nameShort: "KESI",
};

/** 지사 — 회사 프로필에 지사 칸이 없어 여기 둔다(본사 주소·전화는 회사 프로필에서). */
export const OFFICE_CONTENT = {
  hq: {
    name: "서울 본사",
    nameEn: "HEAD OFFICE",
    lon: 126.8826,
    lat: 37.4778,
    transit: [
      { label: "지하철", text: "1·7호선 가산디지털단지역 7번 출구에서 걸어서 7분" },
      { label: "버스", text: "지선 5537, 마을 금천03·금천07 하차 후 걸어서 약 400m" },
    ],
    photoCaption: "에이스골드타워 12층",
  },
  branches: [
    {
      key: "ulsan",
      name: "울산 지사",
      nameEn: "ULSAN BRANCH",
      address: "울산광역시 남구 테크노산업로55번길 14, 울산과학기술원 산학융합원 기업연구관 204호",
      addressLines: ["울산광역시 남구 테크노산업로55번길 14", "산학융합원 기업연구관 204호"],
      phone: "052-258-1064",
      lon: 129.3114,
      lat: 35.5384,
      transit: [] as Array<{ label: string; text: string }>,
    },
  ],
};

export const SECTIONS = [
  { key: "01", anchor: "sec-01", name: "회사 소개", desc: "대표이사 인사말 · 숫자로 보는 KESI · 회사 개요·비전 · 연혁" },
  { key: "02", anchor: "sec-02", name: "사업 분야", desc: "사업 분야 개관 · 분야별 상세 6개" },
  { key: "03", anchor: "sec-03", name: "핵심 역량", desc: "핵심 역량 · 대표 성공 사례" },
  { key: "04", anchor: "sec-04", name: "조직과 사람", desc: "조직 · 임원진 · 기술인력 · 자문위원" },
  { key: "05", anchor: "sec-05", name: "신뢰 근거", desc: "인증·등록·특허 · 주요 고객사·협력 기관" },
  { key: "06", anchor: "sec-06", name: "오시는 길", desc: "서울 본사 · 울산 지사" },
  { key: "부록", anchor: "sec-app", name: "수행실적·인력", desc: "A 수행실적 총괄 · B 분야별 수행실적 목록 · C 수행인력 상세 이력" },
] as const;

export const DIVIDER_CONTENT = {
  "02": {
    lead: "환경 컨설팅 5개 분야(계약 관리 분류)와 응용소프트웨어로 사업을 나눕니다. 분야마다 주요 서비스, 수행 절차, 실적 수치와 대표 실적을 정리했습니다.",
  },
  "03": {
    lead: "통합환경허가에서 쌓은 실적과 사람, 진단에서 사후관리까지 이어지는 일하는 방법을 정리했습니다. 대표 성공 사례에서 그 과정을 보여 드립니다.",
  },
};

export const ORBIT_CENTER = ["환경개선 · 기후변화", "대응 및 적응", "종합 환경컨설팅"];

export const SOFTWARE_CONTENT = {
  eyebrow: "응용소프트웨어 개발·공급",
  title: "컨설팅 현장의 업무를 소프트웨어로 만듭니다",
  lead: "통합환경허가·ESG 컨설팅과 회사 운영에 쓰는 웹 기반 도구 3종을 직접 개발합니다. 세 제품 모두 KESI의 실제 업무로 먼저 검증합니다.",
  products: [
    {
      name: "그룹웨어 & ERP",
      icon: "layout-grid",
      area: 0,
      status: "사내 실사용 테스트 중",
      pitch: "결재 문서의 모든 정보를 DB로 연결해 경영 현황을 한눈에",
      points: [
        "전자결재 문서 속 출장·휴가·인사·회계 정보를 완전 DB화해 임원진이 바로 조회",
        "바로빌 연동 세금계산서 발행·조회와 계좌·카드 내역 수집, 영수증 OCR로 지출결의 간편 상신",
        "공문·견적·계약서·착수/준공계·증명서 작성과 전송을 웹앱 하나로",
      ],
      whenLabel: "정식 출시",
      when: "2027년 초",
    },
    {
      name: "통합허가 계획서 플랫폼",
      icon: "factory",
      area: 1,
      status: "개발 중",
      pitch: "주력인 통합환경허가 업무를 시설 DB 중심으로 자동화",
      points: [
        "도면·명세서·허가 서류를 PDF OCR·문서 분석으로 자동 분류·DB화",
        "TMS·SEMS·토지이용규제·환경공간정보를 API로 수집해 계획서에 자동 삽입",
        "물질수지 검증·통합공정도 작도·BAT 매칭 자동화로 시간 단축과 Human Error 방지",
      ],
      whenLabel: "1차 릴리스",
      when: "2026.12",
    },
    {
      name: "ESG 통합관리 플랫폼",
      icon: "leaf",
      area: 4,
      status: "개발 중",
      pitch: "ESG·탄소중립 업무와 데이터를 한 곳에서",
      points: ["지속가능경영보고서 작성 업무 효율화", "공급망 실사·LCA 대응", "온실가스 감축목표제 대응", "ESG·탄소중립 분야별 데이터를 DB로 관리"],
      whenLabel: "개발 완료",
      when: "2027년 초",
    },
  ],
  milesAside: "2026년 9월 기준 계획",
  miles: [
    { when: "2026.12", text: "통합허가 계획서 플랫폼 1차 릴리스", area: 0 },
    { when: "2027년 초", text: "그룹웨어 & ERP 정식 출시", area: 0 },
    { when: "2027년 초", text: "ESG 통합관리 플랫폼 개발 완료", area: 4 },
    { when: "2027 하반기", text: "계획서 플랫폼 폐쇄망 에디션", area: 0 },
  ],
  note: "그룹웨어 & ERP는 이 앱(MCM)입니다. 일정은 계획이며 바뀌면 이 쪽을 고칩니다.",
};

export const PLATFORM_CONTENT = {
  eyebrow: "응용소프트웨어 · 통합허가 계획서 플랫폼",
  title: "통합환경관리계획서를 하나의 시설 DB에서 만듭니다",
  badge: "개발 중 · 2026년 12월 1차 릴리스",
  sources: ["사업장 자료", "외부 API", "법령·BAT 기준서"],
  steps: [
    { num: "01", icon: "scan-line", title: "접수자료 수집·분석", items: ["도면·명세서·허가증 수집", "PDF OCR 자동 분류", "필요자료 요청·수령 관리"] },
    { num: "02", icon: "database", title: "시설 마스터 DB", items: ["시설 관리번호 자동 채번", "TMS·SEMS 등 API 수집", "허가·자가측정 이력 통합"], core: true },
    { num: "03", icon: "calculator", title: "자동 산정·작도", items: ["물질수지 산정·검증", "통합공정도 자동 작도", "BAT·허가배출기준 산정"] },
    { num: "04", icon: "file-text", title: "계획서·서식 생성", items: ["1–8장 한글·PDF", "허가시스템 엑셀 20종", "전후 비교표·첨부"] },
    { num: "05", icon: "file-check", title: "검토·제출·이력", items: ["장 간 정합성 자동 검증", "통합환경허가시스템 제출", "변경허가·재검토 판본"] },
  ],
  loop: "검토의견·변경허가 → 원천까지 추적해 다시 생성",
  automation: [
    { icon: "scan-line", title: "OCR 자료 분류", desc: "도면·명세서·허가증 PDF에서 시설·배출구 추출" },
    { icon: "cloud-download", title: "외부 API 자동 수집", desc: "TMS·SEMS·토지이용규제·환경공간정보" },
    { icon: "scale", title: "물질수지 검증", desc: "투입·산출 매칭, 장 간 값 일치 확인" },
    { icon: "workflow", title: "통합공정도 자동 작도", desc: "공정·방지시설·배출구 연결에서 도면 생성" },
    { icon: "list-checks", title: "BAT 자동 매칭", desc: "업종별 기준서 항목과 시설 대응·근거 연결" },
    { icon: "file-spreadsheet", title: "한글·엑셀 자동 생성", desc: "hwpx 1–8장 + 업로드 서식 20종 동시 산출" },
  ],
  effects: [
    { title: "시간", desc: "자료 분류·분석 시간 대폭 단축" },
    { title: "품질", desc: "정합성 자동 검증으로 오류 방지" },
    { title: "자산", desc: "허가 이력 DB로 변경허가 즉시 대응" },
  ],
  miles: [
    { when: "2026.09", text: "설계 확정 · PoC 33건", done: true },
    { when: "2026.12", text: "1차 릴리스", done: false },
    { when: "2027 상반기", text: "전 업종·재검토", done: false },
    { when: "2027 하반기", text: "폐쇄망 에디션", done: false },
  ],
  /** {initial}·{industries} 는 지표 값으로 채운다 */
  caption: "{industries}개 업종 {initial}개소 통합허가 수행 실적(계획서·검토결과서)을 정답지로 검증합니다 · 클라우드·온프레미스·폐쇄망을 같은 코드로 지원합니다.",
};

export const STRENGTHS_CONTENT = {
  title: "신속한 허가 진행과 사업장 여건에 맞는 환경관리 체계",
  results: { head: "{industries}개 업종에서 허가를 직접 받아 냈습니다", chipsLabel: "주요 수행 업종" },
  people: {
    head: "공정과 제도를 함께 아는 전문가가 직접 맡습니다",
    process: { value: "5", unit: "명", label: "공정전문가", desc: "환경·화학 분야 경력 30년 이상. 공정과 물질수지를 직접 파악합니다." },
    leaders: { label: "임원 평균 경력", desc: "환경부·한국환경공단에서 일한 경험으로 허가조건을 협의합니다." },
    advisors: { label: "매체별 자문위원", desc: "대기·악취·수질·폐기물·토양·소음진동·측정기기·법률 등 분야별로 자문합니다." },
  },
  method: {
    head: "방법 · 진단에서 사후관리까지 한 흐름으로",
    steps: [
      { tag: "진단", icon: "search-check", title: "자체 진단 매뉴얼", desc: "환경 현황과 공정·물질수지를 매뉴얼에 따라 정확히 파악해 허가를 신속하게 진행합니다.", proof: "자체 개발 진단 매뉴얼" },
      { tag: "협의", icon: "scale", title: "사업장 여건에 맞춘 허가조건", checks: ["SCR 설치 면제", "배출기준 완화", "자가측정 주기 완화"] },
      { tag: "사후관리", icon: "refresh-cw", title: "허가 이후까지 함께", desc: "연간 가이드북과 사후관리 교육, 정기검사 대응과 현장 진단을 이어 갑니다.", proof: "정기검사 대응 4개 사업장" },
    ],
    loop: "허가 재검토 때는 다시 진단부터",
  },
};

export const CASE_CONTENT = {
  num: "01",
  eyebrow: "대표 성공 사례 · 통합환경허가",
  title: "2차전지 양극재 신규 공장, 6개 인허가를 함께 받다",
  badges: ["울산 · 화학(무기화학)", "2024.03–2025.04", "통합허가 제1316-01호"],
  steps: [
    { head: "과제", text: "신규 공장 가동 전에 통합환경허가와 함께 폐기물·대기·잔류성오염물질 관련 인허가를 모두 마쳐야 했습니다." },
    { head: "접근", text: "통합환경관리계획서를 작성하고, 지정폐기물 재활용업 변경허가와 총량관리사업장 설치허가 등 관련 절차를 함께 진행했습니다." },
    { head: "성과", text: "2025년 4월 통합환경허가(결정번호 제1316-01호)를 받고 관련 인허가 5건을 마쳤습니다. 이후 변경 컨설팅을 이어서 수행 중입니다." },
  ],
  permitsTitle: "받은 인허가 6건",
  permits: [
    { label: "통합환경허가 취득", law: "환경오염시설법 제6조" },
    { label: "지정폐기물 종합재활용업 변경허가", law: "폐기물관리법 제25조" },
    { label: "총량관리사업장 설치허가", law: "대기관리권역법 제15조" },
    { label: "폐기물배출자 신고", law: "폐기물관리법 제17조" },
    { label: "지정폐기물 처리계획 확인", law: "폐기물관리법 제17조제5항" },
    { label: "관리대상기기 신고", law: "잔류성오염물질 관리법 제24조" },
  ],
  kpis: [
    { label: "함께 받은 인허가", value: "6", unit: "건" },
    { label: "수행 기간", value: "13", unit: "개월" },
    { label: "관련 법령", value: "4", unit: "개" },
  ],
  list: [
    { num: "01", title: "울산 2차전지 양극재 신규 공장", sub: "통합환경허가 외 5건", area: 1, lon: 129.36, lat: 35.43 },
    { num: "02", title: "광양제철소 자율환경관리 이행", sub: "대표 공정 10개소 서류·현장 진단", area: 1, lon: 127.73, lat: 34.92 },
    { num: "03", title: "강릉안인화력 1·2호기 통합허가", sub: "유연탄 신규 발전소", area: 1, lon: 128.99, lat: 37.73 },
    { num: "04", title: "자동차부품 2개사 ESG 대응", sub: "공급망 평가 58.4 → 87.0점 · 지역 비공개", area: 4, lon: null, lat: null },
    { num: "05", title: "국립공원공단 지속가능경영보고서", sub: "K-ESG 69개 지표 진단", area: 4, lon: 127.95, lat: 37.34 },
    { num: "06", title: "한국환경공단 2040 탄소중립 로드맵", sub: "시나리오·로드맵 연구", area: 4, lon: 126.63, lat: 37.55 },
  ],
};

/** 부록 A 총괄표 분류 설명(띠 행) */
export const MATRIX_DESC: Record<string, string> = {
  통합환경허가: "최초·변경허가, 변경신고, 사후관리, 재검토",
  "장외·화관법": "화학사고 예방관리계획서, 유해화학물질 영업허가·설치·정기검사",
  "HAPs 용역": "신고·점검보고",
  "ESG·탄소중립": "ESG 경영보고서, 탄소중립·기후변화 용역",
  "기타 용역": "개별 인허가, 대기총량, R&D, 교육",
  응용소프트웨어: "그룹웨어 & ERP, 통합허가 계획서 플랫폼, ESG 통합관리 플랫폼 — 공급 계약부터 집계",
};

/** 소개서 분야 표기명 기본값(catalog_business_areas.display_name 이 없을 때) */
export const AREA_DISPLAY_NAME: Record<string, string> = {
  "HAPs 용역": "HAPs(비산배출)",
  "기타 용역": "환경 인허가·연구·교육",
};

/** 고객사 분류 → 로고 월 묶음 이름 */
export const CLIENT_GROUP_LABEL: Record<string, { label: string; sub: string }> = {
  공공: { label: "정부·공공기관", sub: "발주·협력" },
  민간: { label: "민간 사업장", sub: "통합환경허가·화관법·HAPs" },
  협회: { label: "협회·단체", sub: "ESG·교육" },
};
