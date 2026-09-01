// 공문 발송 시스템 — 공용 타입·상수 (클라이언트/서버 공용: DB import 금지)
// 설계: docs/official-letter-blueprint.md. 문서 원본 = approval_docs.field_values(아래 규약),
// 발송 대장 = official_letters(infra/aws/135). 레이아웃 수치는 '공문 기본 템플릿.hwp' 실측값.

export const LETTER_FORM_ID = "frm-official-letter";
export const LETTER_RULE_KEY = "대외"; // 채번 rule_key — {연도}-대외-{NNNNN}, 신규 연도 1001 시작
export const LETTER_SEQ_START = 1001; // 신규 연도 첫 일련번호

/** 공문번호 형식 — '2026-대외-01036' */
export const LETTER_NO_RE = /^(\d{4})-대외-(\d{4,5})$/;

export function formatLetterNo(year: string | number, seq: number): string {
  return `${year}-${LETTER_RULE_KEY}-${String(seq).padStart(5, "0")}`;
}

export function parseLetterNo(no: string): { year: string; seq: number } | null {
  const m = LETTER_NO_RE.exec((no ?? "").trim());
  return m ? { year: m[1], seq: Number(m[2]) } : null;
}

// ── 레이아웃 상수(pt) — 템플릿 HWP 실측: A4, 여백 L20mm/R18mm/T10mm/B7mm ──
export const PAGE_W = 595.28;
export const PAGE_H = 841.88;
export const MARGIN_L = 56.69;
export const MARGIN_R = 51.02;
export const MARGIN_T = 28.34;
export const MARGIN_B = 19.84;
export const BODY_INDENT = 65; // 본문 문단 좌 들여쓰기(사용자 지정)
export const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

// ── 회사 고정 정보(폴백 상수) — 작성 화면은 company_profile('default')값을 우선 사용 ──
export const COMPANY_KO = "주식회사 한국환경안전연구원";
export const COMPANY_EN = "Korean Environment Safety Institute Co. LTD.";
export const COMPANY_CEO = "이유억";
export const COMPANY_ADDRESS = "서울특별시 금천구 가산디지털1로 100, 12층 (가산동, 에이스골드타워)";
export const COMPANY_BIZ_NO = "557-86-00306";
export const COMPANY_PHONE = "02-6672-0035";
export const COMPANY_CONTACT_EMAIL = "kaikan00@naver.com";

// ── 중간표현(IR) — MailEditor HTML 파싱 결과. PDF·HWPX 렌더가 공통 소비 ──
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface ParagraphBlock {
  kind: "p";
  runs: TextRun[];
  align?: "left" | "center" | "right";
  indentPt?: number; // 에디터 들여쓰기(margin-left px→pt 환산). BODY_INDENT 에 가산
}

export interface TableCell {
  lines: TextRun[][]; // 셀 내 줄 단위 런
  align?: "left" | "center" | "right";
  // 셀 병합(2026-08-25) — rows 는 항상 rowCnt×colCnt 균일 격자를 유지하고,
  // 병합 시작 셀에 rowSpan/colSpan(>1)을, 병합에 덮인 자리에는 covered 플레이스홀더를 둔다.
  // 렌더러(pdf/hwpx)는 covered 를 건너뛰고 시작 셀을 span 크기로 그린다.
  rowSpan?: number;
  colSpan?: number;
  covered?: boolean;
}

export interface TableBlock {
  kind: "table";
  rows: TableCell[][];
  colRatios: number[]; // 열 폭 비율(합 1)
}

export type LetterBlock = ParagraphBlock | TableBlock;

