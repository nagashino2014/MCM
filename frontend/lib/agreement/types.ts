// 계약서 작성 시스템 — 공용 타입·상수 (클라이언트/서버 공용: DB import 금지)
// 설계: docs/contract-agreement-blueprint.md (2026-08-10 확정).
// 문서 IR(AgreementSpec)은 갑지(cover) + 조문(clauses) 2부 구조다. 갑지는 착수계·준공계의
// DocBlock(lib/deliverable/types.ts)을 재사용해 값 바인딩·표 병합을 표현하고, 조문은 조 단위
// 배열로 관리해 렌더 시 번호를 자동 재부여한다(삽입·삭제에 안전).
// 문서 원본 = approval_docs.field_values(frm-agreement), 대장 = contract_agreements(147).
// 계약서 고유 대외번호는 없다(전자결재 일반 채번만 — ③ 확정).

import type { DocBlock } from "@/lib/deliverable/types";

export const AGREEMENT_FORM_ID = "frm-agreement";

// ── 용역 분류 (계약관리 CONTRACT_SERVICE_OPTIONS 와 동일 축) ──
// 표준 셋 템플릿(agreement_templates)이 대분류-세분류당 활성 1개로 매핑된다(견적 기준 세트 패턴).

// ── 조문 ──

export interface AgreementClause {
  /** 안정 키 — 번호 재부여와 무관하게 편집·삽입 추적용 */
  id: string;
  /** "계약의 목적" — 렌더 시 노포맷에 따라 "제 1 조 (계약의 목적)" 등으로 조립 */
  title: string;
  /** 항(①②…)·호(1. 2.…) 포함 본문. 줄바꿈 보존, {{바인딩}} 토큰 치환 지원 */
  body: string;
  /**
   * 구조 데이터에서 본문이 자동 생성되는 조. payment = 지급 단계 배열(payments)로부터
   * "제N조 (용역금액의 지급방법)" 본문을 조립한다(갑지 "대금 지급 조건"과 단일 원천).
   */
  binding?: "payment" | null;
}

/** 조 번호 표기 — A형 "제 1 조 (계약의 목적)" | C형(엘에스엠앤엠류) "제1조 [총칙]" */
export type ClauseNoFormat = "paren" | "bracket";

export function clauseHeading(no: number, title: string, format: ClauseNoFormat): string {
  return format === "bracket" ? `제${no}조 [${title}]` : `제 ${no} 조 (${title})`;
}

// ── 지급 단계 (갑지 지급조건 문구 + 지급방법 조문의 단일 원천) ──

export interface PaymentStep {
  /** 착수금 | 계약금 | 중도금 | 잔금 | 준공금 … 자유 입력 */
  label: string;
  /** 비율(%) — 금액 자동 분배용. null 이면 금액 직접 입력 */
  ratio: number | null;
  /** 공급가 기준 금액(원, VAT 별도) */
  amount: number;
  /** 지급 시점 문구 — "계약 완료 후 현금 지급" 등 */
  condition: string;
}

// ── 문서 IR ──

export interface AgreementClausePage {
  /** 별지 제목 — "용역계약 조건", "용역 도급 일반조건" */
  title: string;
  /**
   * 전문 — "{{orderer.name}}(이하 "발주자"라 함)과 … 계약을 다음과 같이 체결한다."
   * 없으면 제1조부터 시작(C형).
   */
  preamble?: string;
  noFormat: ClauseNoFormat;
  clauses: AgreementClause[];
  /** 말미 문구 — "위와 같이 계약하며, … 각각 1부씩 보관한다." 날짜·서명은 렌더러가 뒤에 붙인다 */
  closing?: string;
  /** 말미에 날짜·양측 서명 블록을 붙일지 (A형 실측은 붙음) */
  signAfterClosing?: boolean;
}

export interface AgreementSpec {
  /** 갑지 — DocBlock 배열(표 병합·바인딩은 deliverable 과 동일 문법) */
  coverBlocks: DocBlock[];
  /** 별지 조문 — B형(1장 갑지)은 없음 */
  clausePage?: AgreementClausePage;
  /** 당사자 호칭 — 조문 본문이 이 용어를 그대로 쓰므로 표기용 참고 정보 */
  terms: { orderer: string; contractor: string };
}

