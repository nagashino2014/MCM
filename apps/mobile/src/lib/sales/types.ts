/**
 * 영업 도메인 상수·타입 — 데스크탑 `frontend/lib/sales/types.ts` 의 모바일 사본.
 * 모노레포지만 모바일은 frontend 를 import 하지 않는다(calendar/types.ts 와 같은 방식).
 * 코드·라벨은 서버와 일치해야 한다 — 서버 쪽이 바뀌면 여기도 맞춘다.
 */

export type SalesActivityType =
  | 'telemarketing' | 'email' | 'visit' | 'site_briefing' | 'quote' | 'proposal_meeting' | 'bid' | 'result';

export interface ActivityTypeMeta {
  code: SalesActivityType;
  label: string; // 등록 시트 표시명
  short: string; // 2글자 태그
  color: string; // 캘린더 필 배경(데스크탑 SVG 팔레트와 동일)
  ink: string;   // 필 텍스트 — 모바일 pills 캘린더 전용(배경 위 가독 잉크, 데스크탑엔 없다)
}

export const ACTIVITY_TYPES: ActivityTypeMeta[] = [
  { code: 'telemarketing', label: '전화 마케팅', short: '전화', color: '#FFB3B3', ink: '#a63d3d' },
  { code: 'email', label: '홍보 메일 송신', short: '메일', color: '#A9D6D0', ink: '#2f6b62' },
  { code: 'visit', label: '사업장 방문', short: '미팅', color: '#F8CBAD', ink: '#a05a2c' },
  { code: 'site_briefing', label: '현장설명회 참석', short: '현설', color: '#FFE699', ink: '#8a6d1a' },
  { code: 'quote', label: '견적서 제출', short: '견적', color: '#BDD7EE', ink: '#33638e' },
  { code: 'proposal_meeting', label: '제안발표회 참석', short: '제안', color: '#C5E0B4', ink: '#4a7a2f' },
  { code: 'bid', label: '용역 투찰 기간', short: '투찰', color: '#B4C6E7', ink: '#3f5a94' },
  { code: 'result', label: '영업 결과', short: '결과', color: '#CDACE6', ink: '#6d43a1' },
];

export const ACTIVITY_TYPE_META: Record<SalesActivityType, ActivityTypeMeta> = Object.fromEntries(
  ACTIVITY_TYPES.map((m) => [m.code, m])
) as Record<SalesActivityType, ActivityTypeMeta>;

/** 장소 입력을 받는 일정명(데스크탑 ScheduleModal 의 PLACE_TYPES). */
export const PLACE_TYPES: SalesActivityType[] = ['visit', 'site_briefing', 'proposal_meeting'];

export const SALES_SERVICE_CATEGORIES = [
  { code: 'integrated_permit', label: '통합허가' },
  { code: 'chem', label: '화관법' },
  { code: 'esg', label: 'ESG·탄소중립' },
  { code: 'etc', label: '기타' },
] as const;

export type SalesServiceCategory = (typeof SALES_SERVICE_CATEGORIES)[number]['code'];

export const SALES_SUBCATEGORIES_BY_CATEGORY: Record<SalesServiceCategory, { code: string; label: string }[]> = {
  integrated_permit: [
    { code: 'first', label: '최초허가' },
    { code: 'change_permit', label: '변경허가' },
    { code: 'change_report', label: '변경신고' },
    { code: 'post_mgmt', label: '사후관리' },
    { code: 'review', label: '재검토' },
  ],
  chem: [
    { code: 'chem_plan', label: '화방계' },
    { code: 'chem_biz_permit', label: '영업허가' },
    { code: 'chem_install_check', label: '설치검사' },
    { code: 'chem_diag', label: '화관법진단' },
  ],
  esg: [
    { code: 'esg_mgmt', label: 'ESG경영' },
    { code: 'esg_cbam', label: 'CBAM' },
    { code: 'esg_supply_chain', label: '공급망실사' },
    { code: 'esg_lca', label: 'LCA평가' },
    { code: 'esg_ets', label: '배출권관련' },
  ],
  etc: [
    { code: 'etc_rnd', label: '환경R&D' },
    { code: 'etc_advisory', label: '환경자문' },
    { code: 'etc_media_permit', label: '매체별인허가' },
    { code: 'etc_tms', label: '총량제신고' },
    { code: 'etc_permit', label: '기타인허가' },
  ],
};

// ── API 응답 형태 ─────────────────────────────────────────────

/** GET /api/sales/schedule?month= 의 activities 항목(서버 MonthActivity). */
export interface MonthActivity {
  activityId: string;
  projectId: string;
  projectTitle: string;
  facilityName: string | null;
  activityType: SalesActivityType;
  /** KST 벽시계 문자열 'YYYY-MM-DDTHH:MM(:SS)' */
  scheduledAt: string;
  endedAt: string | null;
  summary: string | null;
  contacts: ActivityContactPerson[];
}

export interface ActivityContactPerson {
  id: number;
  personName: string | null;
  title: string | null;
  departmentName: string | null;
  mobilePhone: string | null;
  officePhone: string | null;
}

/** GET /api/sales/pending-reports 의 reports 항목 — 경과 미입력 활동 묶음. */
export interface PendingReport {
  projectId: string;
  title: string;
  facilityId: string;
  facilityName: string | null;
  activities: {
    activityId: string;
    activityType: SalesActivityType;
    scheduledAt: string | null;
    endedAt: string | null;
    summary: string | null;
  }[];
}