// ── field_values 규약(approval_docs, 시스템 생성분) ──
// 수신처(recipients) = 업체/기관(사업장 검색·간편 등록 — 사용자 확정), 표기용.
// 참조(cc_refs) = 주소록 담당자(메일 보유) — **실제 메일 발송 대상(To)**.
export interface LetterRecipient {
  contactId?: string; // facility_contact_people id(참조자 — 주소록 선택 시)
  facilityId?: string; // facilities id(수신처 — 사업장 선택 시)
  name: string; // 수신처=업체/기관명 · 참조=담당자 성명
  deptName?: string;
  title?: string; // 직함
  email?: string;
  phone?: string; // 연락처(직접 입력 시 — 발송 대상 식별 보조)
  facilityName?: string; // 참조자 소속 업체명(표기 보조)
  address?: string; // 수신처 소재지(내용증명형 자동 채움용)
  bizNo?: string; // 수신처 사업자번호
}

/** 공문 동봉 첨부파일(작성 시 업로드 — S3 letters/drafts/, 발송 메일에 순서대로 첨부) */
export interface LetterFileAttachment {
  name: string;
  key: string; // S3 storage key
  size: number; // bytes
}

export interface ProofParty {
  company: string;
  address: string;
  bizNo: string;
  representative: string;
}

/**
 * 레이아웃 미세조정(사용자 확정 — 자동 배치의 잔여 오차를 웹 화면에서 보정).
 * 작성 화면 미리보기 모달에서 조정하며 field_values 에 저장돼 모든 재생성(발송·다운로드)에
 * 동일하게 반영된다. 미지정 항목은 자동 산출값을 쓴다.
 */
export interface LetterLayoutOverrides {
  /** 인감 가로 보정(pt, +우측). 기준: 인감 왼쪽 = 성명 오른쪽 끝 */
  stampDx?: number;
  /** 인감 세로 보정(pt, +위쪽) */
  stampDy?: number;
  /** 본문(표·붙임 포함) 글자 크기 강제(pt). 미지정 = A4 1장 자동 맞춤 */
  bodyFontPt?: number;
  /** 본문 줄 간격(%). 미지정 = 기본(PDF 160 / HWPX 180) */
  lineSpacingPct?: number;
  /** 서명줄 높이 단계 강제(0=기본 1=축소 2=최소). 미지정 = 자동 */
  gapLevel?: 0 | 1 | 2;
  /** 제목 글자 크기 강제(pt). 미지정 = 자간→축소 자동 로직 */
  subjectPt?: number;
}

export interface LetterFieldValues {
  letter_kind: "general" | "proof";
  recipients: LetterRecipient[]; // 수신(대표 1건 이상)
  cc_refs: LetterRecipient[]; // 참조(표기 + 메일 cc)
  proof_sender?: ProofParty; // proof(내용증명형) 전용
  proof_receiver?: ProofParty;
  subject: string; // = approval_docs.title
  body_html: string; // MailEditor 출력 HTML
  attachments_list: { no: number; text: string }[]; // 붙임 목록
  stamp: 0 | 1; // 인감 날인 여부
  include_hwpx: 0 | 1; // 발송 메일에 HWPX 동봉
  contact_phone: string; // 하단 담당 연락처(기본 회사 대표번호)
  contact_email: string;
  /** 하단 고정부에 회사 주소 한 줄 표기(2026-08-20 내부 의견) — 1=표기, 0/미지정=미표기.
   *  신규 작성은 표기가 기본이고, 값이 없는 과거 문서는 재생성해도 종전대로 나온다. */
  include_address?: 0 | 1;
  file_attachments?: LetterFileAttachment[]; // 동봉 첨부(발송 메일에 공문 뒤 순서대로)
  /** 이 공문에 첨부된 착수계·준공계 문서 id(142) — 발송 완료 시 상태·시행번호를 역기록한다 */
  deliverable_ids?: string[];
  /** 내부 참조자(전자결재 참조/열람자)에게 보낼 참조 메일 주소 기준.
   *  personal = 개인 메일(employee_profiles.email) / company = 회사 메일(@koensain.app).
   *  앱 전사 배포 전이라 기본은 personal(사용자 확정). */
  internal_cc_target?: "personal" | "company";
  layout_overrides?: LetterLayoutOverrides; // 레이아웃 미세조정(미리보기 모달)
  recipients_display?: string; // 양식별 조회 표시용 요약(저장 시 생성)
  letter_kind_display?: string;
}

