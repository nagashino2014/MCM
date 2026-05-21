import {
  Briefcase,
  Folder,
  FolderClosed,
  type LucideIcon,
} from "lucide-react";

export interface ServiceTypeStyle {
  /** Tailwind text color class for parent (service type) icon. */
  parentText: string;
  /** Tailwind text color class for child (contract) icon, intentionally a softer tone of the parent. */
  childText: string;
  /** Tailwind background tint class used for the parent header chip. */
  parentChip: string;
  parentIcon: LucideIcon;
  childIcon: LucideIcon;
}

const FALLBACK: ServiceTypeStyle = {
  parentText: "text-slate-500",
  childText: "text-slate-300",
  parentChip: "bg-slate-100",
  parentIcon: Briefcase,
  childIcon: Folder,
};

/**
 * Parent/child color pairs for the contract tree. The child uses a lighter tone of the parent
 * so the open service group is visually identifiable (e.g. HAPs parent green -> child light green,
 * 통합허가 parent orange -> child light orange).
 */
const STYLE_TABLE: Array<{ keys: string[]; style: ServiceTypeStyle }> = [
  {
    keys: ["통합허가", "통합환경허가"],
    style: {
      parentText: "text-orange-500",
      childText: "text-orange-300",
      parentChip: "bg-orange-50",
      parentIcon: Briefcase,
      childIcon: FolderClosed,
    },
  },
  {
    keys: ["장외", "화관법", "장외&화관법", "장외영향평가", "유해화학물질"],
    style: {
      parentText: "text-yellow-500",
      childText: "text-yellow-300",
      parentChip: "bg-yellow-50",
      parentIcon: Briefcase,
      childIcon: FolderClosed,
    },
  },
  {
    keys: ["HAPs"],
    style: {
      parentText: "text-emerald-600",
      childText: "text-emerald-300",
      parentChip: "bg-emerald-50",
      parentIcon: Briefcase,
      childIcon: FolderClosed,
    },
  },
  {
    keys: ["ESG", "탄소중립", "ESG탄소중립"],
    style: {
      parentText: "text-sky-600",
      childText: "text-sky-300",
      parentChip: "bg-sky-50",
      parentIcon: Briefcase,
      childIcon: FolderClosed,
    },
  },
  {
    keys: ["기술진단", "진단"],
    style: {
      parentText: "text-rose-600",
      childText: "text-rose-300",
      parentChip: "bg-rose-50",
      parentIcon: Briefcase,
      childIcon: FolderClosed,
    },
  },
  {
    keys: ["기타"],
    style: {
      parentText: "text-violet-600",
      childText: "text-violet-300",
      parentChip: "bg-violet-50",
      parentIcon: Briefcase,
      childIcon: FolderClosed,
    },
  },
];

export function resolveServiceTypeStyle(serviceType: string | null | undefined): ServiceTypeStyle {
  if (!serviceType) return FALLBACK;
  const normalized = serviceType.trim();
  for (const entry of STYLE_TABLE) {
    if (entry.keys.some((k) => normalized.includes(k))) {
      return entry.style;
    }
  }
  return FALLBACK;
}
