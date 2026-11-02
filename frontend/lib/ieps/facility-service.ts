export type FacilityServiceCategory = "integrated" | "chemicals" | "haps" | "esg" | "other";

export type FacilityCompanySize =
  | "national_agency"
  | "local_government"
  | "public_enterprise"
  | "large"
  | "mid"
  | "small";

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
  national_agency: "국가기관",
  local_government: "지자체",
  public_enterprise: "공기업",
  large: "대기업",
  mid: "중견기업",
  small: "중소기업",
};

export const FACILITY_COMPANY_SIZE_ORDER: FacilityCompanySize[] = [
  "national_agency",
  "local_government",
  "public_enterprise",
  "large",
  "mid",
  "small",
];

/** 거래 구분(331) — 매출처·매입처 복수. facilities.trade_roles text[]. 매입 계약 상대 업체 검색·배지에 쓴다. */
export type FacilityTradeRole = "sales" | "purchase";

export const FACILITY_TRADE_ROLE_ORDER: FacilityTradeRole[] = ["sales", "purchase"];

export const FACILITY_TRADE_ROLE_LABELS: Record<FacilityTradeRole, string> = {
  sales: "매출처",
  purchase: "매입처",
};

export const normalizeTradeRoles = (values: unknown): FacilityTradeRole[] => {
  const list = Array.isArray(values) ? values : values == null ? [] : [values];
  const seen = new Set<FacilityTradeRole>();
  for (const value of list) {
    const raw = String(value ?? "").trim();
    const key = (FACILITY_TRADE_ROLE_ORDER as string[]).includes(raw)
      ? (raw as FacilityTradeRole)
      : FACILITY_TRADE_ROLE_ORDER.find((k) => FACILITY_TRADE_ROLE_LABELS[k] === raw);
    if (key) seen.add(key);
  }
  return FACILITY_TRADE_ROLE_ORDER.filter((role) => seen.has(role));
};

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