// ── A4 1장 맞춤 파라미터 — PDF 측정으로 확정 후 HWPX 에 동일 적용 ──
// 실측(2025-대외-01001 PDF): 서명줄(사명·대표이사·인감)은 본문 길이와 무관하게 하단부 위
// 고정 배치. 본문이 길면 ① 서명줄을 아래로 내리고(간격 축소) ② 본문 폰트를 축소한다.
export interface FitParams {
  bodyFontPt: number; // 기본 11 → 10.5 → 10 → 9.5 → 9 (내용증명 등 장문에서 축소)
  gapLevel: 0 | 1 | 2; // 0=기본 여백, 1=여백 축소, 2=최소 여백(서명줄 최하단)
}

export const DEFAULT_FIT: FitParams = { bodyFontPt: 11, gapLevel: 0 };

/** gapLevel → 서명줄 baseline y(하단 기준 pt). 실측 기본 269pt. */
export const SIGNATURE_Y_BY_GAP: Record<0 | 1 | 2, number> = { 0: 269, 1: 231, 2: 193 };

// ── compose 출력 — 정형 프레임 + 본문 블록(PDF·HWPX 공통 입력) ──
export interface LetterLayout {
  kind: "general" | "proof";
  letterNo: string | null; // 미채번(미리보기) 시 null → "(채번 예정)" 표기
  issueDate: string; // YYYY. MM. DD.
  subject: string;
  // general
  receiverText?: string; // 수신란 표기(예: "삼성전기㈜ 부산사업장")
  refText?: string; // 참조란 표기(예: "안전환경팀 변성욱 프로")
  // proof
  proofSender?: ProofParty;
  proofReceiver?: ProofParty;
  bodyBlocks: LetterBlock[];
  attachItems: string[]; // 붙임 항목(번호 제외 텍스트)
  stamp: boolean;
  contactName: string; // 담당(기안자 스냅샷)
  contactPosition: string;
  contactPhone: string;
  contactEmail: string;
  /** 하단 고정부 주소 표기 여부 — 켜면 '시행' 줄 아래에 "주    소 : …" 한 줄이 붙는다 */
  includeAddress: boolean;
  companyAddress: string;
  ceoName: string;
  companyKo: string;
  companyEn: string;
  overrides?: LetterLayoutOverrides; // 레이아웃 미세조정(field_values 승계)
}

// ── 발송 대장 행(official_letters) ──
export type LetterSendStatus = "pending" | "generating" | "sent" | "failed" | "archived";

/** 발송 이력 1건(194) — 1차부터 N차까지 send_history 에 누적된다. */
export interface LetterSendRecord {
  sentAt: string;
  messageId?: string | null;
  to?: string[];
  cc?: string[];
}

export interface OfficialLetterRow {
  letterId: string;
  docId: string | null;
  source: "system" | "imported";
  letterNo: string | null;
  year: string | null;
  title: string | null;
  letterKind: "general" | "proof";
  recipients: LetterRecipient[];
  ccRefs: LetterRecipient[];
  drafterName: string | null;
  issueDate: string | null;
  pdfKey: string | null;
  hwpxKey: string | null;
  hwpKey: string | null;
  attachKeys: { name: string; key: string }[];
  sendStatus: LetterSendStatus;
  sendError: string | null;
  sendAttempts: number;
  sentAt: string | null;
  /** 발송 이력(194) — 최초(1차)부터 N차까지. sentAt 은 최근 발송 시각 */
  sendHistory: LetterSendRecord[];
  createdAt: string;
  updatedAt: string;
}

export const LETTER_SEND_STATUS_LABEL: Record<LetterSendStatus, string> = {
  pending: "발송 대기",
  generating: "생성 중",
  sent: "발송 완료",
  failed: "발송 실패",
  archived: "이관(과거분)",
};
