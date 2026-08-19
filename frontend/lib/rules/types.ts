// 사규(취업규칙) 조문 IR — 규정집 열람·개정 비교·전자동의(RB)의 공통 자료형.
// 설계: docs/company-rules-blueprint.md §3.
// 원칙: 발행된 판(rule_versions.body)은 불변이고, 비교(diff)는 이 IR 의 article key 로 맞춘다.
//   key 는 조 번호 기반이라 조문 신설·삭제는 추적되지만 전면 번호 개편은 '삭제+신설'로 본다(v1).

/** 항(①②…) — 호(1. 2. …)를 품는다. */
export interface RuleClause {
  /** 원문 항 기호(①…). 항 구분이 없는 조문은 빈 문자열(단항) */
  label: string;
  text: string;
  /** 호·목 — 원문 그대로("1. …") */
  items: string[];
}

export interface RuleArticle {
  /** 'art-33' | 'addendum-3' — diff 매칭 키 */
  key: string;
  no: number;
  title: string;
  clauses: RuleClause[];
  /** 조문이 인용하는 별표 키 목록 — 'appendix-3' */
  refs: string[];
  /** 조문 본문에 직접 들어간 표(제27조 근무시간표 등). 없으면 생략 */
  tables?: RuleTable[];
}

export interface RuleChapter {
  no: number;
  title: string;
  articles: RuleArticle[];
}

/** 별표 표 — 셀 텍스트만 담는다(서식은 원본 hwpx 로 보존). */
export interface RuleTable {
  /** 병합 정보를 잃지 않도록 셀 단위로 유지 */
  rows: RuleTableCell[][];
}

export interface RuleTableCell {
  text: string;
  colSpan: number;
  rowSpan: number;
}

export interface RuleAppendix {
  /** 'appendix-3' — 표제 번호 기준 */
  key: string;
  no: number;
  title: string;
  /** 표 앞뒤의 설명 문단 */
  paras: string[];
  tables: RuleTable[];
}

/** 부칙 말미의 '개 정' 연혁 — 과거 개정 이력 백필 근거(RB-P4). */
export interface RuleHistoryEntry {
  /** 원문 그대로의 항목 줄("1. 별표 1. … 변경 – 2020. 01. 30.") */
  text: string;
  /** 파싱된 시행일(YYYY-MM-DD). 추출 실패 시 null */
  date: string | null;
  /** 하위 '-' 세부 항목 */
  details: string[];
}

export interface RuleBody {
  chapters: RuleChapter[];
  /** 부칙 조문 — key 'addendum-N' */
  addendum: RuleArticle[];
  appendices: RuleAppendix[];
  history: RuleHistoryEntry[];
}

/** 임포트 결과 — 검수 화면이 경고를 띄우고 사람이 고친 뒤 발행한다. */
export interface RuleImportResult {
  body: RuleBody;
  warnings: string[];
  stats: { chapters: number; articles: number; addendum: number; appendices: number; tables: number };
}

// ── DB 행 ──

export type RuleVersionStatus = "draft" | "in_consent" | "published" | "superseded";

export interface RuleDocumentRow {
  docId: string;
  title: string;
  category: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface RuleVersionRow {
  versionId: string;
  docId: string;
  version: number;
  status: RuleVersionStatus;
  effectiveDate: string | null;
  revisionNote: string | null;
  sourceFileKey: string | null;
  pdfFileKey: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
}

export interface RuleVersionDetail extends RuleVersionRow {
  body: RuleBody;
}
