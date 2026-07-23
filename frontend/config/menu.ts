import {
  House,
  Factory,
  FileSignature,
  Briefcase,
  Database,
  Trash2,
  ClipboardList,
  ClipboardCheck,
  UserCog,
  Building2,
  Users as UsersIcon,
  type LucideIcon,
} from "lucide-react";

export type Role = "admin" | "editor" | "viewer";

export interface MenuItem {
  title: string;
  href: string;
  icon: LucideIcon;
  submenu?: { title: string; href: string }[];
  comingSoon?: boolean;
  /** 이 메뉴를 보려면 필요한 최소 role. 미지정 시 viewer 이상 모두 노출. */
  minRole?: Role;
  /** 사이드바 카테고리 그룹: 홈(home) / 업무 보고(work) / 사업 운영(main) / 시스템(system) */
  group?: "home" | "work" | "main" | "system";
}

export const MENU_ITEMS: MenuItem[] = [
  // ── 홈 ────────────────────────────────────────────
  {
    title: "홈",
    href: "/home",
    icon: House,
    group: "home",
  },
  // ── 업무 보고 ─────────────────────────────────────
  {
    title: "전자결재",
    href: "/approval",
    icon: ClipboardCheck,
    submenu: [
      { title: "전자결재 홈", href: "/approval" },
      { title: "기안 작성", href: "/approval/draft" },
      { title: "문서함", href: "/approval/archive" },
      { title: "양식별 문서 조회", href: "/approval/records" },
      { title: "직원별 휴가 관리", href: "/approval/leave" },
      { title: "근태·초과근무 관리", href: "/approval/attendance" },
      { title: "연차촉진제도 관리", href: "/approval/leave-promotion" },
      { title: "휴가 종류 규정", href: "/approval/leave-types" },
      { title: "양식 관리", href: "/approval/forms" },
    ],
    group: "work",
  },
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
    title: "사업참여 수행인력",
    href: "/staffing",
    icon: UserCog,
    submenu: [
      { title: "수행인력 현황", href: "/staffing" },
      { title: "반기 참여도·평점", href: "/staffing/evaluations" },
    ],
    group: "work",
  },
  // ── 사업 운영 ─────────────────────────────────────
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
