/*
 * 전자결재 필드 스키마 정의 — 클라이언트 안전 모듈(DB 의존 없음).
 * 서버 store(lib/approval/forms.ts)와 화면(렌더러·빌더)이 공유한다.
 * ⚠ 여기에 서버 전용 import(db 등)를 추가하지 말 것 — 클라이언트 번들에 pg 가 끌려 들어간다.
 */

export const APPROVAL_FIELD_TYPES = [
  "text",
  "multitext",
  "number",
  "currency",
  "select",
  "radio",
  "checkbox",
  "date",
  "time",
  "period",
  "user_select",
  "dept_select",
  "company_select",
  "contract_select",
  "leave_type",
  "table",
  "static",
] as const;
export type ApprovalFieldType = (typeof APPROVAL_FIELD_TYPES)[number];


// 휴가 종류(leave_type) 규정 카탈로그는 DB 관리로 분리되어 lib/approval/leave-types.ts 에 있다
// (규정 변경 대비 — 관리자가 /approval/leave-types 에서 편집). 렌더러·leave.ts 는 그 모듈을 쓴다.

/** 자동 채움 규칙 — 검색 필드(업체/계약)에서 선택 시 소스 속성 값을 대상 필드에 주입한다. */
export interface ApprovalFillRule {
  /** 소스 속성 key — FILL_SOURCES 카탈로그 참조 */
  source: string;
  /** 값을 주입할 같은 양식 내 필드 key */
  target: string;
}

/** 검색 필드 타입별 자동 채움 소스 카탈로그(빌더 편집 UI·렌더러 공유) */
export const FILL_SOURCES: Partial<Record<ApprovalFieldType, { key: string; label: string }[]>> = {
  company_select: [
    { key: "siteAddress", label: "주소" },
    { key: "representativeName", label: "대표자" },
    { key: "phoneNumber", label: "전화번호" },
    { key: "businessRegistrationNo", label: "사업자번호" },
    { key: "region", label: "지역(시도·시군구)" },
  ],
  contract_select: [
    { key: "counterpartyName", label: "업체명(계약상대)" },
    { key: "serviceType", label: "용역 대분류" },
    { key: "serviceSubtype", label: "용역 세분류" },
    { key: "contractDate", label: "계약일" },
    { key: "contractAmount", label: "계약금액" },
  ],
};

/**
 * 데이터 의미(시맨틱) 태그 — 분석 지표가 필드 key 대신 참조하는 표준 개념.
 * 카탈로그는 semantic_concepts(114) DB 관리(lib/approval/semantic-concepts.ts).
 * 설계: docs/semantic-analytics-wizard-blueprint.md §4-1.
 */
export interface ApprovalFieldSemantic {
  /** 표준 개념 태그 key(예: cost.travel) — semantic_concepts 카탈로그 참조 */
  concept?: string;
  /** cost.* 개념의 세부 분류(자유 텍스트, 예: 여비교통비) */
  costCategory?: string;
}

/** 엔티티 참조 필드는 타입만으로 개념이 자동 부여된다(빌더에서 수동 태깅 불필요). */
export const AUTO_CONCEPT_BY_TYPE: Partial<Record<ApprovalFieldType, string>> = {
  contract_select: "ref.contract",
  company_select: "ref.company",
  user_select: "ref.employee",
  dept_select: "ref.dept",
};

/** 필드의 유효 개념 — 명시 태그 우선, 없으면 타입 자동 부여. */
export function resolveFieldConcept(f: { type: ApprovalFieldType; semantic?: ApprovalFieldSemantic }): string | undefined {
  return f.semantic?.concept || AUTO_CONCEPT_BY_TYPE[f.type];
}

export interface ApprovalTableColumn {
  key: string;
  label: string;
  type: string; // text|date|select|currency|number|rowno(자동 연번 — 입력 없음, 렌더 시 행번호)
  options?: string[];
  /** 열 단위 데이터 의미 태그(지출 내역 표의 금액 열 = cost.travel 등) */
  semantic?: ApprovalFieldSemantic;
}