// ── field_values (approval_docs.field_values 저장 형태 — 문서 원본) ──
// 템플릿의 조문은 기안 시점에 clauses 로 통째 스냅되므로 이후 템플릿 수정과 무관하다.

export interface AgreementOrdererInfo {
  facilityId: string | null;
  name: string;
  ceo: string;
  address: string;
  bizNo: string;
  phone: string;
}

export interface AgreementRecipient {
  name: string;
  deptName?: string;
  title?: string;
  email: string;
  facilityName?: string;
  facilityId?: string;
}

export interface AgreementFieldValues {
  templateId: string | null;
  /** 연결 계약/견적 (참조만 — contracts 자동 생성 없음, ⑤ 확정) */
  contractId?: string | null;
  quotationId?: string | null;
  serviceType?: string;
  serviceSubtype?: string;
  /** 계약명 */
  title: string;
  orderer: AgreementOrdererInfo;
  /** 공급가(원, VAT 별도) — 세액·합계·한글 표기는 파생 */
  amountSupply: number;
  payments: PaymentStep[];
  /** 계약기간 문구 — "계약일 부터 통합환경 허가재검토 용역 완료 시 까지" */
  periodText: string;
  /** 용역범위(업무범위) — 갑지·조문 {{contract.scope}} 로 삽입 */
  scopeText: string;
  /** 체결일 YYYY-MM-DD */
  issueDate: string;
  /** 첨부 표기 — "용역계약 조건 1부." 등 (없으면 생략) */
  attachNote?: string;
  /** 기안 시점 조문 스냅(템플릿 로드 후 편집 결과). B형이면 빈 배열 */
  clauses: AgreementClause[];
  /** 조문 없이 갑지만인지(템플릿 clausePage 유무 스냅) */
  hasClausePage: boolean;
  /** 발송 수신 담당자(승인 후 수동 발송 시 확정 — ① 확정) */
  recipients?: AgreementRecipient[];
  /** 동봉 첨부 S3 키 [{key,name,size}] */
  attachments?: { key: string; name: string; size: number }[];
}

// ── 대장(contract_agreements) ──

export type AgreementSendStatus = "draft" | "approved" | "sending" | "sent" | "failed";

export const AGREEMENT_SEND_STATUS_LABEL: Record<AgreementSendStatus, string> = {
  draft: "결재 진행 중",
  approved: "승인(발송 대기)",
  sending: "발송 중",
  sent: "발송 완료",
  failed: "발송 실패",
};

export interface AgreementRow {
  agreementId: string;
  docId: string;
  templateId: string | null;
  templateName: string | null;
  contractId: string | null;
  quotationId: string | null;
  counterpartyFacilityId: string | null;
  title: string;
  serviceType: string | null;
  serviceSubtype: string | null;
  amountSupply: number | null;
  amountVat: number | null;
  amountTotal: number | null;
  drafterName: string | null;
  fieldSnapshot: AgreementFieldValues | null;
  pdfKey: string | null;
  hwpxKey: string | null;
  generatedAt: string | null;
  sendStatus: AgreementSendStatus;
  sendError: string | null;
  sendAttempts: number;
  sentAt: string | null;
  sentTo: unknown;
  createdAt: string;
  updatedAt: string;
}

// ── 템플릿(agreement_templates) ──

export type AgreementTemplateKind = "standard" | "custom";
export type AgreementTemplateStatus = "active" | "draft" | "archived";

export interface AgreementTemplateRow {
  templateId: string;
  name: string;
  kind: AgreementTemplateKind;
  serviceType: string | null;
  serviceSubtype: string | null;
  version: number;
  status: AgreementTemplateStatus;
  originFacilityId: string | null;
  originFacilityName: string | null;
  spec: AgreementSpec;
  sourceKind: string | null;
  sourceKey: string | null;
  analyzedAt: string | null;
  analyzeNote: string | null;
  createdAt: string;
  updatedAt: string;
  /** 코드 시드(catalog.ts) 폴백 여부 — DB 에 없는 세분류를 시드로 노출할 때 true */
  seeded?: boolean;
}
