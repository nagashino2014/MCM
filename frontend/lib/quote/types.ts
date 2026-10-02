// 견적서 작성·발송 시스템 — 공용 타입·상수 (클라이언트/서버 공용: DB import 금지)
// 설계: docs/quotation-blueprint.md. 문서 원본 = approval_docs.field_values(아래 규약),
// 발송 대장 = quotations(infra/aws/136). 산정·역산 순수 함수는 lib/quote/rates.ts.

export const QUOTE_FORM_ID = "frm-quotation";

/** 채번 rule_key 접두 — 실제 키는 `견적:{용역 종류}` (docs.ts 가 {연도}-{종류}-{NNNN} 포맷으로 분기) */
export const QUOTE_RULE_PREFIX = "견적:";

/** 계약 대분류 → 견적번호 용역 종류 라벨 (2026-08-05 확정: 5종 독립 시퀀스) */
export const QUOTE_NO_LABEL_BY_SERVICE_TYPE: Record<string, string> = {
  통합허가: "통합허가",
  "장외&화관법": "화관법",
  HAPs: "HAPs",
  ESG탄소중립: "ESG",
  기타: "기타",
};

export function quoteRuleKey(serviceType: string): string {
  return QUOTE_RULE_PREFIX + (QUOTE_NO_LABEL_BY_SERVICE_TYPE[serviceType] ?? "기타");
}

export function quoteNoLabel(serviceType: string): string {
  return QUOTE_NO_LABEL_BY_SERVICE_TYPE[serviceType] ?? "기타";
}

/** 견적번호 `{연도}-{종류}-{NNNN}` — 직접 지정(관리자, 2026-09-30 공문 패턴 이식)·삭제 반납 파싱 공용 */
export function formatQuoteNo(year: string, label: string, seq: number): string {
  return `${year}-${label}-${String(seq).padStart(4, "0")}`;
}

export function parseQuoteNo(no: string): { year: string; label: string; seq: number } | null {
  const labels = Object.values(QUOTE_NO_LABEL_BY_SERVICE_TYPE).join("|");
  const m = new RegExp(`^(\\d{4})-(${labels})-(\\d{1,4})$`).exec((no ?? "").trim());
  if (!m) return null;
  const seq = Number(m[3]);
  return seq > 0 ? { year: m[1], label: m[2], seq } : null;
}

/** 용역 대분류→세분류 — 계약관리 CONTRACT_SERVICE_OPTIONS 와 동일(전 세분류 대응, 사용자 확정).
 *  작성 화면(QuoteBoard)과 기준 관리 화면(QuoteSettingsBoard)이 공유한다.
 *  2026-08-06 정정(사용자 지시): 영업허가는 장외&화관법 소속, 대분류와 중복인 '장외&화관법'
 *  항목 제외, '장외영향평가'→'화학사고예방관리계획' 개칭. 계약 데이터는 마이그 138 에서 정리. */
export const QUOTE_SERVICE_OPTIONS: { type: string; subtypes: string[] }[] = [
  { type: "통합허가", subtypes: ["최초허가", "변경허가", "변경신고", "통합교육", "사후관리", "재검토"] },
  { type: "장외&화관법", subtypes: ["영업허가", "화학사고예방관리계획", "설치검사", "화관법기준", "위해관리계획", "배출저감계획", "배출량조사", "판매업허가", "정기검사", "안전진단"] },
  { type: "HAPs", subtypes: ["HAPs", "HAPs최초", "HAPs변경", "HAPs연간", "시설구축", "명판부착", "배출저감", "정기점검대응"] },
  { type: "ESG탄소중립", subtypes: ["ESG탄소중립", "ESG경영", "CBAM", "공급망실사", "LCA평가", "배출량산정", "배출권관련"] },
  { type: "기타", subtypes: ["기타", "총량제신고", "매체별인허가", "환경자문", "환경R&D", "기타인허가"] },
];

