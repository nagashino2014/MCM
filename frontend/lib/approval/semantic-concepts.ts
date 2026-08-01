/*
 * 시맨틱 개념 사전(114 semantic_concepts) — 양식 필드에 "데이터 의미"를 부여하는 표준 태그 카탈로그.
 * 설계: docs/semantic-analytics-wizard-blueprint.md §4-1 (SW-P0).
 * 지표는 필드 key 가 아니라 이 개념 태그를 참조한다 — 양식이 바뀌어도 같은 태그만 붙이면 지표가
 * 그대로 동작한다. 엔티티 참조 4종(ref.*)은 필드 타입에서 자동 부여(auto)라 빌더 드롭다운에 안 나온다.
 * ⚠ 이 파일은 클라이언트 안전(타입·시드·순수 조회만) — DB 접근은 semantic-concepts-store.ts(서버).
 */

export interface SemanticConceptItem {
  key: string;
  label: string;
  group: string;
  /** 태그를 붙일 수 있는 필드/표 열 타입 목록. auto 개념은 해당 select 타입 1개 */
  appliesTo: string[];
  /** true = 필드 타입에서 자동 부여(ref.* — 빌더 수동 선택 대상 아님) */
  auto: boolean;
  sortOrder: number;
  active: boolean;
}

/** 초기 시드 — 114 마이그레이션과 이 목록이 일치해야 한다. */
export const DEFAULT_SEMANTIC_CONCEPTS: Omit<SemanticConceptItem, "sortOrder" | "active">[] = [
  { key: "ref.contract", label: "관련 용역(계약)", group: "엔티티 참조", appliesTo: ["contract_select"], auto: true },
  { key: "ref.company", label: "관련 업체", group: "엔티티 참조", appliesTo: ["company_select"], auto: true },
  { key: "ref.employee", label: "관련 인원", group: "엔티티 참조", appliesTo: ["user_select"], auto: true },
  { key: "ref.dept", label: "관련 부서", group: "엔티티 참조", appliesTo: ["dept_select"], auto: true },
  { key: "cost.travel", label: "출장 경비", group: "비용", appliesTo: ["currency", "number"], auto: false },
  { key: "cost.supplies", label: "사무용품비", group: "비용", appliesTo: ["currency", "number"], auto: false },
  { key: "cost.entertain", label: "업무추진비(회식·다과)", group: "비용", appliesTo: ["currency", "number"], auto: false },
  { key: "cost.outsource", label: "외주비", group: "비용", appliesTo: ["currency", "number"], auto: false },
  { key: "cost.etc", label: "기타 경비", group: "비용", appliesTo: ["currency", "number"], auto: false },
  { key: "amount.revenue", label: "수익·매출 금액", group: "수익", appliesTo: ["currency"], auto: false },
  { key: "quantity.hours", label: "시간(시수)", group: "수량", appliesTo: ["number"], auto: false },
  { key: "when.occurred", label: "발생일(지출일·근무일)", group: "시간", appliesTo: ["date"], auto: false },
  { key: "when.period", label: "수행 기간", group: "시간", appliesTo: ["period"], auto: false },
  { key: "dim.category", label: "분석 분류(차원)", group: "분류", appliesTo: ["select", "radio", "text"], auto: false },
];

/** 카탈로그가 비어 있으면(DB 미적용 등) DEFAULT 로 폴백한다. */
export function catalogOrDefault(catalog: SemanticConceptItem[]): SemanticConceptItem[] {
  return catalog.length
    ? catalog
    : DEFAULT_SEMANTIC_CONCEPTS.map((d, i) => ({ ...d, sortOrder: i, active: true }));
}

/** 특정 필드/표 열 타입에 수동으로 붙일 수 있는 활성 개념 목록(빌더 드롭다운용, auto 제외). */
export function conceptsForType(catalog: SemanticConceptItem[], type: string): SemanticConceptItem[] {
  return catalogOrDefault(catalog).filter((c) => c.active && !c.auto && c.appliesTo.includes(type));
}

/** 개념 key → 라벨(미등록 key 는 key 그대로 표시). */
export function conceptLabel(catalog: SemanticConceptItem[], key: string | undefined): string | null {
  if (!key) return null;
  const hit = catalogOrDefault(catalog).find((c) => c.key === key);
  return hit ? hit.label : key;
}
