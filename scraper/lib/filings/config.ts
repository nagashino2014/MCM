/**
 * 대외 신고 보조 도구 — 설정·경로.
 *
 * 산출물(브라우저 프로필·쿠키·MCM 토큰·설정)은 전부 `data/filings/` 아래(git 제외).
 * 사이트 URL·자동 채우기 셀렉터는 `data/filings/config.json` 으로 덮어쓸 수 있다 — 기본값은 아래 DEFAULT_CONFIG.
 * 사이트 화면(DOM)은 실측 전이라 `fill` 매핑은 비어 있다: `npm run filings -- probe` 로 폼 요소를 덤프해 채운다.
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

export interface FilingsConfig {
  /** MCM 웹 주소(모바일 로그인 API 로 토큰 발급) */
  mcmBaseUrl: string;
  sites: Record<FilingSite, SiteConfig>;
  /**
   * 자동 채우기 — 신고 종류별 { "양식 항목 라벨": "CSS 셀렉터" }.
   * 라벨은 MCM 대기열 payload.fields[].label 과 같아야 한다. 비어 있으면 패널의 수동 채우기만 쓴다.
   */
  fill: Partial<Record<FilingKind, Record<string, string>>>;
}

export const DEFAULT_CONFIG: FilingsConfig = {
  mcmBaseUrl: process.env.MCM_BASE_URL || "http://localhost:3000",
  sites: {
    ieps: {
      label: "통합환경허가시스템",
      loginUrl: "https://ieps.nier.go.kr/",
      loggedOutPattern: "login|member|auth",
      checkUrl: "https://ieps.nier.go.kr/web/issPrc/agencyPerMgt/?pMENUMST_ID=580",
      screens: {
        // 대행업 변경신고 목록(스샷의 appForm 상위) — 신청서를 새로 만들거나 기존 건을 열어 기술인력 그리드로 이동
        ieps_staff: "https://ieps.nier.go.kr/web/issPrc/agencyPerMgt/?pMENUMST_ID=580",
        // 대행 실적 보고 화면 URL 은 실측 전 — 로그인 후 메뉴에서 이동
        ieps_agency: "https://ieps.nier.go.kr/",
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
  fill: {},
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

/** 설정 파일이 없으면 기본값을 써 둔다(사용자가 URL·셀렉터를 고치기 쉽게). */
export function ensureConfigFile(): string {
  fs.mkdirSync(FILINGS_DIR, { recursive: true });
  const file = configFile();
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
  return file;
}

export function siteDir(site: FilingSite): string {
  const dir = path.join(FILINGS_DIR, site);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
