/*
 * 회사소개서 렌더러(P4) 데이터 모델 — 클라이언트 안전(타입·상수만).
 * 서버(lib/catalog/render/data.ts)가 DB 에서 한 번에 모아 이 모양으로 넘기고, 쪽 컴포넌트는 props 만 보고 그린다
 * (훅·컨텍스트 없음 → 서버 renderToStaticMarkup 과 스튜디오(P5) 미리보기가 같은 컴포넌트를 쓴다).
 * 이미지는 키(ImageKey)로만 들고 다니고, 그릴 때 RenderCtx.url() 이 대상(PDF/화면)에 맞는 주소로 바꾼다.
 */
import type { AppendixResult, AppendixRules } from "@/lib/catalog/appendix";
import type { OrgChartDoc } from "@/lib/catalog/content-types";
import type { DocumentTheme } from "@/lib/catalog/document-theme";
import type { InitialPermitDetail, MetricId, MetricValue } from "@/lib/catalog/metrics";

/** 판 — 인쇄·배포본(안내문·초안 표시·화면 전용 칩을 숨기고 우측 하단 로고) / 작업본 */
export type EditionKind = "print" | "draft";
/** 이름 — 마스킹판(가운데 글자 ○, 홍보·공개) / 실명판(PQ·수의계약 제출, 부록 C 포함) */
export type NamingMode = "masked" | "real";

export interface RenderOptions {
  edition: EditionKind;
  naming: NamingMode;
}

export const EDITION_LABEL: Record<EditionKind, string> = { print: "인쇄·배포본", draft: "작업본" };
export const NAMING_LABEL: Record<NamingMode, string> = { masked: "마스킹판", real: "실명판" };

/**
 * 이미지 키 — "k/…" 키트 파일(public/catalog-kit/…), "a/{asset_id}" 회사소개서 자산(catalog_assets), "e/{employee_id}" 인사 사진.
 * 주소는 대상에 따라 다르다: PDF = https://print.local/{키}(converter 가 응답), 화면 = 앱 경로.
 */
export type ImageKey = string;

export interface RenderCtx {
  url: (key: ImageKey) => string;
  opts: RenderOptions;
  /** 쪽 머리의 문서 표기(예: "회사소개서 2026.10") */
  docLabel: string;
  /** 서체 세트 클래스 접미사(kc-fontset--{fontSet}) */
  fontSet: string;
}

export interface Office {
  key: string;
  name: string;
  nameEn: string;
  address: string;
  /** 주소 둘째 줄(건물·층) — 뒤표지 3칸 표기용 */
  addressLines: string[];
  phone: string;
  transit: Array<{ label: string; text: string }>;
  lon: number;
  lat: number;
  photo: ImageKey | null;
}

export interface AreaInfo {
  /** 분야 번호 1~6(분야 색 area-n · 지표 projects.area.n) */
  index: number;
  /** 계약 관리 분류명(categoryCaseSql) — 응용소프트웨어는 소개서 전용 */
  category: string;
  /** 소개서 표기명(catalog_business_areas.display_name, 없으면 기본 표기) */
  name: string;
  count: number;
  completed: number;
  /** 최근 3년 계약 수 */
  recent3: number;
  /** 수행 권역 수(미상 제외) */
  regions: number;
  firstYear: string;
  featured: Array<{ year: string; title: string; meta: string }>;
  /** 대표 실적 표시 계약이 없어 금액 상위로 채웠는지 */
  featuredFallback: boolean;
}

export interface LeaderCard {
  key: string;
  name: string;
  initial: string;
  role: string;
  photo: ImageKey | null;
  edu: string;
  cert: string;
  career: string;
  careerYears: number | null;
  manual: boolean;
}

export interface StaffRow {
  key: string;
  name: string;
  position: string;
  dept: string;
  edu: string;
  certs: string;
  years: number | null;
}

export interface StaffStats {
  technical: number;
  /** 기술사 또는 박사(사람 수) */
  experts: number;
  expertNote: string;
  avgCareer: number | null;
  certs: Array<{ name: string; count: number }>;
  degrees: { doctor: number; master: number; bachelor: number; other: number };
  /** 경력 분포 20년+ · 10–19 · 5–9 · 1–4 */
  careerBuckets: [number, number, number, number];
  population: number;
}

export interface PersonCv {
  key: string;
  name: string;
  role: string;
  years: number | null;
  duty: string;
  photo: ImageKey | null;
  edu: string;
  cert: string;
  career: string;
  projects: Array<{ year: string; title: string }>;
}

export interface HistoryYear {
  year: string;
  highlight: boolean;
  items: Array<{ month: string; content: string; category: string; highlight: boolean }>;
}

export interface CredentialCard {
  key: string;
  kind: string;
  name: string;
  meta: string;
  image: ImageKey | null;
}

export interface ClientGroup {
  label: string;
  sub: string;
  items: Array<{ name: string; logo: ImageKey | null }>;
}

/** 부록 A 총괄표 한 칸: 분류 × 기간 × 권역 */
export interface MatrixRow {
  label: string;
  period: string;
  total: number;
  byRegion: Record<string, number>;
  isTotal: boolean;
}

export interface MatrixSection {
  category: string;
  index: number;
  name: string;
  desc: string;
  rows: MatrixRow[];
}

export interface CatalogRenderData {
  asOf: string;
  /** "2026. 10" */
  asOfLabel: string;
  docLabel: string;
  theme: DocumentTheme;
  rules: AppendixRules;
  company: {
    name: string;
    nameShort: string;
    nameEn: string;
    ceoName: string;
    ceoTitle: string;
    foundedYear: string;
    foundedMonth: string;
    website: string;
    email: string;
    phone: string;
    vision: string;
    slogan: string;
    revenue: { year: string; millionWon: number } | null;
    credit: { grade: string; agency: string; ratedAt: string } | null;
    registrations: string[];
  };
  offices: Office[];
  metrics: Record<MetricId, MetricValue>;
  initialPermit: InitialPermitDetail;
  /** 외부 수치(catalog_external_figures) */
  figures: Record<string, number>;
  areas: AreaInfo[];
  appendix: AppendixResult;
  /** 부록 B 행 보조 — 계약 id → 세분류·허가일(AppendixListRow 에 없는 칸) */
  projectIndex: Record<string, { subtype: string; permitIssuedAt: string }>;
  matrix: MatrixSection[];
  regionColumns: Array<{ id: string; label: string }>;
  /** 통합환경허가 권역별 분포(지도) */
  permitByRegion: Record<string, number>;
  permitIndustries: string[];
  history: HistoryYear[];
  credentials: CredentialCard[];
  ceoMessage: { title: string; quote: string; paragraphs: string[]; signTitle: string; signName: string; draft: boolean } | null;
  ceo: LeaderCard | null;
  leaders: LeaderCard[];
  leaderAvgCareer: number | null;
  staffStats: StaffStats;
  staffRows: StaffRow[];
  advisors: Array<{ key: string; name: string; field: string; org: string; title: string; career: string }>;
  orgChart: OrgChartDoc;
  clients: ClientGroup[];
  people: PersonCv[];
  /** 데이터 단계에서 찾은 확인 사항(쪽 번호 없음) */
  notices: string[];
}
