import {
  House,
  Factory,
  FileSignature,
  Briefcase,
  Database,
  Trash2,
  ClipboardList,
  ClipboardCheck,
  Mail,
  UserCog,
  Building2,
  Users as UsersIcon,
  BookUser,
  Megaphone,
  CalendarDays,
  CalendarClock,
  CarFront,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export type Role = "admin" | "editor" | "viewer";

/** 사이드바 카운트 뱃지 데이터 키(/api/nav/badges 응답 필드와 매핑). */
export type MenuBadgeKey = "mailUnread" | "approvalPending";

export interface MenuItem {
  title: string;
  href: string;
  icon: LucideIcon;
  submenu?: { title: string; href: string }[];
  comingSoon?: boolean;
  /** 이 메뉴를 보려면 필요한 최소 role. 미지정 시 viewer 이상 모두 노출. */
  minRole?: Role;
  /**
   * 사이드바 카테고리 그룹(G1 IA — docs/groupware-ux-overhaul-blueprint.md §2.1):
   * 홈(home) / 협업(collab) / 업무(work) / 사업 운영(main) / 관리(system)
   */
  group?: "home" | "collab" | "work" | "main" | "system";
  /** 카운트 뱃지(안읽은 메일·미결재) 데이터 키. */
  badgeKey?: MenuBadgeKey;
}

export const MENU_ITEMS: MenuItem[] = [
  // ── 홈 ────────────────────────────────────────────
  {
    title: "홈",
    href: "/home",
    icon: House,
    group: "home",
  },
  // ── 협업 (그룹웨어 코어 — 최상단) ──────────────────
  {
    title: "메일",
    href: "/mail",
    icon: Mail,
    group: "collab",
    badgeKey: "mailUnread",
  },
  {
    title: "전자결재",
    href: "/approval",
    icon: ClipboardCheck,
    submenu: [
      { title: "전자결재 홈", href: "/approval" },
      { title: "공문 작성", href: "/approval/letter" },
      { title: "견적서 작성", href: "/approval/quote" },
      { title: "문서함", href: "/approval/archive" },
      { title: "양식별 문서 조회", href: "/approval/records" },
      { title: "데이터 분석", href: "/approval/analytics" },
      { title: "결재 인사이트", href: "/approval/insights" },
    ],
    group: "collab",
    badgeKey: "approvalPending",
  },
  {
    title: "주소록·조직도",
    href: "/directory",
    icon: BookUser,
    group: "collab",
  },
  {
    title: "공지·게시판",
    href: "/board",
    icon: Megaphone,
    group: "collab",
  },
  {
    title: "일정",
    href: "/calendar",
    icon: CalendarDays,
    group: "collab",
  },
  {
    title: "자산 예약",
    href: "/assets/reservations",
    icon: CarFront,
    submenu: [
      { title: "이용 현황", href: "/assets/reservations" },
      { title: "자산 관리", href: "/assets" },
    ],
    group: "collab",
  },
  // ── 업무 ──────────────────────────────────────────
  {
    title: "업무추진계획",
    href: "/work-plan",
    icon: ClipboardList,
    submenu: [
      { title: "보고 작성/목록", href: "/work-plan" },
      { title: "부서장 감독", href: "/work-plan/oversight" },
      { title: "임원 검토·지시", href: "/work-plan/exec" },
      { title: "발표 모드", href: "/work-plan/present" },
    ],
    group: "work",
  },
  {
    title: "성과급 산정",
    href: "/staffing",
    icon: UserCog,
    submenu: [
      { title: "지급 대상 LIST", href: "/staffing" },
      { title: "참여도·평점", href: "/staffing/evaluations" },
      { title: "지급 명세서 생성", href: "/staffing/statements" },
    ],
    group: "work",
  },
  // 근태·휴가 — 전자결재 하위에서 HR 모듈로 승격(§2.3). 라우트 경로는 무변경(/approval/*).
  {
    title: "근태·휴가",
    href: "/approval/leave",
    icon: CalendarClock,
    submenu: [
      { title: "직원별 휴가 관리", href: "/approval/leave" },
      { title: "근태·초과근무 관리", href: "/approval/attendance" },
      { title: "연차촉진제도 관리", href: "/approval/leave-promotion" },
      { title: "휴가 종류 규정", href: "/approval/leave-types" },
    ],
    group: "work",
  },
  // ── 사업 운영 (원 PermitIQ 도메인 — 보존) ──────────
  {
    title: "사업장",
    href: "/facilities",
    icon: Factory,
    group: "main",
  },
  {
    title: "계약",
    href: "/contracts",
    icon: FileSignature,
    submenu: [
      { title: "계약 관리", href: "/contracts" },
      { title: "Dashboard", href: "/contracts/dashboard" },
      { title: "수주/수금/발행 현황", href: "/contracts/billing" },
      { title: "계약서 작성", href: "/contracts/agreements" },
      { title: "착수계·준공계 작성", href: "/contracts/deliverables" },
      { title: "다운로드/증명서 생성", href: "/contracts/downloads" },
    ],
    group: "main",
  },
  {
    title: "영업/마케팅",
    href: "/sales",
    icon: Briefcase,
    submenu: [
      { title: "Salesboard", href: "/sales" },
      { title: "담당자 정보 관리", href: "/sales/contacts" },
      { title: "API & 스크래핑", href: "/sales/intel" },
      { title: "RAG & 영업 발굴", href: "/sales/rag" },
      { title: "공공입찰", href: "/sales/bids" },
    ],
    group: "main",
  },
  {
    title: "데이터",
    href: "/data/status",
    icon: Database,
    submenu: [
      { title: "수집 현황", href: "/data/status" },
      { title: "검수 대기열", href: "/data/review" },
      { title: "설정", href: "/data/settings" },
    ],
    group: "main",
  },
  // ── 관리 (운영자) ─────────────────────────────────
  {
    title: "사용자 관리",
    href: "/admin/users",
    icon: UsersIcon,
    submenu: [
      { title: "계정·권한 관리", href: "/admin/users" },
      { title: "사용자 등록·삭제", href: "/admin/users/registry" },
    ],
    minRole: "admin",
    group: "system",
  },
  {
    title: "회사 프로필 관리",
    href: "/admin/company-profile",
    icon: Building2,
    minRole: "admin",
    group: "system",
  },
  // 결재 운영(양식·정책·알림) — 전자결재 하위에서 관리로 이동(§2.3, 운영자 기능).
  {
    title: "결재 운영 설정",
    href: "/approval/forms",
    icon: SlidersHorizontal,
    submenu: [
      { title: "양식 관리", href: "/approval/forms" },
      { title: "데이터 의미 사전", href: "/approval/semantic-concepts" },
      { title: "데이터 관계 맵", href: "/approval/semantics" },
      { title: "데이터 지표", href: "/approval/metrics" },
      { title: "사전검토 정책", href: "/approval/policies" },
      { title: "결재 알림 설정", href: "/approval/settings" },
    ],
    minRole: "admin",
    group: "system",
  },
  {
    title: "휴지통",
    href: "/trash",
    icon: Trash2,
    minRole: "editor",
    group: "system",
  },
];

const ROLE_RANK: Record<Role, number> = { admin: 3, editor: 2, viewer: 1 };

export function isMenuVisibleForRole(item: MenuItem, role: Role): boolean {
  if (!item.minRole) return true;
  return ROLE_RANK[role] >= ROLE_RANK[item.minRole];
}
