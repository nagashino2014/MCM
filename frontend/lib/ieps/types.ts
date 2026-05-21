/**
 * IEPS CollectionConfig / ExtractionRule 타입.
 *
 * 백엔드 [backend/app/ieps/models.py](../../../backend/app/ieps/models.py)의
 * Pydantic alias(camelCase: startPage, endPage, activeRuleIds, ...) 와 1:1 매칭한다.
 */

import type {
  ExtractionRule as BuiltinExtractionRule,
  Locator,
  ResultType,
} from "@scraper/lib/ieps/builtin-rules";

export type { Locator, ResultType };
export type ExtractionRule = BuiltinExtractionRule;

export interface ExtractionRange {
  mode: "partial" | "full";
  startPage?: number;
  endPage?: number;
}

export interface CollectionRange {
  mode?: string; // preset id (1m, 3m, 6m, 1y, 2y, all, custom)
  preset?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface CollectionConfig {
  collectionRange?: CollectionRange;
  filters?: string[];
  /** 검토결과서(통합·변경허가) PDF 페이지 범위. 두 종류는 갑지/허가결정 구조가 동일해 한 범위를 공유한다. */
  extractionRange: ExtractionRange;
  /**
   * 연간(점검)보고서 PDF 페이지 범위. 검토결과서와는 페이지 구성·룰이 달라 별도 범위가 필요하다.
   * 1·2페이지에 사업장 개요/생산품이 정형화되어 있어 기본 1~2p.
   * 미설정(undefined)이면 기본값(1~2p) 사용 — 마이그레이션 헬퍼가 디폴트로 보강한다.
   */
  annualReportExtractionRange?: ExtractionRange;
  extractionRules: ExtractionRule[];
  activeRuleIds?: string[];
}

export interface ParsedField {
  ruleId: string;
  label: string;
  value: string | null;
  normalized: unknown;
  sourcePage: number | null;
  sourceText: string | null;
  confidence: number;
  needsReview: boolean;
  error?: string | null;
}

export interface ParsedDocument {
  pdfPath: string;
  pageCount: number;
  pagesProcessed: number;
  extractionStatus: string;
  extractionMethod?: string | null;
  qualityScore: number;
  fields: ParsedField[];
  missingRequired: string[];
  fullText?: string | null;
  errorMessage?: string | null;
}
