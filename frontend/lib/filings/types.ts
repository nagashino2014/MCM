// 대외 신고 대기열(regulatory_filings, 마이그 213) — 서버/클라이언트 공용 타입·라벨.

export type FilingKind = "ieps_staff" | "ieps_agency" | "etis_career";
export type FilingStatus = "pending" | "submitted" | "skipped";
export type FilingSite = "ieps" | "etis";

export const FILING_KINDS: FilingKind[] = ["ieps_staff", "ieps_agency", "etis_career"];

export const FILING_KIND_LABEL: Record<FilingKind, string> = {
  ieps_staff: "IEPS 기술인력 변경신고",
  ieps_agency: "IEPS 대행 실적 보고",
  etis_career: "ETIS 기술자 변경신고",
};

export const FILING_SITE_LABEL: Record<FilingSite, string> = {
  ieps: "통합환경허가시스템",
  etis: "엔지니어링종합정보시스템",
};

/** 사유(trigger_kind) 라벨 — 종류별로 겹치지 않게 키를 나눴다. */
export const FILING_TRIGGER_LABEL: Record<string, string> = {
  appoint: "선임",
  dismiss: "해임",
  grade_change: "등급 변경",
  conclude: "계약 체결",
  amend: "계약 변경",
  complete: "계약 이행(완료)",
  join: "입사",
  leave: "퇴사",
  career_add: "경력 추가",
  career_end: "경력 종료",
};

export const FILING_STATUS_LABEL: Record<FilingStatus, string> = {
  pending: "대기",
  submitted: "제출 완료",
  skipped: "제외",
};

export interface FilingField {
  label: string;
  value: string;
  /** 사이트에서 입력 시 참고할 안내(선택) */
  hint?: string;
}

export interface FilingPayload {
  site: FilingSite;
  /** 사이트 화면 이름(예: 대행업 변경신고 › 기술인력보유현황) */
  screen: string;
  fields: FilingField[];
}

export interface FilingRow {
  filingId: string;
  filingKind: FilingKind;
  triggerKind: string;
  source: "derived" | "event";
  employeeId: string | null;
  contractId: string | null;
  title: string;
  subtitle: string | null;
  occurredOn: string;
  dueOn: string | null;
  status: FilingStatus;
  payload: FilingPayload;
  submittedAt: string | null;
  submittedBy: string | null;
  submittedByName: string | null;
  receiptNo: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** 기한 대비 남은 일수(음수 = 초과). due_on 없으면 null. 오늘(KST) 기준. */
  daysLeft: number | null;
}

export interface FilingSettings {
  /** 기준일 — 이 날짜 이전에 발생한 사유는 대기열에 올리지 않는다(도입 이전 소급 방지). */
  cutoffOn: string;
  /** 종류별 신고 기한 일수(발생일 + N일). */
  dueDays: Record<FilingKind, number>;
  /** 기한 임박·초과 푸시 수신자(user_id). */
  notifyUserIds: string[];
  /** 기한 며칠 전부터 임박 알림을 보낼지. */
  remindBeforeDays: number;
}

export interface FilingSummary {
  pending: number;
  overdue: number;
  dueSoon: number;
  byKind: Record<FilingKind, number>;
  items: FilingRow[];
}
