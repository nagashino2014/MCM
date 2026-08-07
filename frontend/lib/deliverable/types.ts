// 착수계·준공계 작성 시스템 — 공용 타입·상수 (클라이언트/서버 공용: DB import 금지)
// 설계: docs/contract-deliverables-blueprint.md.
// 문서 IR(DeliverableSpec)은 기본양식 상수(catalog.ts)와 발주처 자체양식
// (deliverable_templates.spec, infra/aws/142)이 공유한다. PDF·HWPX 렌더러, 웹 편집기,
// AI 양식 분석이 모두 이 구조 하나만 소비하므로 양식 출처에 따른 렌더 분기가 없다.
// 결재는 태우지 않는다(공문 결재로 갈음 — 2026-08-07 사용자 확정).

export type DeliverableKind = "start" | "completion";

export const DELIVERABLE_KIND_LABEL: Record<DeliverableKind, string> = {
  start: "착수계",
  completion: "준공계",
};

export type Align = "left" | "center" | "right";

// ── 페이지 레이아웃(pt) — A4. 공문(lib/letter/types.ts)과 달리 1장 강제가 아니라
//    서식 1종 = 1페이지로 이어 붙인다. 여백은 실물 착수계·준공계의 통상값. ──
export const PAGE_W = 595.28;
export const PAGE_H = 841.88;

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGINS: Margins = { top: 68, right: 57, bottom: 57, left: 57 };

/** 본문 기본 글자 크기(pt) — 실물 착수계·준공계 실측 근사값 */
export const DEFAULT_BODY_PT = 12;
export const DEFAULT_TITLE_PT = 20;

// ── 값 포맷 ──
// amountBoth 는 실물 표기 "일금 구천삼백칠십팔만일천오백 원정(￦ 93,781,500–VAT 포함)" 형태.
// VAT 문구는 계약별로 다르므로 값(meta.vatNote)에서 가져온다.
export type FieldFormat =
  | "text"
  | "amountHangul" // 일금 일억칠천일백오십만원정
  | "amountNumber" // ￦171,500,000
  | "amountBoth" // 일금 …원정(￦… – VAT 포함)
  | "dateDotted" // 2024. 10. 04.
  | "dateKorean" // 2025년  07월  01일
  | "dateSpaced" // 2026년    7월     17일 (작성일 서명 위 표기)
  | "period" // 2026년 05월 28일 ~ 2026년 07월 24일
  | "percent" // 100%
  | "multiline"; // 첨부자료 목록 등 줄바꿈 보존

/** 값이 들어갈 자리 — 라벨-값 행 1줄. 착수계 계약금액처럼 값이 2행인 경우 secondLine 사용. */
export interface FieldRow {
  /** 양식에 인쇄된 라벨. 실물의 자간 공백("계   약   명")을 문자열 그대로 보존한다. */
  label: string;
  /** 바인딩 키(DELIVERABLE_BINDINGS). 없으면 text 고정 문구 */
  binding?: string;
  text?: string;
  format?: FieldFormat;
  /** 값 뒤에 붙는 고정 문구("VAT포함" 등) */
  suffix?: string;
  /** 값 둘째 행(착수계 금액: 1행 한글금액 / 2행 숫자금액+VAT표기) */
  secondLine?: { binding?: string; text?: string; format?: FieldFormat; suffix?: string };
}

export interface ColSpec {
  /** 열 폭 비율(합 1) */
  widthRatio: number;
  align?: Align;
}

export interface CellSpec {
  text?: string;
  binding?: string;
  format?: FieldFormat;
  align?: Align;
  bold?: boolean;
  colSpan?: number;
  rowSpan?: number;
  /** 병합으로 가려지는 자리(렌더 시 건너뜀) */
  merged?: boolean;
}

export type DocBlock =
  /** 좌상단 표기 "[첨부 1]" */
  | { kind: "note"; text: string; align?: Align }
  | { kind: "title"; text: string; fontPt?: number; letterSpacingPt?: number; underline?: boolean }
  | {
      kind: "fields";
      numbering: "none" | "decimal" | "square";
      rows: FieldRow[];
      /** 라벨 열 폭(pt). 미지정 = 최장 라벨 실측 폭 */
      labelWidthPt?: number;
      /** 행 간격(pt) */
      rowGapPt?: number;
      indentPt?: number;
    }
  | { kind: "table"; columns: ColSpec[]; rows: CellSpec[][]; caption?: string }
  /** 본문 문구. {{바인딩}} 토큰을 값으로 치환한다 */
  | { kind: "para"; text: string; align?: Align; indentPt?: number; lineHeightPct?: number }
  | { kind: "dateLine"; binding: string; format: FieldFormat; align?: Align }
  | { kind: "signature"; rows: FieldRow[]; align?: Align; stamp?: boolean; indentPt?: number }
  | { kind: "receiver"; binding: string; suffix: string; fontPt?: number; align?: Align; bold?: boolean }
  /** 우상단 확인란 박스(발주처 양식의 "감독자 서명" 등) */
  | { kind: "stampBox"; label: string; widthPt?: number; heightPt?: number }
  | { kind: "spacer"; heightPt: number };

export interface DeliverableSpec {
  /** 카탈로그 키(catalog.ts) 또는 자체양식의 "custom:<slug>" */
  docType: string;
  /** 서식 선택 체크박스·페이지 목록 표기명 */
  title: string;
  kind: DeliverableKind;
  page?: { margins?: Partial<Margins>; bodyPt?: number };
  blocks: DocBlock[];
}

// ── 바인딩 카탈로그 ──
// 편집기 드롭다운 · AI 분석 프롬프트 · 자동 채움 로더가 공유하는 단일 목록.
// 값 산출은 lib/deliverable/data.ts(D1)가 담당한다.

