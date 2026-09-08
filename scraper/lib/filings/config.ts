/**
 * 대외 신고 보조 도구 — 설정·경로.
 *
 * 산출물(브라우저 프로필·쿠키·MCM 토큰·설정)은 전부 `data/filings/` 아래(git 제외).
 * 사이트 URL·자동 채우기 셀렉터는 `data/filings/config.json` 으로 덮어쓸 수 있다 — 기본값은 아래 DEFAULT_CONFIG.
 * IEPS 두 화면은 실측(2026-09-08)으로 `fill` 매핑·URL 이 들어 있다. ETIS 는 실측 전 — `open` 패널의 [폼 덤프] 로 채운다.
 */
import fs from "node:fs";
import path from "node:path";

const SCRAPER_ROOT = path.resolve(__dirname, "..", "..");
export const MCM_ROOT = path.resolve(SCRAPER_ROOT, "..");
export const FILINGS_DIR = path.join(MCM_ROOT, "data", "filings");

export type FilingSite = "ieps" | "etis";
export type FilingKind = "ieps_staff" | "ieps_agency" | "etis_career";

export const KIND_SITE: Record<FilingKind, FilingSite> = {
  ieps_staff: "ieps",
  ieps_agency: "ieps",
  etis_career: "etis",
};

export const KIND_LABEL: Record<FilingKind, string> = {
  ieps_staff: "IEPS 기술인력 변경신고",
  ieps_agency: "IEPS 대행 실적 보고",
  etis_career: "ETIS 기술자 변경신고",
};

export interface SiteConfig {
  label: string;
  /** 로그인 시작 페이지(사람이 로그인 — 문자인증/공동인증서) */
  loginUrl: string;
  /** 로그인 상태 판정 — 이 패턴에 걸리는 URL 로 튕기면 로그아웃 상태 */
  loggedOutPattern: string;
  /** 세션 확인용 로그인 필요 페이지 */
  checkUrl: string;
  /** 신고 종류별 시작 화면(모르면 루트 — 사람이 메뉴로 이동, 패널은 어느 화면에서든 뜬다) */
  screens: Partial<Record<FilingKind, string>>;
}

/** 라벨 하나에 셀렉터 하나(text/select/textarea) 또는 값별 셀렉터(radio: { "체결": "#...001", ... }) */
export type FillTarget = string | Record<string, string>;

export interface FilingsConfig {
  /** MCM 웹 주소(모바일 로그인 API 로 토큰 발급) */
  mcmBaseUrl: string;
  sites: Record<FilingSite, SiteConfig>;
  /**
   * 자동 채우기 — 신고 종류별 { "양식 항목 라벨": 셀렉터 | { 값: 셀렉터 } }.
   * 라벨은 MCM 대기열 payload.fields[].label 과 같아야 한다(frontend/lib/filings/store.ts 가 원본).
   */
  fill: Partial<Record<FilingKind, Record<string, FillTarget>>>;
  /** MCM 값이 비어 있을 때 채우는 자사 상수 — { 종류: { 라벨: 값 } } */
  defaults: Partial<Record<FilingKind, Record<string, string>>>;
}

// IEPS 폼 실측(2026-09-08, [폼 덤프]) — 대행 실적보고 contractReportForm(583) / 대행업 변경등록 appForm(580)
const IEPS_AGENCY_FILL: Record<string, FillTarget> = {
  "보고 구분": { 체결: "#REPORT_FOM_CD001", 변경: "#REPORT_FOM_CD002", 이행: "#REPORT_FOM_CD003" },
  // 대행사업장 명칭(#bplc_nm)·소재지(#BPLC_ADDR)는 사업장 검색 팝업 전용(읽기 전용) — 매핑하지 않는다
  "통합허가구분": {
    통합허가: "#UNITY_PRMSN_JOB_CD1",
    변경허가: "#UNITY_PRMSN_JOB_CD2",
    변경신고: "#UNITY_PRMSN_JOB_CD3",
    허가재검토: "#UNITY_PRMSN_JOB_CD4",
  },
  "허가번호": "#RESULT_FORMAT_INNB",
  "대행업무 시작일": "#AGENCY_START_DE",
  "대행업무 종료일": "#AGENCY_END_DE",
  "대행업무의 개요": "#RM_CN",
  "발주자(기관)": "#ORDERER",
  "전화번호(지역번호)": "#TELNO_1",
  "전화번호(국번)": "#TELNO_2",
  "전화번호(끝자리)": "#TELNO_3",
  "주 계약자": "#M_CONTRACTOR_NM",
  "통합허가대행업 등록번호": "#M_CONTRACTOR_REGST_NO",
  "주계약 지분금액(백만원)": "#M_CONTRACTOR_AMT",
  "주계약 지분율(%)": "#M_CONTRACTOR_RT",
  "(변경)계약일자": "#CONTRACT_DE",
  "(변경)계약 시작일": "#CONTRACT_START_DE",
  "(변경)계약 종료일": "#CONTRACT_END_DE",
  "(변경)계약금액(백만원)": "#CONTRACT_AMT",
  "(변경)낙찰률(%)": "#BID_RT",
  "사전협의 통보일자": "#ASTI_DE",
  "준공일자": "#COMPLETION_DE",
};

