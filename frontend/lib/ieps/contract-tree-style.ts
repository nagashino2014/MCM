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
  parentColor: "#BFBFBF",
  childColor: "#D9D9D9",
};

/**
 * Lookup table by service-type keyword. The first entry whose `keys` substring
 * matches the contract's service_type wins.
 */
const STYLE_TABLE: Array<{ keys: string[]; style: ServiceTypeStyle }> = [
  {
    keys: ["통합허가", "통합환경허가"],
    style: { parentColor: "#F4B084", childColor: "#FBDDC7" },
  },
  {
    keys: ["장외", "화관법", "장외&화관법", "장외영향평가", "유해화학물질"],
    style: { parentColor: "#FFD966", childColor: "#FFEAA8" },
  },
  {
    keys: ["HAPs"],
    style: { parentColor: "#A9D08E", childColor: "#D2E5C2" },
  },
  {
    keys: ["ESG", "탄소중립", "ESG탄소중립"],
    style: { parentColor: "#9BC2E6", childColor: "#CADBED" },
  },
  {
    keys: ["기술진단", "진단"],
    style: { parentColor: "#F4A8A0", childColor: "#F8CFCB" },
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
