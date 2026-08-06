/**
 * 전자결재 양식 스키마(모바일) — 웹 `frontend/lib/approval/fields.ts` 의 클라이언트 안전 정의를 옮긴 것.
 * ⚠ 웹 스키마가 바뀌면 여기도 같이 바꾼다(필드 타입이 갈라지면 같은 양식이 두 앱에서 다르게 보인다).
 */

export const APPROVAL_FIELD_TYPES = [
  'text',
  'multitext',
  'number',
  'currency',
  'select',
  'radio',
  'checkbox',
  'date',
  'time',
  'period',
  'user_select',
  'dept_select',
  'company_select',
  'contract_select',
  'contact_select',
  'leave_type',
  'asset_select',
  'table',
  'static',
] as const;
export type ApprovalFieldType = (typeof APPROVAL_FIELD_TYPES)[number];

export interface ApprovalFillRule {
  source: string;
  target: string;
}

export interface ApprovalTableColumn {
  key: string;
  label: string;
  type: string;
  options?: string[];
}

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
  tableColumns?: ApprovalTableColumn[];
  minRows?: number;
  sumColumn?: string;
  /** user_select 복수 선택 */
  multiple?: boolean;
  fillMap?: ApprovalFillRule[];
  /** asset_select 자산 종류 필터 */
  assetKind?: string;
}

export interface ApprovalForm {
  formId: string;
  folderId: string | null;
  name: string;
  description: string | null;
  fields: ApprovalFieldDef[];
  /** 관리자가 양식별로 지정하는 모바일 기안 허용 플래그(approval_forms.mobile_allowed). */
  mobileAllowed: boolean;
  useYn: boolean;
  sortOrder: number;
}

/** 양식 목록 응답의 요약 항목(fields 포함 — 모바일 상신 가능 판정에 필요). */
export interface ApprovalFormSummary extends ApprovalForm {}

export interface LineStep {
  stepType: 'agree' | 'approve';
  assigneeUserId: string;
  assigneeName?: string | null;
  assigneePosition?: string | null;
}

export interface LinePreset {
  presetId: string;
  name: string;
  steps: LineStep[];
}

/**
 * 모바일에서 상신할 수 있는 양식인가.
 *
 * ① 서버 플래그 `mobileAllowed` — 공문·견적서처럼 전용 작성 화면이 있는 양식은 이미 0 으로 시드돼 있다.
 * ② `table` 필드가 있는 양식(지출결의·출장보고서 등) — 행·열 편집은 모바일에서 열화되므로
 *    승인·참조만 하고 상신은 웹에서 한다(2026-08-06 사용자 확정).
 *
 * ⚠ 양식 ID 를 하드코딩하지 않는다 — 관리자가 빌더에서 양식을 바꾸면 어긋난다.
 */
export function draftableOnMobile(form: Pick<ApprovalForm, 'mobileAllowed' | 'fields'>): boolean {
  if (!form.mobileAllowed) return false;
  return !(form.fields ?? []).some((f) => f.type === 'table');
}

/** 상신을 막는 이유(선택 화면 안내문). */
export function undraftableReason(form: Pick<ApprovalForm, 'mobileAllowed' | 'fields'>): string | null {
  if (!form.mobileAllowed) return '웹 전용 양식입니다';
  if ((form.fields ?? []).some((f) => f.type === 'table')) return '표 입력이 있어 웹에서 작성합니다';
  return null;
}

/** 자주 쓰는 양식 — 선택 화면 상단 고정(2026-08-06 사용자 확정). */
export const PINNED_FORM_IDS = ['frm-biz-trip-request', 'frm-leave-request', 'frm-overtime-request'];
