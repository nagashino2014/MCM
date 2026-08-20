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
  "time_range",
  "period",
  "user_select",
  "dept_select",
  "company_select",
  "contract_select",
  "contact_select",
  "leave_type",
  "asset_select",
  "table",
  "static",
] as const;
export type ApprovalFieldType = (typeof APPROVAL_FIELD_TYPES)[number];


// 휴가 종류(leave_type) 규정 카탈로그는 DB 관리로 분리되어 lib/approval/leave-types.ts 에 있다
// (규정 변경 대비 — 관리자가 /approval/leave-types 에서 편집). 렌더러·leave.ts 는 그 모듈을 쓴다.

/**
 * time_range 필드 값 — 시작·종료 시각을 각각 HH:MM 으로 나눠 저장한다.
 * (구버전 text 필드의 "18:00 ~ 19:30" 자유 입력은 사람마다 형식이 달라 집계가 불가능했다.)
 */
export interface ApprovalTimeRange {
  start?: string;
  end?: string;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 자유 텍스트("18:00~19:30", "1800 ~ 1930" 등)까지 받아 {start,end} 로 정규화. 파싱 실패분은 빈 값. */
export function parseTimeRange(value: unknown): ApprovalTimeRange {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const norm = (x: unknown) => {
      const s = String(x ?? "").trim();
      return HHMM_RE.test(s) ? s : "";
    };
    return { start: norm(v.start), end: norm(v.end) };
  }
  const s = String(value ?? "").trim();
  if (!s) return {};
  const m = /(\d{1,2})\s*[:시]?\s*(\d{2})?\s*[~\-–—]\s*(\d{1,2})\s*[:시]?\s*(\d{2})?/.exec(s);
  if (!m) return {};
  const hm = (h: string, mi?: string) => {
    const hh = Number(h);
    const mm = Number(mi ?? "0");
    if (!Number.isFinite(hh) || hh > 23 || mm > 59) return "";
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  };
  return { start: hm(m[1], m[2]), end: hm(m[3], m[4]) };
}

/** 시간 범위의 길이(분) — 종료가 시작보다 이르면 자정을 넘긴 것으로 본다(22:00~01:00 = 180분). */
export function timeRangeMinutes(value: unknown): number | null {
  const { start, end } = parseTimeRange(value);
  if (!start || !end) return null;
  const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
  const diff = toMin(end) - toMin(start);
  return diff > 0 ? diff : diff + 24 * 60;
}

/** 표시용 "HH:MM ~ HH:MM"(한쪽만 있으면 그쪽만). */
export function timeRangeText(value: unknown): string {
  const { start, end } = parseTimeRange(value);
  if (start && end) return `${start} ~ ${end}`;
  return start || end || "";
}

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
  type: string; // text|date|time(HHMM 자동완성)|select|currency|number|rowno(자동 연번)|people(조직도 복수 선택 — 값은 {employeeId,name,position}[])
  options?: string[];
  /** 필수 입력 열 — 값이 있는 행에서 이 열이 비면 상신을 막는다(지출 목적 등). */
  required?: boolean;
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
  /** asset_select 전용 — 선택지로 보여줄 자산 종류(reservable_assets.kind). 미지정 시 전체 */
  assetKind?: string;
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
              required: c.required === true,
              semantic: parseSemantic(c.semantic),
            }))
          : undefined,
        minRows: f.minRows != null ? Number(f.minRows) : undefined,
        sumColumn: f.sumColumn != null ? String(f.sumColumn) : undefined,
        multiple: f.multiple === true,
        assetKind: f.assetKind != null ? String(f.assetKind) : undefined,
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

/** 표 행에 붙는 내부 메타 키(귀속 참조) — 행이 비었는지 판정할 때는 값으로 세지 않는다. */
const TABLE_META_KEYS = new Set(["_cardTxnId", "_receiptId"]);

function cellFilled(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return String(v ?? "").trim() !== "";
}

/**
 * 표 필수 열(required) 미입력 목록 — "표 이름 3행: 지출 목적" 형태의 안내 문자열.
 * 값이 하나도 없는 행은 아직 안 쓴 행이므로 건너뛴다(최소 행 수만큼 빈 행이 늘 존재한다).
 * 법인카드·영수증에서 불러온 행도 예외가 아니다 — 지출 목적은 사용자가 직접 적어야 한다.
 */
export function missingTableRequirements(
  fields: ApprovalFieldDef[],
  values: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (f.type !== "table") continue;
    const cols = (f.tableColumns ?? []).filter((c) => c.required && c.type !== "rowno");
    if (!cols.length) continue;
    const rows = Array.isArray(values[f.key]) ? (values[f.key] as unknown[]) : [];
    rows.forEach((row, i) => {
      if (!row || typeof row !== "object") return;
      const entries = Object.entries(row as Record<string, unknown>);
      if (!entries.some(([k, v]) => !TABLE_META_KEYS.has(k) && cellFilled(v))) return;
      for (const c of cols) {
        if (!cellFilled((row as Record<string, unknown>)[c.key])) out.push(`${f.label} ${i + 1}행: ${c.label}`);
      }
    });
  }
  return out;
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
