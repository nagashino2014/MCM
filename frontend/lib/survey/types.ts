/**
 * 설문 — 공통 데이터 모델(마이그 246).
 *
 * 사내 설문(kind="internal")은 앱이 직접 응답을 받고, 외부 설문(kind="external")은
 * 구글 폼이 응답을 받는다(앱은 초안 작성 + 링크/QR 배포 이미지 관리만 담당).
 */

export type SurveyKind = "internal" | "external";
export type SurveyStatus = "draft" | "open" | "closed";
export type QuestionType = "single" | "multi" | "scale" | "text" | "longtext" | "section";

/** single/multi 보기. value 는 저장·집계 키, label 은 표시 문구. */
export interface QuestionOption {
  value: string;
  label: string;
}

/** 문항별 부가 설정 — 유형에 따라 쓰이는 키가 다르다. */
export interface QuestionConfig {
  /** scale — 척도 범위와 양 끝 라벨. */
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  /** single/multi — "기타" 직접 입력 허용. */
  allowOther?: boolean;
  /** multi — 최대 선택 수(0/미지정이면 제한 없음). */
  maxSelect?: number;
}

export interface SurveyQuestion {
  questionId: string;
  surveyId: string;
  seq: number;
  qtype: QuestionType;
  title: string;
  helpText: string | null;
  isRequired: boolean;
  options: QuestionOption[];
  config: QuestionConfig;
}

/** 사내 설문 응답 대상. departments 는 departments.dept_id 목록. */
export interface SurveyAudience {
  scope: "all" | "departments";
  departments?: string[];
}

export interface SurveyRow {
  surveyId: string;
  kind: SurveyKind;
  title: string;
  description: string | null;
  status: SurveyStatus;
  isAnonymous: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  audience: SurveyAudience;
  googleFormUrl: string | null;
  googleFormEditUrl: string | null;
  googleFormId: string | null;
  googleScriptId: string | null;
  googleSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  /** 목록 조회에서 채워지는 파생값. */
  questionCount?: number;
  responseCount?: number;
  /** 로그인 사용자가 이미 응답했는지(사내 설문 목록). */
  respondedAt?: string | null;
}

/** 설문 + 문항 — 빌더·응답 화면이 함께 받는 형태. */
export interface SurveyDetail extends SurveyRow {
  questions: SurveyQuestion[];
}

/** 응답 제출 페이로드 — { questionId: 답 }. 답 형태는 문항 유형을 따른다. */
export type AnswerValue = string | string[] | number | null;
export type AnswerMap = Record<string, AnswerValue>;

// ── 집계 ────────────────────────────────────────────

export interface QuestionStat {
  questionId: string;
  qtype: QuestionType;
  title: string;
  /** 해당 문항에 답한 응답 수. */
  answered: number;
  /** single/multi — 보기별 선택 수(보기 순서 유지, allowOther 기타는 "__other__"). */
  counts?: { value: string; label: string; count: number }[];
  /** scale — 평균과 점수별 분포. */
  average?: number;
  distribution?: { score: number; count: number }[];
  /** text/longtext — 자유 응답 원문(익명 설문도 본문은 노출, 응답자만 가린다). */
  texts?: string[];
}

export interface SurveyResults {
  survey: SurveyRow;
  responseCount: number;
  /** 대상 인원(사내, audience 기준). 응답률 계산용. 산출 불가 시 null. */
  targetCount: number | null;
  stats: QuestionStat[];
  /** 기명 설문의 응답자 목록. 익명이면 빈 배열. */
  respondents: { userId: string; name: string; deptName: string | null; submittedAt: string }[];
}

// ── QR 배포 이미지 ──────────────────────────────────

export type NoticeLayout = "phone" | "mail";

/** 배포 이미지 편집 필드 — 편집기 폼과 1:1(핸드오프 README 의 "편집 가능 필드" 표). */
export interface NoticeFields {
  /** 대상 기관(기업)명 — 주관 표기·파일명에 쓰인다. */
  targetOrg: string;
  badgeText: string;
  /** 배지 색 톤 — sky(파랑 바탕·흰 글자) / green(연두 바탕·검은 글자). */
  badgeTone: "sky" | "green";
  title: string;
  description: string;
  periodText: string;
  durationText: string;
  hostMain: string;
  hostSub: string;
  hostNote: string;
  qrCaption: string;
  /** data:image/... URI. 로고는 업로드본, QR 은 링크에서 생성한 PNG. */
  logoDataUrl: string | null;
  qrDataUrl: string | null;
  /** QR 이 가리키는 링크(구글 폼 URL). 재생성 근거로 함께 보관. */
  qrTargetUrl: string | null;
}

/** 배포 이미지 테마 — 상단 CI 띠 색상은 로고에서 자동 검출한 값이 기본. */
export interface NoticeTheme {
  /** 1~4색. 개수만큼 상단 띠를 등분한다. */
  bandColors: string[];
  ink?: string;
  body?: string;
}

export interface SurveyNoticeRow {
  noticeId: string;
  surveyId: string | null;
  surveyTitle?: string | null;
  name: string;
  layout: NoticeLayout;
  fields: NoticeFields;
  theme: NoticeTheme;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}
