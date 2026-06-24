import {
  Factory,
  FileSignature,
  Briefcase,
  Database,
  Trash2,
  ClipboardList,
  UserCog,
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
  /** 사이드바 카테고리 그룹: 업무 보고(work) / 사업 운영(main) / 시스템(system) */
  group?: "work" | "main" | "system";
}

export const MENU_ITEMS: MenuItem[] = [
  // ── 업무 보고 ─────────────────────────────────────
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
    comingSoon: true,
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
