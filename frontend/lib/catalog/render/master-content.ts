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

// ── 연구소·ESG 제안형(research 템플릿) 전용 문안 ──
// 출처: 사용자 제공 양식 "[한국환경안전연구원] 회사소개서_260928.pdf"(2026-09-28, 26쪽, 탄소중립 미래연구소 명의). 쪽 순서·도식은 그 양식을 따른다.
// 회사 숫자(인원·매출·실적·경력)는 여기에 쓰지 않고 데이터에서 채운다. 여기 있는 숫자는 제도 동향(공시 기준 연도·대상 자산 등)뿐이며
// 양식 기준월(RESEARCH_CONTENT.asOf)의 내용이라 발행 전에 최신 제도를 확인한다(작업본 안내문).

/** research 쪽 계획의 섹션(목차 I~VIII · 쪽 머리 01~08) — 쪽의 section 은 key("R1"…), 목차 링크 앵커는 anchor */
export const RESEARCH_SECTIONS = [
  { key: "R1", num: "01", roman: "I", anchor: "sec-r1", name: "회사개요", desc: "일반현황, 주요연혁, 경영철학 및 비전, 등록증 보유현황" },
  { key: "R2", num: "02", roman: "II", anchor: "sec-r2", name: "사업분야", desc: "환경 인허가 컨설팅, 기후변화 대응, 환경기술 R&D, 교육 및 환경컨설팅 등" },
  { key: "R3", num: "03", roman: "III", anchor: "sec-r3", name: "핵심역량(특장점)", desc: "탄소중립 특허 보유, ESG 보고서 플랫폼 보유, 녹색채권 컨설팅 연계 등" },
  { key: "R4", num: "04", roman: "IV", anchor: "sec-r4", name: "ESG 컨설팅 개요", desc: "ESG 개념, 도입배경 및 중요성, ESG 경영보고서 기대효과" },
  { key: "R5", num: "05", roman: "V", anchor: "sec-r5", name: "ESG 국내외 동향", desc: "ESG 국내 동향 및 국외 동향" },
  { key: "R6", num: "06", roman: "VI", anchor: "sec-r6", name: "ESG 경영보고서 작성 개요", desc: "ESG 경영보고서 작성 절차, 중대성 평가 수행, ESG 경영보고서 작성" },
  { key: "R7", num: "07", roman: "VII", anchor: "sec-r7", name: "ESG 분야별 전문인력 현황", desc: "임원 이력 현황, 분야별 참여인력 현황" },
  { key: "R8", num: "08", roman: "VIII", anchor: "sec-r8", name: "용역 수행실적", desc: "ESG 경영 컨설팅, 기타 연구 용역 수행 실적" },
] as const;

