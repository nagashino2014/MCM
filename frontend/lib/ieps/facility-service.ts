export type FacilityServiceCategory = "integrated" | "chemicals" | "haps" | "esg" | "other";

export type FacilityCompanySize = "large" | "mid" | "small";

export interface FacilityAlias {
  id?: number;
  alias: string;
  aliasType: string | null;
  note: string | null;
  isPrimary: boolean;
}

export interface FacilityManualProduct {
  id?: number;
  productName: string;
  amount: number | null;
  unit: string | null;
  note: string | null;
}

export const FACILITY_SERVICE_LABELS: Record<FacilityServiceCategory, string> = {
  integrated: "통합허가",
  chemicals: "화관법",
  haps: "HAPs",
  esg: "ESG",
  other: "기타",
};

export const FACILITY_SERVICE_COLORS: Record<FacilityServiceCategory, string> = {
  integrated: "#F4B084",
  chemicals: "#FFD966",
  haps: "#A9D08E",
  esg: "#9BC2E6",
  other: "#BFBFBF",
};

export const FACILITY_SERVICE_ORDER: FacilityServiceCategory[] = [
  "integrated",
  "chemicals",
  "haps",
  "esg",
  "other",
];

export const FACILITY_COMPANY_SIZE_LABELS: Record<FacilityCompanySize, string> = {
  large: "대기업",
  mid: "중견기업",
  small: "중소기업",
};

export const FACILITY_COMPANY_SIZE_ORDER: FacilityCompanySize[] = ["large", "mid", "small"];

export const normalizeFacilityServiceCategory = (
  value: unknown
): FacilityServiceCategory | null => {
  const raw = String(value ?? "").trim();
  if ((FACILITY_SERVICE_ORDER as string[]).includes(raw)) return raw as FacilityServiceCategory;
  const byLabel = FACILITY_SERVICE_ORDER.find((key) => FACILITY_SERVICE_LABELS[key] === raw);
  return byLabel ?? null;
};

export const normalizeFacilityCompanySize = (value: unknown): FacilityCompanySize | null => {
  const raw = String(value ?? "").trim();
  if ((FACILITY_COMPANY_SIZE_ORDER as string[]).includes(raw)) return raw as FacilityCompanySize;
  const byLabel = FACILITY_COMPANY_SIZE_ORDER.find((key) => FACILITY_COMPANY_SIZE_LABELS[key] === raw);
  return byLabel ?? null;
};

export const normalizeServiceCategories = (values: unknown): FacilityServiceCategory[] => {
  const list = Array.isArray(values) ? values : values == null ? [] : [values];
  const seen = new Set<FacilityServiceCategory>();
  for (const value of list) {
    const category = normalizeFacilityServiceCategory(value);
    if (category) seen.add(category);
  }
  return FACILITY_SERVICE_ORDER.filter((category) => seen.has(category));
};