/** 양식 필드 정의 — row(같은 행 배치)·span(행 내 폭 비중 1~3)으로 레이아웃까지 표현 */
export interface ApprovalFieldDef {
  key: string;
  label: string;
  type: ApprovalFieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  /** static 안내문 본문 */
  content?: string;
  row: number;
  span?: number;
  /** table 전용 */
  tableColumns?: ApprovalTableColumn[];
  minRows?: number;
  /** table 에서 합계를 자동 계산할 컬럼 key(currency/number) */
  sumColumn?: string;
  /** user_select 전용 — 복수 인원 선택 허용(동행자 등) */
  multiple?: boolean;
  /** company_select/contract_select 전용 — 선택 시 다른 필드 자동 채움 규칙 */
  fillMap?: ApprovalFillRule[];
  /** 데이터 의미 태그 — fillMap(입력 편의)과 별개로 분석 집계의 근거가 된다 */
  semantic?: ApprovalFieldSemantic;
}

function parseSemantic(value: unknown): ApprovalFieldSemantic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const concept = v.concept != null ? String(v.concept).trim() : "";
  const costCategory = v.costCategory != null ? String(v.costCategory).trim() : "";
  if (!concept && !costCategory) return undefined;
  return {
    concept: concept || undefined,
    costCategory: costCategory || undefined,
  };
}

export function parseFields(value: unknown): ApprovalFieldDef[] {
  try {
    const v = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(v)) return [];
    return v
      .filter((f) => f && typeof f === "object")
      .map((f: Record<string, unknown>) => ({
        key: String(f.key ?? ""),
        label: String(f.label ?? ""),
        type: (APPROVAL_FIELD_TYPES as readonly string[]).includes(String(f.type))
          ? (String(f.type) as ApprovalFieldType)
          : "text",
        required: f.required === true,
        options: Array.isArray(f.options) ? f.options.map(String) : undefined,
        placeholder: f.placeholder != null ? String(f.placeholder) : undefined,
        content: f.content != null ? String(f.content) : undefined,
        row: Number(f.row ?? 1),
        span: f.span != null ? Number(f.span) : undefined,
        tableColumns: Array.isArray(f.tableColumns)
          ? (f.tableColumns as Record<string, unknown>[]).map((c) => ({
              key: String(c.key ?? ""),
              label: String(c.label ?? ""),
              type: String(c.type ?? "text"),
              options: Array.isArray(c.options) ? c.options.map(String) : undefined,
              semantic: parseSemantic(c.semantic),
            }))
          : undefined,
        minRows: f.minRows != null ? Number(f.minRows) : undefined,
        sumColumn: f.sumColumn != null ? String(f.sumColumn) : undefined,
        multiple: f.multiple === true,
        fillMap: Array.isArray(f.fillMap)
          ? (f.fillMap as Record<string, unknown>[])
              .filter((r) => r && typeof r === "object")
              .map((r) => ({ source: String(r.source ?? ""), target: String(r.target ?? "") }))
              .filter((r) => r.source && r.target)
          : undefined,
        semantic: parseSemantic(f.semantic),
      }))
      .filter((f) => f.key);
  } catch {
    return [];
  }
}

/** 필드 key 중복·누락 검사 — 저장 전 검증(구조화 저장의 무결성 핵심). */
export function validateFields(fields: ApprovalFieldDef[]): string | null {
  const seen = new Set<string>();
  for (const f of fields) {
    if (!f.key.trim()) return "필드 키가 비어 있습니다.";
    if (!/^[a-z][a-z0-9_]*$/.test(f.key)) return `필드 키는 영문 소문자·숫자·_ 만 가능합니다: ${f.key}`;
    if (seen.has(f.key)) return `필드 키가 중복됩니다: ${f.key}`;
    seen.add(f.key);
    if (!f.label.trim() && f.type !== "static") return `라벨이 비어 있습니다: ${f.key}`;
    if (f.type === "table") {
      if (!f.tableColumns?.length) return `표 필드에 하위 열이 없습니다: ${f.key}`;
      const colSeen = new Set<string>();
      for (const c of f.tableColumns) {
        if (!c.key.trim() || !/^[a-z][a-z0-9_]*$/.test(c.key)) return `표 하위 열 키가 올바르지 않습니다: ${f.key}.${c.key}`;
        if (colSeen.has(c.key)) return `표 하위 열 키가 중복됩니다: ${f.key}.${c.key}`;
        colSeen.add(c.key);
      }
      if (f.sumColumn && !f.tableColumns.some((c) => c.key === f.sumColumn))
        return `합계 열이 하위 열에 없습니다: ${f.key}.${f.sumColumn}`;
    }
    if (["select", "radio", "checkbox"].includes(f.type) && !f.options?.length)
      return `선택 옵션이 비어 있습니다: ${f.key}`;
  }
  return null;
}