const IEPS_STAFF_FILL: Record<string, FillTarget> = {
  "신청 구분": { 등록: "#REQST_FOM_CD001", 변경등록: "#REQST_FOM_CD002" },
  "변경등록 내용": "#CHANGE_REQST_CN",
  // 기술인력보유현황 그리드는 편집 셀이 동적으로 생겨 셀렉터가 없다 — 셀을 편집 상태로 만들고 패널 [채우기]
};

const IEPS_AGENCY_URL = "https://ieps.nier.go.kr/web/issPrc/agencyPerMgt/contractReportForm/?pMENUMST_ID=583";
const IEPS_STAFF_URL = "https://ieps.nier.go.kr/web/issPrc/agencyPerMgt/appForm/?pMENUMST_ID=580&CNCL_CD=9HttNb21&REQST_SN=12";

export const DEFAULT_CONFIG: FilingsConfig = {
  mcmBaseUrl: process.env.MCM_BASE_URL || "http://localhost:3000",
  sites: {
    ieps: {
      label: "통합환경허가시스템",
      loginUrl: "https://ieps.nier.go.kr/",
      loggedOutPattern: "login|member|auth",
      checkUrl: IEPS_AGENCY_URL,
      screens: {
        // 대행업 등록/변경등록 신청서(REQST_SN=12 = 자사 등록 건) — 기술인력보유현황 그리드가 이 화면에 있다
        ieps_staff: IEPS_STAFF_URL,
        // My환경허가 › 대행업무처리현황 › 대행 실적보고
        ieps_agency: IEPS_AGENCY_URL,
      },
    },
    etis: {
      label: "엔지니어링종합정보시스템",
      loginUrl: "https://etis.or.kr/",
      loggedOutPattern: "login|member|cert",
      checkUrl: "https://etis.or.kr/",
      screens: {
        // 민원 › 엔지니어링 기술자 › 온라인신고 › 변경신고 › 입/퇴사, 경력추가 — URL 실측 전
        etis_career: "https://etis.or.kr/",
      },
    },
  },
  fill: { ieps_agency: IEPS_AGENCY_FILL, ieps_staff: IEPS_STAFF_FILL },
  defaults: {
    // 제출자 현황(IEPS 표시값). MCM 회사 프로필·면허에 등록돼 있으면 MCM 값이 우선한다.
    ieps_agency: { "주 계약자": "주식회사 한국환경안전연구원", "통합허가대행업 등록번호": "제044호" },
  },
};

export function configFile(): string {
  return path.join(FILINGS_DIR, "config.json");
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = out[k];
    out[k] = cur && typeof cur === "object" && !Array.isArray(cur) && v && typeof v === "object" && !Array.isArray(v)
      ? deepMerge(cur, v)
      : v;
  }
  return out as T;
}

export function loadConfig(): FilingsConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), "utf-8"));
    return deepMerge(DEFAULT_CONFIG, raw);
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * 설정 파일이 없으면 **최소 스켈레톤**만 써 둔다. 기본값 전체를 복사해 두면 코드의 기본값이 갱신돼도
 * 파일의 옛 값이 덮어써 버린다 — 파일에는 바꾸고 싶은 항목만 적는다(deepMerge).
 */
export function ensureConfigFile(): string {
  fs.mkdirSync(FILINGS_DIR, { recursive: true });
  const file = configFile();
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ mcmBaseUrl: DEFAULT_CONFIG.mcmBaseUrl, sites: {}, fill: {}, defaults: {} }, null, 2), "utf-8");
  }
  return file;
}

export function siteDir(site: FilingSite): string {
  const dir = path.join(FILINGS_DIR, site);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