/**
 * 복수 업무(2026-10-01) — 한 용역에 여러 세분류 업무가 섞인 견적(예: 사후관리 + 변경허가·신고 + 재검토).
 * 작성 화면의 용역 세분류 목록에만 추가되는 선택지이며 기준 세트는 없다 — 사업장별로 구성 업무(세분류×횟수)와
 * 업무 항목 트리를 직접(수동 입력 또는 산출내역서 엑셀 자동 분석) 구성해 역산한다.
 */
export const QUOTE_MULTI_SUBTYPE = "복수 업무";
/** 복수 업무 구성 업무 태그 최대 수 */
export const QUOTE_MULTI_WORK_MAX = 4;

/** 복수 업무의 구성 업무 태그 — 세분류 + 횟수 */
export interface QuoteWorkTag {
  /** 이 업무의 용역 대분류 — 없으면 기본 정보의 용역 분류(다른 대분류 업무도 섞을 수 있다) */
  serviceType?: string;
  subtype: string;
  count: number;
}

/**
 * 업무 항목 트리 편집 행(기준 관리 화면·작성 화면 공용, components/approval/QuoteItemTreeEditor).
 * 세부항목은 위쪽의 가장 가까운 대항목에 소속된다(대항목 MD 는 자동 소계).
 */
export interface QuoteTreeRow {
  label: string;
  isParent: boolean;
  baseMd: Record<string, number>;
}

/** 편집 행 → 역산 입력 항목(QuoteWorkItem). idPrefix 로 itemId 를 만든다 */
export function treeRowsToWorkItems(rows: QuoteTreeRow[], idPrefix: string): QuoteWorkItem[] {
  let lastParent = -1;
  return rows.map((r, i) => {
    if (r.isParent) lastParent = i;
    return {
      itemId: `${idPrefix}-${i}`,
      parentId: r.isParent ? null : lastParent >= 0 ? `${idPrefix}-${lastParent}` : null,
      label: r.label,
      sort: i,
      baseMd: r.isParent ? {} : r.baseMd,
    };
  });
}

/** 세트 항목(트리) → 편집 행 */
export function workItemsToTreeRows(items: { itemId: string; parentId: string | null; label: string; baseMd: Record<string, number> | MdVector }[]): QuoteTreeRow[] {
  const parentIds = new Set(items.map((i) => i.parentId).filter(Boolean));
  return items.map((i) => ({ label: i.label, isParent: parentIds.has(i.itemId), baseMd: { ...(i.baseMd as Record<string, number>) } }));
}

/**
 * MD 매트릭스 기본 등급 축 — 세트에 등급이 지정되지 않았을 때의 폴백이자 열 표시 순서.
 * 2026-08-07: 등급은 기준 세트별로 가변(마이그 143 quote_rate_sets.grades) — 기술사가 추가되거나
 * 특급·고급이 빠질 수 있다. 산정 엔진(rates.ts)은 이 상수가 아니라 base_md 의 키를 순회한다.
 */
export const MD_GRADES = ["특급", "고급", "중급", "초급"] as const;
export const DEFAULT_MD_GRADES: string[] = [...MD_GRADES];

/** 등급 라벨(가변) — 노임단가 등급 어휘(LABOR_GRADES)와 같은 값을 쓴다 */
export type MdGrade = string;

/** 노임단가 표시용 전체 등급(별첨2) — 기술사 포함 5행. 세트 등급 선택지의 원천이기도 하다. */
export const LABOR_GRADES = ["기술사", "특급", "고급", "중급", "초급"] as const;

