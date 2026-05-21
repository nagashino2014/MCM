import {
  Factory,
  FileSignature,
  Briefcase,
  Database,
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
  /** "시스템" 같은 별도 섹션 그룹화용 키 */
  group?: "main" | "system";
}

export const MENU_ITEMS: MenuItem[] = [
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
    comingSoon: true,
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
    minRole: "admin",
    group: "system",
  },
];

const ROLE_RANK: Record<Role, number> = { admin: 3, editor: 2, viewer: 1 };

export function isMenuVisibleForRole(item: MenuItem, role: Role): boolean {
  if (!item.minRole) return true;
  return ROLE_RANK[role] >= ROLE_RANK[item.minRole];
}