export interface BindingDef {
  key: string;
  label: string;
  group: "계약" | "준공" | "발주처" | "자사" | "작성";
  format: FieldFormat;
  /** 자동 채움 불가(사용자 입력) 항목 */
  manual?: boolean;
  hint?: string;
}

export const DELIVERABLE_BINDINGS: BindingDef[] = [
  { key: "contract.title", label: "계약명·용역명", group: "계약", format: "text" },
  { key: "contract.amount", label: "계약금액·용역금액", group: "계약", format: "amountBoth" },
  { key: "contract.date", label: "계약일", group: "계약", format: "dateKorean" },
  { key: "contract.startDate", label: "착수일", group: "계약", format: "dateKorean" },
  { key: "contract.endDate", label: "준공예정일·완료일자", group: "계약", format: "dateKorean" },
  { key: "contract.period", label: "계약기간", group: "계약", format: "period" },
  { key: "contract.orderNo", label: "발주번호", group: "계약", format: "text", manual: true, hint: "발주처 부여 번호" },
  { key: "site.name", label: "사업장명", group: "계약", format: "text" },
  { key: "site.address", label: "용역위치·사업장 주소", group: "계약", format: "text" },
  { key: "completion.actualDate", label: "실준공일", group: "준공", format: "dateKorean" },
  { key: "completion.currentAmount", label: "준공기성금액(금회)", group: "준공", format: "amountBoth" },
  { key: "completion.cumulativeAmount", label: "누계준공금액", group: "준공", format: "amountBoth" },
  // 앞열 = 준공금(잔금) 이전의 기존 청구액. 2단계 계약은 '전회', 3단계 이상은 '기지급'으로 표기된다.
  { key: "completion.prevSupply", label: "기지급(전회) 공급가액", group: "준공", format: "amountNumber" },
  { key: "completion.prevVat", label: "기지급(전회) 부가세", group: "준공", format: "amountNumber" },
  { key: "completion.prevTotal", label: "기지급(전회) 합계", group: "준공", format: "amountNumber" },
  { key: "completion.curSupply", label: "금회 공급가액", group: "준공", format: "amountNumber" },
  { key: "completion.curVat", label: "금회 부가세", group: "준공", format: "amountNumber" },
  { key: "completion.curTotal", label: "금회 합계", group: "준공", format: "amountNumber" },
  { key: "completion.cumSupply", label: "누계 공급가액", group: "준공", format: "amountNumber" },
  { key: "completion.cumVat", label: "누계 부가세", group: "준공", format: "amountNumber" },
  { key: "completion.cumTotal", label: "누계 합계", group: "준공", format: "amountNumber" },
  { key: "completion.progressRate", label: "공정율", group: "준공", format: "percent" },
  { key: "completion.attachList", label: "첨부자료 목록", group: "준공", format: "multiline", manual: true },
  { key: "orderer.name", label: "발주처명", group: "발주처", format: "text" },
  { key: "company.name", label: "자사 상호", group: "자사", format: "text" },
  { key: "company.address", label: "자사 주소", group: "자사", format: "text" },
  { key: "company.ceo", label: "자사 대표자", group: "자사", format: "text" },
  { key: "company.bizNo", label: "자사 사업자번호", group: "자사", format: "text" },
  { key: "issue.date", label: "작성일", group: "작성", format: "dateSpaced" },
  { key: "meta.vatNote", label: "VAT 표기", group: "작성", format: "text", hint: "VAT 포함 | VAT 별도" },
  {
    key: "meta.priorLabel",
    label: "준공금액 표 앞열 제목",
    group: "작성",
    format: "text",
    hint: "대금지급단계 2단계=전회 / 3단계 이상=기지급",
  },
];

export const BINDING_LABEL: Record<string, string> = Object.fromEntries(
  DELIVERABLE_BINDINGS.map((b) => [b.key, b.label])
);

/** field_values 저장 형태 — 바인딩 키 → 확정값(원시 문자열·숫자). 렌더 시 format 이 적용된다. */
export type DeliverableValues = Record<string, string | number | null>;

/** 자동 채움값을 사용자가 수동 수정했는지(잠금 해제) — 초과근무 양식 UX 답습 */
export type DeliverableUnlocked = Record<string, boolean>;

// ── 저장 행(contract_deliverables) ──

export type DeliverableStatus = "draft" | "ready" | "attached" | "sent";

export const DELIVERABLE_STATUS_LABEL: Record<DeliverableStatus, string> = {
  draft: "작성 중",
  ready: "작성 완료",
  attached: "공문 첨부됨",
  sent: "발송 완료",
};

export interface DeliverableRow {
  deliverableId: string;
  contractId: string;
  kind: DeliverableKind;
  templateId: string | null; // null = 기본양식
  templateName: string | null;
  docTypes: string[];
  title: string;
  values: DeliverableValues;
  unlocked: DeliverableUnlocked;
  pdfKey: string | null;
  hwpxKey: string | null;
  generatedAt: string | null;
  letterDocId: string | null;
  letterNo: string | null;
  status: DeliverableStatus;
  drafterName: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── 발주처 자체양식(deliverable_templates) ──

export type TemplateSourceKind = "hwpx" | "docx" | "pdf";

export interface DeliverableTemplateRow {
  templateId: string;
  name: string;
  kind: DeliverableKind;
  /** 이 양식을 요구하는 발주처 = 계약상대 업체(facilities) */
  ownerFacilityId: string | null;
  ownerFacilityName: string | null;
  sourceKind: TemplateSourceKind | null;
  sourceKey: string | null;
  sourcePages: number | null;
  specs: DeliverableSpec[];
  analyzedAt: string | null;
  analyzeModel: string | null;
  analyzeNote: string | null;
  createdAt: string;
  updatedAt: string;
}
