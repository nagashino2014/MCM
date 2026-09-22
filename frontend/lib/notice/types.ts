// 내부고시 — 공용 타입·상수 (클라이언트/서버 공용: DB import 금지)
// 대외 공문(lib/letter)과 같은 본문 IR·레이아웃 상수를 쓰되, 수신처·메일 발송·하단 고정부
// (담당·시행·전화)가 없고 문서 말미가 '시행일자 / 사명 / 대표이사 (직인)' 서명 블록이다.
// 문서 원본 = approval_docs.field_values(아래 규약). 양식 시드 = infra/aws/266.

export const NOTICE_FORM_ID = "frm-internal-notice";
export const NOTICE_RULE_KEY = "내부고시"; // 채번 rule_key — '내부고시-NNNN호'(연도 없는 통산 번호, 2026-09-22 사용자 확정)
/** 통산 번호라 연도별로 나누지 않는다 — doc_no_sequences.year 자리에 고정 키를 쓴다(267) */
export const NOTICE_SEQ_YEAR = "ALL";
export const NOTICE_SEQ_START = 1001;
export const NOTICE_NO_RE = /^내부고시-(\d{1,5})호$/;

/** 1010 → '내부고시-1010호' */
export function formatNoticeNo(seq: number): string {
  return `${NOTICE_RULE_KEY}-${String(seq).padStart(4, "0")}호`;
}

export function parseNoticeNo(no: string): number | null {
  const m = NOTICE_NO_RE.exec((no ?? "").trim());
  return m ? Number(m[1]) : null;
}

/** 본문 첫 줄 들여쓰기(pt) — 공문(65pt)보다 얕게(2026-09-22 사용자 요청, 약 15px) */
export const NOTICE_BODY_INDENT = 15;

export const DEFAULT_NOTICE_RECIPIENT = "전 임직원";
export const DEFAULT_NOTICE_SENDER = "대표이사";

export interface NoticeFieldValues {
  /** 머리부 '수신' 줄 — 예: 전 임직원 (참조: 외부검토 담당 조직 전 인력) */
  recipient_text: string;
  /** 머리부 '발신' 줄 — 예: 대표이사 */
  sender_text: string;
  subject: string; // = approval_docs.title
  body_html: string; // MailEditor 출력 HTML(공문과 같은 IR 로 파싱)
  attachments_list: { no: number; text: string }[]; // 붙임 목록
  stamp: 0 | 1; // 대표이사 직인 날인 여부
  /** 시행일(YYYY-MM-DD) — 비우면 결재 완료일(임시저장·미승인은 오늘) */
  issue_date?: string;
  file_attachments?: { name: string; key: string; size: number }[]; // 결재 첨부(field_values 공통 규약)
}

/** 'YYYY-MM-DD' → '2026년   8월   3일' (첨부 양식의 날짜 표기) */
export function formatNoticeDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map((v) => Number(v));
  if (!y || !m || !d) return isoDate;
  return `${y}년 ${m}월 ${d}일`;
}
