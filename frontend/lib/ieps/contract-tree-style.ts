/**
 * Color tokens for the contract ledger tree view. Parent colors mirror the
 * SERVICE_PALETTE used by the dashboard sigungu drill modal pie chart so the
 * tree visually matches the analytic charts elsewhere in the app. Child
 * colors are a softer/lighter tone of the parent so that an expanded service
 * group is immediately recognizable without being noisy.
 */

export interface ServiceTypeStyle {
  /** Hex color for the parent (service group) row icon. */
  parentColor: string;
  /** Hex color for the child (contract) row icon and the fully-collected dot. */
  childColor: string;
}

const FALLBACK: ServiceTypeStyle = {
  parentColor: "#7F7F7F",
  childColor: "#BFBFBF",
};

/**
 * Lookup table by service-type keyword. The first entry whose `keys` substring
 * matches the contract's service_type wins.
 *
 * Each pair uses the Office "Accent + Lighter 40%" tonal pairing so the parent
 * row is the saturated/darker variant and the child rows pick up the softer
 * SERVICE_PALETTE shade used by the dashboard pie chart. This keeps the tree
 * legible at a glance while still echoing the analytics palette.
 */
const STYLE_TABLE: Array<{ keys: string[]; style: ServiceTypeStyle }> = [
  {
    keys: ["통합허가", "통합환경허가"],
    style: { parentColor: "#ED7D31", childColor: "#F4B084" },
  },
  {
    keys: ["장외", "화관법", "장외&화관법", "화학사고예방관리계획", "장외영향평가", "유해화학물질"],
    style: { parentColor: "#FFC000", childColor: "#FFD966" },
  },
  {
    keys: ["HAPs"],
    style: { parentColor: "#70AD47", childColor: "#A9D08E" },
  },
  {
    keys: ["ESG", "탄소중립", "ESG탄소중립"],
    style: { parentColor: "#5B9BD5", childColor: "#9BC2E6" },
  },
  {
    keys: ["기술진단", "진단"],
    style: { parentColor: "#E06666", childColor: "#F4A8A0" },
  },
  {
    keys: ["기타"],
    style: FALLBACK,
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