/** 세트 등급 목록을 LABOR_GRADES 순서로 정렬(표시 순서 고정: 기술사→초급) */
export function sortGrades(grades: string[]): string[] {
  const order = new Map((LABOR_GRADES as readonly string[]).map((g, i) => [g, i]));
  return [...grades].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

/** 등급별 MD 벡터 — 없는 등급은 0 취급 */
export type MdVector = Partial<Record<MdGrade, number>>;

/** 등급별 노임단가(원/일) — quote_labor_rates 로드 결과 */
export type LaborRates = Record<string, number>;

// ── 산정 제약 (2026-08-05 2차 검토 확정) ──

/**
 * 합계-견적가 초과폭 상한(원): 직접인건비+제경비+기술료(+직접경비) 합계는 제출 견적가를
 * 반드시 상회하되 초과폭이 이 값 미만이어야 한다("약간의 네고" 어필 서사).
 */
export function sumOverCap(price: number): number {
  if (price <= 5_000_000) return 100_000;
  if (price <= 10_000_000) return 200_000;
  if (price <= 50_000_000) return 300_000;
  if (price <= 100_000_000) return 500_000;
  if (price <= 200_000_000) return 1_000_000;
  return 2_000_000;
}

/** MD 스냅 단위 — 1천만원 이상 0.5, 미만(소규모)은 0.1 (0.5 격자로는 좁은 상한 구간 진입 불가) */
export function mdSnapUnit(price: number): number {
  return price >= 10_000_000 ? 0.5 : 0.1;
}

// ── 요율 (표준요율 = 기본값, 건별 탄력 조정 — 사용자 확정) ──

export interface SiteRates {
  setId?: string; // 산정에 사용한 기준 세트 (T3 자유입력이면 없음)
  setVersion?: number;
  /** 산정 당시 등급 축 스냅샷(가변 등급, 143). 미지정이면 DEFAULT_MD_GRADES — 문서 열 순서의 기준 */
  grades?: string[];
  overheadRate: number; // 제경비율 (직접인건비 대비, 표준 1.10)
  techFeeRate: number; // 기술료율 ((직접인건비+제경비) 대비, 표준 0.20)
  directExpenseRate: number; // 직접경비율 (직접인건비 대비). 2026-09-30 입력 폐지 — 새 견적은 0, 옛 문서 재현용으로만 남는다
  laborRates: LaborRates; // 산정 당시 노임단가 스냅샷
  laborYear: string; // 노임단가 적용 연도
}

/**
 * 직접경비 산식 입력(2026-09-30 사용자 확정) — 직접경비 = 출장비(일단가×연인원수) + 인쇄비(부당 단가×총 부수).
 * 금액을 직접 입력하지 않고 산식 항목으로만 계산하며, 화면의 직접경비 요율 칸은 견적가 대비 비중 표시 전용이다.
 */
export interface DirectCosts {
  travelDayRate: number; // 출장비 일단가(원)
  travelPersonDays: number; // 출장비 인원(회당 인원). 옛 이름 '연인원수'
  travelTrips?: number; // 출장 횟수(회). 2026-09-30 추가 — 없으면(구 문서) 1회로 본다
  printUnitPrice: number; // 인쇄비 부당 단가(원)
  printCopies: number; // 인쇄비 총 부수
  // ── 엔지니어링 손해배상 공제료(2026-10-01) — 적용 시 직접경비에 포함 ──
  deductionOn?: boolean; // 공제료 적용 여부
  deductionExcessDays?: number; // 표준담보기간(3년) 초과일수
  deductionBaseRate?: number; // 1단계 기본요율(%) 직접 지정 — 없으면 요율표(가입금액 구간별)
  deductionAddRate?: number; // 1단계 가산요율(%) 직접 지정 — 없으면 요율표
  deductionBase?: number; // 산정 기준 금액(순계약금액 = 제출 견적가) 스냅샷
  deductionAmount?: number; // 공제료(원, 천원 미만 절사) — 견적가에 따라 달라지므로 산정 시점 값을 저장한다
}

/**
 * 엔지니어링 손해배상 공제료(엔지니어링공제조합, 엔지니어링산업진흥법 제31조·시행령 제42조).
 *   공제료 = 1단계 + 2단계 (천원 미만 절사)
 *   1단계 = 공제가입금액 × [기본요율 + {가산요율 × (표준담보기간 초과일수 / 365)}]  (가입금액 구간별 요율 적용)
 *   2단계 = 공제가입금액 × 0.16%
 * 산식은 2026-10-01 공제조합 홈페이지(업무안내 > 공제료 > 산출방법)로 재확인. 요율표는 조합이 공시하지 않아
 * 발주처 산출내역서(2026년, 환경부문 대기관리, 표준담보기간 3년)의 값을 기본으로 쓰고 견적마다 고칠 수 있다.
 * 공제가입금액(순계약금액)은 제출 견적가로 본다(사용자 확정).
 */
export const ENG_DEDUCTION_BANDS: { max: number | null; base: number; add: number }[] = [
  { max: 500_000_000, base: 0.599, add: 0.096 },
  { max: 1_000_000_000, base: 0.579, add: 0.093 },
  { max: 2_000_000_000, base: 0.561, add: 0.09 },
  { max: 3_000_000_000, base: 0.543, add: 0.088 },
  { max: null, base: 0.525, add: 0.084 },
];
export const ENG_DEDUCTION_STAGE2_RATE = 0.16; // 2단계 요율(%)
export const ENG_DEDUCTION_STD_YEARS = 3; // 표준담보기간(년)

/** 요율을 직접 지정했는지 — 지정하면 구간 누진 없이 단일 요율로 계산한다 */
export function hasCustomDeductionRate(d?: DirectCosts): boolean {
  return d?.deductionBaseRate != null || d?.deductionAddRate != null;
}

/** 공제료 계산 — amount = 공제가입금액(제출 견적가). 적용하지 않으면 전부 0 */
export function engineeringDeduction(amount: number, d?: DirectCosts): { stage1: number; stage2: number; total: number } {
  if (!d?.deductionOn || !(amount > 0)) return { stage1: 0, stage2: 0, total: 0 };
  const excess = Math.max(0, d.deductionExcessDays ?? 0) / 365;
  let stage1 = 0;
  if (hasCustomDeductionRate(d)) {
    const base = d.deductionBaseRate ?? ENG_DEDUCTION_BANDS[0].base;
    const add = d.deductionAddRate ?? ENG_DEDUCTION_BANDS[0].add;
    stage1 = (amount * (base + add * excess)) / 100;
  } else {
    let floor = 0;
    for (const b of ENG_DEDUCTION_BANDS) {
      const part = Math.min(amount, b.max ?? Infinity) - floor;
      if (part <= 0) break;
      stage1 += (part * (b.base + b.add * excess)) / 100;
      floor = b.max ?? Infinity;
    }
  }
  const stage2 = (amount * ENG_DEDUCTION_STAGE2_RATE) / 100;
  return { stage1, stage2, total: Math.floor((stage1 + stage2) / 1000) * 1000 };
}

/** 저장된 공제료(원) — 적용 중일 때만 */
export function deductionCostOf(d?: DirectCosts): number {
  return d?.deductionOn ? Math.round(d.deductionAmount ?? 0) : 0;
}

export function travelTripsOf(d?: DirectCosts): number {
  return d?.travelTrips ?? 1;
}

/** 출장비 = 일단가 × 인원 × 출장 횟수 */
export function travelCostOf(d?: DirectCosts): number {
  return Math.round((d?.travelDayRate ?? 0) * (d?.travelPersonDays ?? 0) * travelTripsOf(d));
}

export function printCostOf(d?: DirectCosts): number {
  return Math.round((d?.printUnitPrice ?? 0) * (d?.printCopies ?? 0));
}

/** 산식 직접경비 합계(원) — 인건비와 무관한 고정액이라 역산에서 먼저 빼고 MD 를 분배한다 */
export function fixedDirectExpense(d?: DirectCosts): number {
  return travelCostOf(d) + printCostOf(d) + deductionCostOf(d);
}

/** 견적서 직접경비 행 비고 — 산식 항목은 [별첨 3]으로 안내, 옛 문서(요율분)는 종전 표기 */
export function directExpenseNote(site: { directCosts?: DirectCosts; rates: SiteRates }): string {
  const parts = [
    travelCostOf(site.directCosts) > 0 && "출장비",
    printCostOf(site.directCosts) > 0 && "인쇄비",
    deductionCostOf(site.directCosts) > 0 && "손해배상 공제료",
  ].filter(Boolean);
  const legacy = site.rates.directExpenseRate > 0 ? `(직접인건비) × ${Math.round(site.rates.directExpenseRate * 100)}%` : "";
  const formula = parts.length ? `${parts.join(" + ")} [별첨 3]` : "";
  return [formula, legacy].filter(Boolean).join(" + ");
}

/** 별첨2 산정 기준표의 직접경비 행 — 출장비·인쇄비 중 금액이 있는 것만(내역은 별첨 3) */
export function directCostBasisRows(d?: DirectCosts): { c1: string; c2: string; amount: number }[] {
  const rows: { c1: string; c2: string; amount: number }[] = [];
  if (travelCostOf(d) > 0) rows.push({ c1: "출장비", c2: "실비 산정 [별첨 3]", amount: travelCostOf(d) });
  if (printCostOf(d) > 0) rows.push({ c1: "인쇄비", c2: "실비 산정 [별첨 3]", amount: printCostOf(d) });
  if (deductionCostOf(d) > 0) rows.push({ c1: "손해배상 공제료", c2: ENG_DEDUCTION_NOTE, amount: deductionCostOf(d) });
  return rows;
}

/** 견적서의 공제료 항목 비고(산정기준) 문구 — 순계약금액 대신 제출 견적가로 계산했음을 밝힌다(2026-10-01 사용자 요청) */
export const ENG_DEDUCTION_NOTE = "견적가 기준으로 산정";

/** [별첨 3] 직접경비 산출내역 행 — 산식(일단가 × 인원 × 횟수, 부당 단가 × 부수)과 금액. note = 비고 열(없으면 '-') */
export function directCostDetailRows(d?: DirectCosts): { label: string; formula: string; amount: number; note?: string }[] {
  const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
  const rows: { label: string; formula: string; amount: number; note?: string }[] = [];
  if (travelCostOf(d) > 0)
    rows.push({ label: "출장비", formula: `일단가 ${won(d!.travelDayRate)}원 × ${d!.travelPersonDays}인 × ${travelTripsOf(d)}회`, amount: travelCostOf(d) });
  if (printCostOf(d) > 0) rows.push({ label: "인쇄비", formula: `부당 단가 ${won(d!.printUnitPrice)}원 × ${d!.printCopies}부`, amount: printCostOf(d) });
  if (deductionCostOf(d) > 0) {
    const custom = hasCustomDeductionRate(d);
    const base = d!.deductionBaseRate ?? ENG_DEDUCTION_BANDS[0].base;
    const add = d!.deductionAddRate ?? ENG_DEDUCTION_BANDS[0].add;
    const banded = !custom && (d!.deductionBase ?? 0) > (ENG_DEDUCTION_BANDS[0].max ?? 0);
    rows.push({
      label: "엔지니어링 손해배상 공제료",
      formula:
        `${won(d!.deductionBase ?? 0)}원 × [기본요율 ${base}% + 가산요율 ${add}% × (초과 ${d!.deductionExcessDays ?? 0}일/365)]` +
        `${banded ? "(가입금액 구간별 요율)" : ""} + ${won(d!.deductionBase ?? 0)}원 × ${ENG_DEDUCTION_STAGE2_RATE}% (천원 미만 절사)`,
      amount: deductionCostOf(d),
      note: ENG_DEDUCTION_NOTE,
    });
  }
  return rows;
}

export const STANDARD_OVERHEAD_RATE = 1.1;
export const STANDARD_TECH_FEE_RATE = 0.2;

// ── 업무 항목(별첨1 행)·산정 결과 ──

/** 기준 세트의 업무 항목(트리 평탄화 행) — quote_rate_items 로드 결과 */
export interface QuoteWorkItem {
  itemId: string;
  parentId: string | null;
  label: string;
  sort: number;
  baseMd: MdVector; // 표준 MD = 역산 분배 가중치의 원천
}

/** 산정 결과 MD 행 (문서·저장용) */
export interface MdMatrixRow {
  itemId: string; // T3 수동 행은 'manual-N'
  parentId: string | null;
  label: string;
  md: MdVector;
  overridden?: boolean; // 역산 결과에서 수동 조정된 행 표시
}

/** 사업장 라인 금액 요약 (quotation_sites.amounts) */
export interface SiteAmounts {
  standard?: number; // 정방향 표준가 (가이드 — 인자 기반 산정 시)
  laborCost: number; // 직접인건비 (MD × 단가 합)
  overhead: number; // 제경비
  techFee: number; // 기술료
  directExpense: number; // 직접경비 (0이면 문서에서 행 생략)
  sum: number; // 합 계 금 액 (> final 강제)
  final: number; // 최종 견적 금액 = 제출가 (사용자 입력)
}

/** 상황 변수(건별 상황 조정 레이어) 항목 */
export interface SituationEntry {
  code: string; // quote_situation_codes.code
  rate?: number; // 조정률 (예: -0.05)
  amount?: number; // 조정액 (원, rate 대신)
  scope: "doc" | number; // 문서 전체 또는 site_seq
  memo?: string;
}

// ── field_values 규약(approval_docs, frm-quotation) ──

/** 수신처 — 공문과 동일 구조(사업장 검색·간편 등록). 참조(cc_refs)가 실제 메일 To */
export interface QuoteRecipient {
  contactId?: string;
  facilityId?: string;
  name: string;
  deptName?: string;
  title?: string;
  email?: string;
  phone?: string; // 견적서 수신 블록 TEL 표기(선택)
  facilityName?: string;
}

/** 사업장별 견적 라인 (field_values.sites[n] = quotation_sites 미러) */
export interface QuoteSite {
  siteSeq: number;
  facilityId?: string;
  siteLabel: string; // 시트명·총괄 행 라벨
  subjectLine: string; // 건명 ("OO공장 통합환경허가 취득 용역")
  factors?: Record<string, number>; // 정방향 인자값 (T1)
  mdMatrix: MdMatrixRow[]; // 최종 MD (T3 자유입력이면 빈 배열 가능)
  freeItems?: { label: string; amount: number; note?: string }[]; // T3 품목 직접 입력
  directCosts?: DirectCosts; // 직접경비 산식(출장비·인쇄비). 없으면 0
  works?: QuoteWorkTag[]; // 복수 업무 — 구성 업무(세분류×횟수) 태그, 최대 4개
  customItems?: QuoteTreeRow[]; // 복수 업무 — 이 사업장 전용 업무 항목 트리(역산 가중치의 원천)
  rates: SiteRates;
  amounts: SiteAmounts;
  remarks: string; // 특이사항
}

export interface QuoteFieldValues {
  subject: string; // 전체 건명 (총괄/갑지)
  service_type: string;
  service_subtype: string;
  send_mode: "mail" | "direct"; // 메일 발송 | 직접 제출(다운로드)
  recipients: QuoteRecipient[]; // 수신처(사업장)
  cc_refs: QuoteRecipient[]; // 참조 담당자(메일 To — send_mode=mail 일 때 필수)
  issue_date: string; // 견적일 YYYY-MM-DD
  contact_email?: string; // 공급자 블록 담당자 E-mail (기본: 기안자 메일함 주소)
  contact_mobile?: string; // 담당자 Mobile (선택 입력)
  sites: QuoteSite[];
  situation?: SituationEntry[];
  attachments_list?: { name: string; key: string; size: number }[];
  sales_project_id?: string;
  // ── 버전 관리(재견적, 269 · 2026-10-01) — 원본 견적에는 없고 재견적 문서에만 채워진다 ──
  quote_root_doc_id?: string; // 같은 용역 건의 원본 견적 doc_id
  revision_of_doc_id?: string; // 복사해 온 직전 버전 doc_id
  quote_version?: number; // 저장 시 서버가 확정(상신된 버전 max+1)
  revision_reason?: QuoteRevisionReason; // 재견적 사유(필수)
  prev_total_amount?: number; // 직전 버전 제출 견적가 합계
}

/** 재견적 사유 — 금액변동 태그 옆의 부연 태그(사용자 확정 3종 + 2026-10-02 3종 추가) */
export const QUOTE_REVISION_REASONS = [
  { code: "scope_up", label: "용역 범위 증가" },
  { code: "scope_down", label: "용역 범위 축소" },
  { code: "nego", label: "네고 요청" },
  // 2026-10-02 추가(사용자 요청)
  { code: "typo_fix", label: "오기 수정" },
  { code: "amount_up", label: "금액 증가" },
  { code: "amount_down", label: "금액 감소" },
] as const;
export type QuoteRevisionReason = (typeof QUOTE_REVISION_REASONS)[number]["code"];
export const QUOTE_REVISION_REASON_LABEL: Record<string, string> = Object.fromEntries(QUOTE_REVISION_REASONS.map((r) => [r.code, r.label]));

/** 견적 이력 행(/api/quotes/revisions) — 상신된 버전(draft 제외) */
export interface QuoteRevisionItem {
  docId: string;
  version: number;
  quoteNo: string | null;
  status: string; // approval_docs.status
  submittedAt: string | null;
  sentAt: string | null; // 발송 완료 시각(quotations.sent_at)
  issueDate: string | null;
  drafterName: string | null;
  totalAmount: number;
  prevTotalAmount: number | null;
  revisionReason: string | null;
}

/** 총괄 견적서 시트 생성 기준 — 허가 대상 사업장 4개 이상 (사용자 확정) */
export const SUMMARY_SHEET_MIN_SITES = 4;

/** 견적 유효기간 문구 (고정 정책 — 사용자 확정) */
export const QUOTE_VALIDITY_TEXT = "견적일로부터 1개월";
export const QUOTE_VAT_TEXT = "(V.A.T별도)";

/** 회사 고정 정보 보강 — 실물 견적서 공급자 블록 표기(팩스·홈페이지는 letter/types 에 없음) */
export const COMPANY_FAX = "02-6312-9569";
export const COMPANY_HOMEPAGE = "www.koensain.kr"; // 2026-08-05 사용자 확정 표기

// ── 발송 대장 행(quotations) — records 탭 표시용 ──

export type QuoteSendStatus = "pending" | "generating" | "generated" | "sending" | "sent" | "failed";

export const QUOTE_SEND_STATUS_LABEL: Record<QuoteSendStatus, string> = {
  pending: "발송 대기",
  generating: "생성 중",
  generated: "생성 완료(직접 제출)",
  sending: "발송 중",
  sent: "발송 완료",
  failed: "발송 실패",
};

// ── 수주 결과(Q5) ──

export type QuoteResult = "pending" | "won" | "lost" | "dropped";

export const QUOTE_RESULT_LABEL: Record<QuoteResult, string> = {
  pending: "진행 중",
  won: "수주",
  lost: "실주",
  dropped: "중단",
};

/** 결과 사유 코드 — 실주·중단 원인 분석용(수주는 선택 입력). 137 quotations.result_reason */
export const QUOTE_RESULT_REASONS = [
  { code: "price", label: "가격 경쟁력" },
  { code: "spec", label: "기술·실적 평가" },
  { code: "schedule", label: "일정·수행능력" },
  { code: "relation", label: "관계·영업력" },
  { code: "cancelled", label: "발주 취소·보류" },
  { code: "etc", label: "기타" },
] as const;

export const QUOTE_RESULT_REASON_LABEL: Record<string, string> = Object.fromEntries(
  QUOTE_RESULT_REASONS.map((r) => [r.code, r.label])
);

/** 수주 분석 리포트 응답(§5-5 피드백 루프) — /api/quotes/report */
export interface QuoteReportBucket {
  key: string; // 세분류·상황코드·금액구간 라벨
  label: string;
  total: number; // 결과 확정 여부 무관 전체 건수
  decided: number; // won + lost (수주율 모수)
  won: number;
  lost: number;
  dropped: number;
  pending: number;
  winRate: number | null; // won / decided
  quotedAmount: number; // 견적 총액(전체)
  wonAmount: number; // 수주 금액(계약금액 없으면 견적가)
  amountWinRate: number | null; // 수주 금액 / 결과 확정 건 견적 총액
  lostGapPct: number | null; // 실주 건 (경쟁 낙찰가 / 우리 견적가) 중앙값 - 1 (음수 = 우리가 비쌌음)
  lostGapSamples: number;
}

export interface QuoteReportSuggestion {
  serviceType: string;
  serviceSubtype: string;
  setId: string | null;
  currentAdjust: number | null; // 세트의 현재 시장 보정계수
  suggestAdjust: number | null; // 제안값
  reason: string; // 제안 근거 문장
  samples: number;
}

export interface QuoteReport {
  from: string | null;
  to: string | null;
  kpi: {
    total: number;
    decided: number;
    won: number;
    lost: number;
    dropped: number;
    pending: number;
    winRate: number | null;
    quotedAmount: number;
    wonAmount: number;
    amountWinRate: number | null;
    avgDecideDays: number | null; // 견적일→결과 확정일 평균 소요일
  };
  bySubtype: QuoteReportBucket[];
  bySituation: QuoteReportBucket[];
  byAmountBand: QuoteReportBucket[];
  suggestions: QuoteReportSuggestion[];
}

/** 금액 구간(수주율 분석 축) — sumOverCap 구간과 동일한 눈금을 쓴다 */
export const QUOTE_AMOUNT_BANDS: { key: string; label: string; min: number; max: number | null }[] = [
  { key: "b1", label: "~5백만", min: 0, max: 5_000_000 },
  { key: "b2", label: "5백만~1천만", min: 5_000_000, max: 10_000_000 },
  { key: "b3", label: "1천만~5천만", min: 10_000_000, max: 50_000_000 },
  { key: "b4", label: "5천만~1억", min: 50_000_000, max: 100_000_000 },
  { key: "b5", label: "1억~2억", min: 100_000_000, max: 200_000_000 },
  { key: "b6", label: "2억~", min: 200_000_000, max: null },
];

export interface QuotationRow {
  quoteId: string;
  docId: string;
  quoteNo: string | null;
  year: string | null;
  title: string | null;
  serviceType: string | null;
  serviceSubtype: string | null;
  recipients: QuoteRecipient[];
  ccRefs: QuoteRecipient[];
  drafterName: string | null;
  issueDate: string | null;
  validUntil: string | null;
  totalAmount: number | null;
  xlsxKey: string | null;
  pdfKey: string | null;
  sendMode: "mail" | "direct";
  sendStatus: QuoteSendStatus;
  sendError: string | null;
  sendAttempts: number;
  sentAt: string | null;
  situation?: SituationEntry[];
  result: QuoteResult;
  resultNote?: string | null;
  resultAt?: string | null;
  resultAmount?: number | null;
  resultReason?: string | null;
  contractId?: string | null;
  // 버전 관리(269)
  rootDocId?: string | null;
  version?: number;
  revisionReason?: string | null;
  prevTotalAmount?: number | null;
  createdAt: string;
}