export const RESEARCH_CONTENT = {
  /** 동향·제도 문안의 기준월(양식 날짜) — 작업본 안내문에 쓴다 */
  asOf: "2026년 9월",
  /** 일반현황 표의 사업분야 칸(strong = 양식에서 파란 글자로 강조한 줄) */
  businessLines: [
    { text: "통합환경허가 대행", strong: true },
    { text: "대기총량·HAPs(비산배출) 신고 및 점검보고서 작성 대행" },
    { text: "화학사고예방관리계획서 작성, 설치검사, 영업허가 대행", strong: true },
    { text: "대기, 수질, 폐기물 배출시설 설치 허가 대행" },
    { text: "ESG 경영보고서, 공급망 실사, 탄소국경조정세 대응", strong: true },
    { text: "온실가스 감축사업 발굴 및 외부감축사업 배출권 인증 대행" },
    { text: "환경기술 R&D, 환경교육 컨설팅" },
    { text: "환경성적표지, 탄소발자국 인증, 환경전과정평가(LCA)" },
    { text: "응용소프트웨어 개발·공급업" },
  ] as Array<{ text: string; strong?: boolean }>,
  /** 사업분야 4분면(양식 4쪽) — 위 왼쪽·위 오른쪽·아래 왼쪽·아래 오른쪽 순서. area = 조각 색(분야 색 슬롯) */
  business: [
    {
      title: "국내·외 환경 인허가 컨설팅",
      icon: "factory",
      area: 4,
      items: [
        "통합환경허가 취득 지원 및 사후관리",
        "화관법, 화평법 대응(화학사고예방관리, 화학물질등록 등)",
        "HAPs(비산배출) 신고 대응",
        "대기총량관리 사업장 신고 컨설팅",
        "산업안전보건법 대응(PSM, 유해위험방지계획서)",
        "기타 환경인허가(대기·수질, 폐기물, 악취, 소음·진동 등 개별법, 재활용환경성평가 등)",
        "개도국 진출 환경산업 신규 발굴 및 기술지원",
      ],
    },
    {
      title: "ESG, 탄소중립 컨설팅",
      icon: "thermometer",
      area: 1,
      items: [
        "ESG 경영보고서, 공급망 실사, 탄소국경조정제도(CBAM) 대응, LCA평가",
        "온실가스 배출량 산정, 명세서 작성",
        "온실가스 감축사업 발굴 및 배출권 인증",
        "온실가스 감축설비 지원 컨설팅",
        "녹색기술, 녹색인증, 탄소발자국 컨설팅",
        "환경성적표지 인증",
      ],
    },
    {
      title: "대기·수질 등 방지시설 설치지원(협력사)",
      icon: "globe",
      area: 6,
      items: ["고효율, 저비용 전기집진기, 여과집진기, NOx저감설비", "고효율, 저비용 RTO설비", "폐수, 하수처리설비", "비점오염저감설비", "대기배출시설 사물인터넷(IoT) 부착지원"],
    },
    {
      title: "환경기술 R&D, 교육 및 환경컨설팅",
      icon: "lightbulb",
      area: 3,
      items: ["환경 신기술, 특허, 제품화 연구", "스마트 생태공장 등 소규모 국고지원사업 대행", "사업장 환경위해성 평가 대응", "상하수도, 폐수처리설비 설치 R&D", "대기배출시설 사물인터넷(IoT) 부착 지원"],
    },
  ],
  /** 사업분야 가운데 원(양식 그대로 세 줄) */
  businessCenter: ["환경개선", "기후변화 대응 및 적응", "종합 환경컨설팅"],
  /** 핵심역량 쪽 머리 문장(회사 프로필 슬로건이 있으면 그것) */
  slogan: "환경과 경제의 상생을 통한 지속가능한 발전을 추구하는 종합환경컨설팅",
  /** 핵심역량 카드 4장 — {leaderMax}·{advisors}·{patent} 는 데이터로 채운다(값이 없으면 그 줄을 뺀다) */
  strengths: [
    { icon: "users", title: "관련분야 전문가 보유", items: ["기후변화, 탄소중립 {leaderMax}년 경력 전문가 보유(환경부·환경공단 경력)", "분야별 자문위원 {advisors}명 보유"] },
    { icon: "sprout", title: "환경 분야 전문성 강화", items: ["우수한 통합환경허가 경험을 바탕으로 ESG 중 환경(E) 분야에 대한 정밀한 진단을 통해 개선방안 제시"] },
    { icon: "presentation", title: "탄소중립 특허 보유 등", items: ["{patent} 보유", "탄소중립 녹색성장 온실가스 감축사업 발굴 등 컨설팅"] },
    { icon: "file-search", title: "ESG 보고서 플랫폼 보유", items: ["ESG 경영보고서 KESI 자체 플랫폼 보유"] },
  ],
  /** IV-1 ESG 개념(양식 6쪽) */
  concept: {
    title: "ESG 개념",
    lead: "환경(Environmental), 사회(Social), 지배구조(Governance)의 약자로 기업 경영활동을 환경경영, 사회적 책임, 건전하고 투명한 지배구조에 초점을 둔 지속가능성(Sustainability)을 달성하기 위한 기업 경영의 3가지 핵심 요소를 의미",
    cols: [
      {
        name: "환경",
        en: "Environmental",
        icon: "sprout",
        area: 4,
        desc: "기업의 경영활동 과정에서 발생하는 환경 영향 전반을 포괄하는 요소들이 포함되며, 최근 기후변화와 관련된 탄소중립, 재생에너지 사용 등이 중요한 요소로 부각",
        detail: "환경경영목표, 온실가스, 에너지, 용수, 폐기물, 오염물질, 환경법/규제 위반, 환경라벨링, 기후변화 대응, 생물다양성",
      },
      {
        name: "사회",
        en: "Social",
        icon: "users",
        area: 1,
        desc: "임직원, 고객, 협력사, 지역사회 등 다양한 이해관계자에 대한 기업의 권리와 의무, 책임 등의 요소가 포함되고, 최근 인권, 안전·보건 등에 대한 이슈가 화두",
        detail: "사회목표, 노동, 다양성 및 양성평등, 산업안전, 인권, 동반성장, 지역사회, 정보보호, 사회/법규제 위반",
      },
      {
        name: "지배구조",
        en: "Governance",
        icon: "settings",
        area: 6,
        desc: "회사의 경영진과 이사회, 주주 및 회사의 다양한 이해관계자의 권리와 책임에 대한 영역으로 이사회의 다양성, 임원 급여, 윤리경영 및 감사기구 등이 강조",
        detail: "이사회 구성, 이사회 활동, 주주권리, 윤리경영, 감사기구, 지배구조 법/규제 위반",
      },
    ],
  },
  /** IV-2 도입배경 및 중요성(양식 7쪽) */
  background: {
    title: "ESG 경영 도입배경 및 중요성",
    lead: "기업 경영환경의 변화로 재무적 요소 외 비재무적 요소가 선택이 아닌 기업의 지속가능 성장을 위한 필수 생존전략으로 변화",
    financial: { title: "재무적 요소", items: ["매출", "이익"] },
    nonFinancial: { title: "비재무적 요소", items: [{ label: "환경(E)", icon: "sprout" }, { label: "사회(S)", icon: "user-round" }, { label: "지배구조(G)", icon: "settings" }] },
    strategyTitle: "기업의 필수 생존 전략",
    strategy: [
      { b: "자본시장의 압력", t: "글로벌 투자기관은 ESG 평가 낮은 기업 투자 제외, 자금조달비용(금리) 영향" },
      { b: "규제 및 공시의 의무화", t: "EU 등은 공시 의무화 추진" },
      { b: "글로벌 공급망 재편", t: "공급망 실사 시 협력업체 선정 탈락 위험" },
      { b: "고객 및 시장의 변화", t: "환경과 윤리를 중시하는 가치 소비가 주류가 됨에 따라 ESG 성과가 브랜드 평판과 매출에 영향" },
    ],
  },
  /** IV-3 ESG 경영보고서 기대효과(양식 8쪽) — 반원 도식 둘레 5개(왼쪽 아래 → 위 → 오른쪽 아래) */
  effects: {
    title: "ESG 경영보고서 기대효과",
    center: ["ESG보고서", "기대효과"],
    items: [
      { title: "중장기적 기업가치 제고", icon: "house", desc: "ESG 정보의 투명·신속한 공개를 통해 시장 신뢰 획득 및 중장기적", em: "기업가치 상승 제고" },
      { title: "체계적 ESG경영관리", icon: "briefcase", desc: "기업의 통합적, 체계적 ESG 경영관리" },
      { title: "미래 방향성 제시", icon: "search", desc: "기업 ESG경영 상태 진단을 통한", em: "향후 방향성 제시" },
      { title: "전략 및 목표제시", icon: "calendar-check", desc: "기업 ESG 경영전략 및 목표를 명확하게 제시, 실행" },
      { title: "지속가능한 성장", icon: "trending-up", desc: "기업의 ESG경영 이해 및 실천을 통한 지속가능한 성장" },
    ] as Array<{ title: string; icon: string; desc: string; em?: string }>,
  },
  /** V-1 국내 동향(양식 9쪽) */
  domestic: {
    title: "ESG 국내 동향",
    items: [
      {
        title: "K-ESG 가이드라인 V2.0 개정(2024.12.)",
        bullets: ["글로벌 ESG 평가·공시 트렌드, 국내 제도 변화(탄소중립, 생물다양성 등)를 반영하여, K-ESG 가이드라인 v2.0로 개정(2024년 12월)"],
        note: "4개 영역, 29개 범주, 69개 기본 진단항목으로 대폭 증가(42개 기본항목 추가)",
      },
      {
        title: "공공기관 ESG 가이드라인 제정(2025.12.10)",
        bullets: ["공공기관 특성을 반영한 공공기관 ESG 가이드라인 신규 제정", "핵심지표(37개), 세부지표(81개) 체계로 구성, 제3자 검증은 의무사항 아님"],
      },
      {
        title: "ESG 공시 최종안 발표(2026.7.8)",
        bullets: [
          "최초 공시시기는 2028년부터 적용되며, 최초 공시대상은 연결자산총액 10조원 이상 코스피 상장사임",
          "2029년부터는 연결자산총액 5조원 이상, 2030년에는 2조원 이상의 코스피 상장사로 대상 확대",
          "2030년부터 '제3자 인증' 제도 시행, 가치사슬 전반의 온실가스를 책정하도록 한 SCOPE3 공시는 약 3년 유예 후, 2031년부터 적용 예정",
        ],
      },
    ] as Array<{ title: string; bullets: string[]; note?: string }>,
    kesg: {
      title: "K-ESG 가이드라인 지표체계",
      head: ["구분", "K-ESG 가이드라인 진단항목"],
      rows: [
        { icon: "file-text", label: "정보공시", text: "정보공시 형식, 내용, 검증 등 3개 범주, 5개 진단항목" },
        { icon: "sprout", label: "환경", text: "환경경영 목표, 온실가스, 생물다양성 등 11개 범주, 25개 진단항목" },
        { icon: "users", label: "사회", text: "다양성 및 양성평등, 산업안전, 지역사회, 정보보호 등 9개 범주, 22개 진단항목" },
        { icon: "landmark", label: "지배구조", text: "이사회 구성 및 활동, 윤리경영, 감사기구 등 6개 범주, 17개 진단항목" },
      ],
    },
    final: {
      title: "ESG 공시 최종안",
      head: "최종안",
      rows: [
        { icon: "users", label: "대상", text: ["자산 10조(2028년)", "5조(2029년)", "2조(2030년)"] },
        { icon: "file-text", label: "방법", text: ["첫 시행부터 사업보고서 법정공시"] },
        { icon: "shield-check", label: "제3자 인증", text: ["2030년부터 의무화"] },
        { icon: "scale", label: "면책조항", text: ["도입 첫 3년간 공시정보 전체 면책 추가"] },
      ],
    },
    source: "출처: 한국경제(hankyung.com, 2026.07.08)",
  },
  /** V-2 EU 규제·국외 공시 동향(양식 10쪽) */
  global: {
    euTitle: "EU 규제 동향",
    euLead: "유럽은 ESG를 강력하게 제도화하여 자국 산업을 보호하고 글로벌 표준을 주도",
    eu: [
      { title: "지속가능성 공시(Corporate Sustainability Reporting Directive, CSRD)", text: "매우 구체적이고 엄격한 공시 가이드라인을 제시하며 투명성을 요구", sub: ["2025년부터 단계적 시행(2024년 회계연도부터 적용되어, 2025년 공시 시작)"] },
      {
        title: "탄소국경조정제도(Carbon Border Adjustment Mechanism, CBAM)",
        text: "탄소 배출량이 높은 수입품에 비용을 부과하는 일종의 '환경 관세'로, 수출 기업에 실질적인 타격으로 작용(2026.1.1. 본격 시행)",
        sub: ["대상업종 확대: '26년 6개 품목(철강, 시멘트, 비료, 알루미늄, 전력, 수소) → '28년부터 자동차, 기계, 화물차, 세탁기 등으로 확대"],
      },
      {
        title: "공급망 실사법(Corporate Sustainability Due Diligence Directive, CSDDD)",
        text: "기업의 전 공급망 내 인권·환경 침해 여부를 조사하고 시정할 의무를 부과(2029.7.26. CSDDD 전면 적용)",
        sub: ["대상: 역내 종업원 5,000명 이상, 순매출액 15억 유로 이상 기업", "역외: 순매출액 15억 유로 이상"],
      },
    ],
    abroadTitle: "국외 ESG 공시 제도화 동향",
    abroad: [
      { b: "일본", t: "2027년 6월(2026 회계연도분)부터 최근 5년 평균 시가총액이 3조엔 이상인 도쿄증권거래소 프라임시장 상장사에 ESG 공시를 의무화 계획이며, 이후 2028년 시총 1조엔, 2029년 5000억엔으로 의무 공시 기준 확대" },
      { b: "영국", t: "2026년 2월 ESG 공시기준(UK SRS)을 확정하였으며, 2028년부터 대부분의 상장기업에 ESG 공시 의무가 부여될 것으로 예상" },
      { b: "싱가포르", t: "2027년부터 증시에 상장한 시총 상위 30개 기업에 ESG 공시 의무화 할 계획" },
      { b: "미국", t: "도널드 트럼프 행정부 출범 이후 ESG 공시 도입 논의 잠정 중단, 유럽연합(EU): 2027 회계연도부터 의무 공시 항목 완화" },
    ],
    tableTitle: "해외 ESG 공시 제도화 동향",
    table: [
      { label: "EU", icon: "globe", text: "2025년부터 공시제도 시작, 의무 공시정보 범위 축소 추진" },
      { label: "영국", icon: "landmark", text: "2028년부터 상장기업 공시의무 부여 추진" },
      { label: "일본", icon: "building-2", text: "2027년 시총 3조엔 이상 상장사 의무" },
      { label: "미국", icon: "flag", text: "공시제도 도입 잠정 중단" },
    ],
    source: "출처: 한국경제(hankyung.com, 2026.07.08)",
  },
  /** VI-1 ESG 경영보고서 작성 절차(양식 11쪽) — kind: internal = 기업 내부 의사결정 반영(초록 음영), external = 외부 전문기관 협업(보라 음영) */
  process: {
    title: "ESG 경영보고서 작성 절차",
    subTitle: "보고서 발간 프로세스",
    phases: [
      { label: "사전조사", when: "1.5M", items: [{ t: "미디어조사 및 보고서 우수 작성기관 벤치마킹" }, { t: "내·외부 환경분석" }, { t: "이해관계자 정의 및 관심사항 분석" }, { t: "이해관계자 인터뷰 및 설문조사" }] },
      { label: "기획 및 작성", when: "1.5M", items: [{ t: "중대성 평가", kind: "internal" }, { t: "보고서 목차·콘텐츠 구성 및 확정", kind: "internal" }, { t: "TFT 교육 및 ESG 데이터 수집", kind: "internal" }, { t: "보고서 표지/간지/내지 디자인, 윤문 작업", kind: "external" }] },
      { label: "디자인 및 검증", when: "2M", items: [{ t: "보고서 초안 완성 및 현업부서 초안 회람", kind: "internal" }, { t: "보고서 디자인 초안 완성", kind: "external" }, { t: "제3자 검증(문서검증/현장검증)", kind: "external" }, { t: "검증의견에 따른 보고서 수정·보완" }] },
      { label: "보고서 완성", when: "1M", items: [{ t: "국문 보고서 완성 및 경영층 보고", kind: "internal" }, { t: "국문 보고서 최종본 인쇄", kind: "external" }, { t: "영문 번역 및 영문 보고서 디자인", kind: "external" }, { t: "영문 보고서 최종본 인쇄 및 사후지원", kind: "external" }] },
    ] as Array<{ label: string; when: string; items: Array<{ t: string; kind?: "internal" | "external" }> }>,
    legend: { internal: "초록색 음영: 기업 내부 의사결정 반영 필요", external: "보라색 음영: 외부 전문기관 협업" },
    steps: [
      { b: "이슈 파악", t: "조직 내부 수준 진단, 유사기관 벤치마킹" },
      { b: "현황 분석", t: "기초자료 검토, 미디어 조사" },
      { b: "중대성 평가 및 기획", t: "중대성 평가, 중요 보고 이슈 도출, 보고서 구성 기획, 목차 개발" },
      { b: "자료 수집", t: "유관부서 인터뷰 진행, 자료 취합, 자료 검토 및 분석, Standards 수용성 분석" },
      { b: "보고서 작성", t: "보고서 작성 및 유관부서 회람" },
      { b: "제3자 검증", t: "보고 내용 검증, 검증 의견사항 보고서 반영" },
      { b: "디자인 및 번역", t: "윤문 작업, 디자인 기획(기업 브랜딩 고려), 보고서 디자인(디자인 시안 의견 수렴, 표지 및 내지 개발 확정), 영문 번역" },
      { b: "보고서 공개 및 배포", t: "" },
    ],
  },
  /** VI-2 이중 중대성 평가 개념·필요성(양식 12쪽) */
  materiality: {
    title: "이중 중대성 평가 수행",
    conceptTitle: "이중 중대성 평가 개념",
    concept: [
      { t: "이중중대성 평가(Double Materiality Assessment)는 ESG(환경, 사회, 지배구조)에서 매우 중요한 개념으로 지속 가능성 보고와 평가에 필수적인 접근 방식이며, " },
      { t: "기업이 환경과 사회에 미치는 영향과 ESG 요인이 기업의 재무 성과에 미치는 영향", b: true },
      { t: "을 종합적으로 고려하는 중대성 평가 방식" },
    ] as Array<{ t: string; b?: boolean }>,
    outside: { label: "외부환경", en: "Economic · Social · Environmental", icon: "globe" },
    company: { label: "기업", icon: "building-2" },
    financial: { title: "재무적 영향(Financial Materiality)", items: ["지속가능성 이슈가 기업에 미치는 재무적 영향", "임원, 재무 관련 이해도가 높은 부서, 주주/투자자 대상 설문조사 실시"] },
    impact: { title: "환경·사회적 영향(Impact Materiality)", items: ["기업활동이 환경, 사회 등 외부에 끼칠 수 있는 영향", "내/외부 전체 이해관계자 대상 설문조사 실시"] },
    needTitle: "이중 중대성 평가 필요성",
    needs: [
      {
        title: "종합적인 리스크관리",
        items: [
          "이중 중대성 평가로 도출된 이슈를 중심으로 관리하면, 회사에 가장 중요한 리스크를 우선적으로 관리하는 효과를 얻게 됨",
          "이미 기업의 재무에 미치는 영향과 기업 활동이 환경과 사회에 미치는 영향을 동시에 평가하였기 때문에, 이 2가지 측면에서의 리스크가 큰 이슈라는 의미",
        ],
      },
      { title: "지속가능경영 보고서 핵심 주제", items: ["지속가능경영보고서에서는 이중 중대성 평가로 도출된 이슈 중 핵심 이슈를 회사의 실정에 맞게 선정하여, 이에 대한 세부적인 대응전략을 제시해야 함"] },
      {
        title: "정책 및 전략 수립에의 활용",
        items: ["이중 중대성 평가의 결과는 기업이 ESG 전략을 세우고, 리스크 관리 정책을 마련하며, 지속 가능성 목표를 설정하는 데 중요한 데이터로 활용", "데이터는 경영진이 더 나은 의사 결정을 내리는 데 필요한 근거를 제공"],
      },
    ],
  },
  /** VI-3 이중 중대성 평가 프로세스(양식 13쪽) — STEP 3 은 두 갈래 평가 */
  materialitySteps: {
    title: "이중 중대성 평가 프로세스",
    steps: [
      { title: "이슈 Pool 구성", items: ["ESG와 관련된 다양한 이슈들을 식별하기 위해 동종산업 벤치마킹, 국제 표준 분석, 내부 자료 검토 및 미디어 조사 수행", "기업과 이해관계자들에게 중요한 이슈 풀 구성"] },
      { title: "설문 조사 실시", items: ["도출된 이슈를 바탕으로 임직원과 주요 이해관계자들을 대상으로 설문 조사 설계 및 실시", "각 이슈에 대한 이해관계자들의 의견과 우선순위 파악"] },
      {
        title: "영향도 평가",
        items: [],
        subs: [
          { title: "재무적 영향도 평가", text: "식별된 이슈들이 기업의 재무 성과에 미치는 영향 분석(비용, 수익, 규제준수 비용 등 재무적 측면 포괄)" },
          { title: "사회/환경적 영향도 평가", text: "기업 활동이 환경과 사회에 미치는 영향도 평가(기업의 환경적 발자국, 지역사회 기여도, 직원 복지 등 고려)" },
        ],
      },
      { title: "중대 이슈 선정", items: ["재무적 영향도와 사회/환경적 영향도를 종합하여 각 이슈의 우선순위를 결정하고, 기업 전략에 반영할 수 있는 주요 이슈 리스트 도출"] },
      { title: "중대 이슈 영향 평가", items: ["중대 이슈에 대한 임팩트, 리스크 및 기회요인을 분석", "분석 결과는 이슈별 대응 전략을 수립하기 위한 의사결정에 반영"] },
    ] as Array<{ title: string; items: string[]; subs?: Array<{ title: string; text: string }> }>,
  },
  /** VI-4 ESG 경영보고서 작성(양식 14쪽) */
  report: {
    title: "ESG 경영보고서 작성",
    headline: ["공시기준과 중대이슈에 기반한 ESG 성과 체계화 및 보고서 구현,", "기업·공공기관 맞춤형 지속가능경영보고서 작성 수행"],
    frame: [
      { en: "REPORTING", ko: "보고범위", text: "보고기간(직전 회계연도)·보고경계 등 설정" },
      { en: "STANDARDS", ko: "보고기준", text: "GRI 기반, K-ESG 가이드라인·SASB 등 연계" },
      { en: "MATERIALITY", ko: "중대성 평가", text: "이해관계자 의견수렴 및 핵심 이슈 선정" },
      { en: "OUTPUTS", ko: "결과물", text: "국·영문 보고서 PDF 파일 및 책자형 보고서" },
    ],
    pesgTitle: "ESG 분야별 주요 작성 항목",
    pesgAside: "K-ESG 가이드라인 기준 총 61개",
    pesg: [
      { key: "P", name: "정보공시", en: "Public", count: 5, area: 2, items: ["정보공시 방식", "정보공시 주기", "정보공시 범위", "정보공시 내용"] },
      { key: "E", name: "환경", en: "Environmental", count: 17, area: 4, items: ["탄소중립·기후변화 대응", "온실가스·에너지 관리", "자원순환·친환경사업", "생물다양성·환경영향"] },
      { key: "S", name: "사회", en: "Social", count: 22, area: 1, items: ["인권·노동 및 다양성", "안전보건·재난관리", "지역사회·사회공헌", "동반성장·공급망 ESG"] },
      { key: "G", name: "지배구조", en: "Governance", count: 17, area: 3, items: ["ESG 거버넌스·책임경영", "윤리·준법·반부패", "정보보호·리스크관리", "이사회 운영·투명성"] },
    ],
    oneStop: { label: "보고서 ONE-STOP 발간", steps: ["보고서 기획", "자료수집·성과 분석", "중대성 평가", "보고서 콘텐츠 작성", "제3자 검증 대응", "최종 품질관리"] },
  },
  /** VII 사업 수행 조직(양식 18쪽 오른쪽) — 역할만 적는다(사람 이름은 쓰지 않는다) */
  team: {
    title: "사업 수행 조직",
    lead: "사업수행 책임자",
    support: { title: "총괄보조", items: ["환경 분야", "사회·지배구조 분야"] },
    core: "프로젝트 수행팀",
    units: [
      { key: "P", label: "정보공시(P)", area: 2, items: ["정보공시 및 중대성 평가"] },
      { key: "E", label: "환경(E)", area: 4, items: ["환경경영·온실가스", "에너지·자원순환 진단"] },
      { key: "S", label: "사회(S)", area: 1, items: ["안전/보건", "노동/인권"] },
      { key: "G", label: "지배구조(G)", area: 3, items: ["윤리/경영", "이사회·감사기구"] },
    ],
    base: "ESG 경영보고서 작성 컨설팅 용역 수행",
  },
  /** VIII 수행실적 — 왼쪽 판 제목, 두 단 쪽의 단 제목(왼쪽 ESG 분야 = 분야 4, 오른쪽 환경 인허가·연구 = 분야 5) */
  recordsPanel: "수행실적",
  recordsEsgTitle: "ESG 경영 컨설팅 수행 실적",
  recordsOtherTitle: "기타 탄소중립 연구용역 수행 실적",
  thanks: "Thank you",
};
