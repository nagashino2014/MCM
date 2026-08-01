/*
 * 지표(metric) 정의 타입 — SW-P2. 클라이언트 안전(타입·검증·순수 함수만).
 * 설계: docs/semantic-analytics-wizard-blueprint.md §4-3.
 * 원칙: 지표는 필드 key 가 아니라 시맨틱 태그(concept)를 참조하고, 정의는 선언적 JSON 으로
 * 저장되며 실행은 서버 화이트리스트 엔진(metric-engine.ts)이 담당한다 — 자유 SQL/eval 금지.
 * ⚠ 서버 전용 import 금지(pg 번들 유입).
 */

export const METRIC_AGGS = ["sum", "avg", "count", "min", "max", "count_distinct"] as const;
export type MetricAgg = (typeof METRIC_AGGS)[number];

/** 집계 지표 — 한 소스에서 태그(또는 시스템 필드) 기반 집계 */
export interface AggregateDefinition {
  kind: "aggregate";
  source: {
    /** "approval_docs" 또는 시스템 소스 key("system.contracts" 등 — 서버 카탈로그 화이트리스트) */
    type: string;
    /** approval_docs 전용 — "auto" = measure 태그를 가진 모든 양식(태그가 계약) */
    forms?: string[] | "auto";
    /** approval_docs 전용 — 기본 ["approved"] */
    status?: string[];
  };
  measure: {
    agg: MetricAgg;
    /** approval_docs: 집계할 값의 시맨틱 태그(예: cost.travel). count 는 생략 가능 */
    concept?: string;
    /** system 소스: 소스 카탈로그가 정의한 측정값 key(예: amount, overtime_hours) */
    field?: string;
  };
  /** 그룹 차원 — "ref.contract"|"ref.company"|"ref.employee"|"dim.category" (v1: 최대 1개) */
  groupBy?: string[];
  timeBy?: {
    /** approval_docs: 시간축 태그(when.occurred | when.period) */
    concept?: string;
    /** system 소스: 시간 컬럼 key(카탈로그 정의) */
    field?: string;
    bucket: "month" | "year" | "none";
  };
}

/** 복합 지표 — 같은 차원의 집계 지표들을 사칙연산으로 결합(마진율 등) */
export interface CompositeDefinition {
  kind: "composite";
  /** 결합 차원 — 참조하는 모든 집계 지표의 groupBy 와 일치해야 한다 */
  dimensions: string[];
  /** 토큰 배열: 지표 key·숫자·연산자(+ - * /)·괄호만 허용(파서가 화이트리스트 검증) */
  formula: string[];
  format?: "number" | "currency" | "percent";
}

export type MetricDefinition = AggregateDefinition | CompositeDefinition;

export interface MetricItem {
  metricKey: string;
  label: string;
  description: string | null;
  definition: MetricDefinition;
  /** §8-2 — admin(관리자만)|all(전체)|owner(작성자만). 인원 차원 지표는 기본 admin */
  visibility: "admin" | "all" | "owner";
  active: boolean;
  version: number;
  updatedAt?: string;
}

/** 지표 실행 결과 — 값과 함께 항상 진단 메타(§3-3 원칙: 근거 없는 숫자 금지)를 반환한다 */
export interface MetricResult {
  metricKey: string;
  label: string;
  kind: "aggregate" | "composite";
  format: "number" | "currency" | "percent";
  hasTime: boolean;
  rows: { groupId: string | null; groupLabel: string; time?: string; value: number | null }[];
  diagnostics: {
    sources: string[];
    /** approval_docs: 조회 대상 문서 수 */
    totalDocs?: number;
    usedRows: number;
    /** 제외 사유별 건수 — noGroupKey(참조 미연결)·manualRef(직접 입력)·emptyValue 등 */
    excluded: Record<string, number>;
    notes: string[];
  };
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const NUM_RE = /^-?\d+(\.\d+)?$/;
const OPS = new Set(["+", "-", "*", "/", "(", ")"]);

/** formula 토큰이 화이트리스트(지표 key·숫자·연산자·괄호)만인지 검증. 위반 토큰 반환(정상이면 null). */
export function invalidFormulaToken(formula: string[]): string | null {
  for (const t of formula) {
    if (OPS.has(t) || NUM_RE.test(t) || KEY_RE.test(t)) continue;
    return t;
  }
  return null;
}

/** formula 에서 참조하는 지표 key 목록 */
export function formulaMetricKeys(formula: string[]): string[] {
  return [...new Set(formula.filter((t) => !OPS.has(t) && !NUM_RE.test(t) && KEY_RE.test(t)))];
}

/** 정의 정합성 검증(저장 전) — 오류 메시지 반환(정상이면 null). */
export function validateDefinition(def: MetricDefinition): string | null {
  if (def.kind === "aggregate") {
    if (!def.source?.type) return "소스(type)가 없습니다.";
    if (!METRIC_AGGS.includes(def.measure?.agg)) return `지원하지 않는 집계입니다: ${def.measure?.agg}`;
    if (def.source.type === "approval_docs") {
      if (def.measure.agg !== "count" && !def.measure.concept) return "결재 문서 소스는 measure.concept(태그)가 필요합니다.";
      if (def.measure.agg === "count" && !def.measure.concept && def.source.forms === "auto")
        return "count + forms:auto 조합은 대상 양식을 특정할 수 없습니다(forms 명시 필요).";
    } else if (!def.measure.field) {
      return "시스템 소스는 measure.field 가 필요합니다.";
    }
    if ((def.groupBy ?? []).length > 1) return "그룹 차원은 v1 에서 1개까지입니다.";
    return null;
  }
  if (def.kind === "composite") {
    if (!Array.isArray(def.formula) || !def.formula.length) return "수식이 비어 있습니다.";
    const bad = invalidFormulaToken(def.formula);
    if (bad) return `수식에 허용되지 않는 토큰이 있습니다: ${bad}`;
    if (!formulaMetricKeys(def.formula).length) return "수식이 참조하는 지표가 없습니다.";
    return null;
  }
  return "알 수 없는 지표 종류입니다.";
}

export function parseMetricDefinition(value: unknown): MetricDefinition | null {
  try {
    const v = typeof value === "string" ? JSON.parse(value) : value;
    if (!v || typeof v !== "object") return null;
    const d = v as MetricDefinition;
    if (d.kind !== "aggregate" && d.kind !== "composite") return null;
    return d;
  } catch {
    return null;
  }
}

export function formatMetricValue(value: number | null, format: MetricResult["format"]): string {
  if (value == null || !isFinite(value)) return "-";
  if (format === "percent") return `${(value * 100).toFixed(1)}%`;
  if (format === "currency") return `${Math.round(value).toLocaleString("ko-KR")}원`;
  return Number.isInteger(value) ? value.toLocaleString("ko-KR") : value.toFixed(2);
}
