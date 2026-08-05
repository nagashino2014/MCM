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

/** MD 매트릭스 등급 축 — 별첨1 실물 4열("기술사 or 특급"/고급/중급/초급). 첫 열 단가는 특급 적용 */
export const MD_GRADES = ["특급", "고급", "중급", "초급"] as const;
export type MdGrade = (typeof MD_GRADES)[number];

/** 노임단가 표시용 전체 등급(별첨2) — 기술사 포함 5행 */
export const LABOR_GRADES = ["기술사", "특급", "고급", "중급", "초급"] as const;

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
  overheadRate: number; // 제경비율 (직접인건비 대비, 표준 1.10)
  techFeeRate: number; // 기술료율 ((직접인건비+제경비) 대비, 표준 0.20)
  directExpenseRate: number; // 직접경비율 (직접인건비 대비, 상주 시 0.30 등. 기본 0)
  laborRates: LaborRates; // 산정 당시 노임단가 스냅샷
  laborYear: string; // 노임단가 적용 연도
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
  result: "pending" | "won" | "lost" | "dropped";
  createdAt: string;
}
