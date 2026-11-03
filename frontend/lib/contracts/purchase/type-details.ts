import { COPIER_LOCATIONS, COPIER_MAKERS, LEASE_SPECIAL_TERMS_MAX, PURIFIER_LOCATIONS, PURIFIER_MAKERS } from "./options";

/**
 * 매입 계약 유형별 상세(333 purchase_contracts.type_details jsonb) — 임대 계약 분류 탭의 입력값.
 * 분류에 맞는 키 하나만 저장하고 나머지는 버린다(서버 normalizeTypeDetails). 숫자는 문자열(화면 입력 그대로)이
 * 아니라 number|null 로 정규화한다. 차량은 자산관리 차량(reservable_assets)에 복사되는 원본이다.
 */
export interface RealEstateDetail {
  leaseTitle: string;
  propertyAddress: string;
  leaseFrom: string;
  leaseTo: string;
  areaTotal: number | null;
  areaExclusive: number | null;
  monthlyRent: number | null;
  deposit: number | null;
  specialTerms: string[];
}

export interface VehicleDetail {
  name: string;
  plateNo: string;
  ownership: "rent" | "owned" | "lease";
  ownerName: string;
  acquiredAt: string;
  contractMonths: number | null;
  returnedAt: string;
  acquisitionPrice: number | null;
  monthlyFee: number | null;
  description: string;
}

export interface DeviceRentalDetail {
  maker: string;
  model: string;
  location: string;
  /** 출금일자(매월 n일, 1~31). */
  debitDay: number | null;
}

export interface PurchaseTypeDetails {
  realEstate?: RealEstateDetail;
  vehicle?: VehicleDetail;
  copier?: DeviceRentalDetail;
  waterPurifier?: DeviceRentalDetail;
}

/** 분류 → type_details 키. 임대 계약이 아니면 null. */
export function typeDetailKeyFor(type: string | null | undefined, category: string | null | undefined): keyof PurchaseTypeDetails | null {
  if (type !== "lease") return null;
  switch (category) {
    case "부동산 임대":
      return "realEstate";
    case "차량 렌트":
      return "vehicle";
    case "복합기 렌트":
      return "copier";
    case "비데·정수기 렌트":
      return "waterPurifier";
    default:
      return null;
  }
}

const s = (v: unknown): string => (v == null ? "" : String(v)).trim();
const n = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const num = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(num) ? num : null;
};
const pick = (v: unknown, allowed: readonly string[]): string => {
  const t = s(v);
  return allowed.includes(t) ? t : "";
};

export function emptyRealEstate(): RealEstateDetail {
  return { leaseTitle: "", propertyAddress: "", leaseFrom: "", leaseTo: "", areaTotal: null, areaExclusive: null, monthlyRent: null, deposit: null, specialTerms: [] };
}
export function emptyVehicle(): VehicleDetail {
  return { name: "", plateNo: "", ownership: "rent", ownerName: "", acquiredAt: "", contractMonths: null, returnedAt: "", acquisitionPrice: null, monthlyFee: null, description: "" };
}
export function emptyDevice(): DeviceRentalDetail {
  return { maker: "", model: "", location: "", debitDay: null };
}

function normalizeRealEstate(raw: Record<string, unknown>): RealEstateDetail {
  const terms = Array.isArray(raw.specialTerms) ? raw.specialTerms.map(s).filter(Boolean).slice(0, LEASE_SPECIAL_TERMS_MAX) : [];
  return {
    leaseTitle: s(raw.leaseTitle),
    propertyAddress: s(raw.propertyAddress),
    leaseFrom: s(raw.leaseFrom).slice(0, 10),
    leaseTo: s(raw.leaseTo).slice(0, 10),
    areaTotal: n(raw.areaTotal),
    areaExclusive: n(raw.areaExclusive),
    monthlyRent: n(raw.monthlyRent),
    deposit: n(raw.deposit),
    specialTerms: terms,
  };
}

function normalizeVehicle(raw: Record<string, unknown>): VehicleDetail {
  const ownership = s(raw.ownership);
  return {
    name: s(raw.name),
    plateNo: s(raw.plateNo),
    ownership: ownership === "owned" || ownership === "lease" ? ownership : "rent",
    ownerName: s(raw.ownerName),
    acquiredAt: s(raw.acquiredAt).slice(0, 10),
    contractMonths: n(raw.contractMonths),
    returnedAt: s(raw.returnedAt).slice(0, 10),
    acquisitionPrice: n(raw.acquisitionPrice),
    monthlyFee: n(raw.monthlyFee),
    description: s(raw.description),
  };
}

function normalizeDevice(raw: Record<string, unknown>, makers: readonly string[], locations: readonly string[]): DeviceRentalDetail {
  const day = n(raw.debitDay);
  return {
    maker: pick(raw.maker, makers),
    model: s(raw.model),
    location: pick(raw.location, locations),
    debitDay: day != null && day >= 1 && day <= 31 ? Math.floor(day) : null,
  };
}

/** 본문의 typeDetails 를 분류에 맞는 한 키로 정규화한다. 분류에 상세가 없으면 빈 객체. */
export function normalizeTypeDetails(type: string, category: string, raw: unknown): PurchaseTypeDetails {
  const key = typeDetailKeyFor(type, category);
  if (!key) return {};
  const src = raw && typeof raw === "object" ? ((raw as Record<string, unknown>)[key] as Record<string, unknown> | undefined) ?? {} : {};
  switch (key) {
    case "realEstate":
      return { realEstate: normalizeRealEstate(src) };
    case "vehicle":
      return { vehicle: normalizeVehicle(src) };
    case "copier":
      return { copier: normalizeDevice(src, COPIER_MAKERS, COPIER_LOCATIONS) };
    case "waterPurifier":
      return { waterPurifier: normalizeDevice(src, PURIFIER_MAKERS, PURIFIER_LOCATIONS) };
  }
}

/** 저장된 jsonb(문자열일 수도 있음)를 객체로. */
export function parseTypeDetails(raw: unknown): PurchaseTypeDetails {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try {
      return (JSON.parse(raw) as PurchaseTypeDetails) ?? {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? (raw as PurchaseTypeDetails) : {};
}

/* ─── 관리비 명세서 파싱 결과(월별 detail jsonb) ─── */

export type FeeItemTaxType = "taxable" | "nontax" | "exempt";

export interface FeeStatementItem {
  name: string;
  amount: number;
  taxType: FeeItemTaxType;
}

export interface FeeStatementDetail {
  /** 납기내 금액(당월 부과액계) — 월별 표의 금액. */
  amountDue: number | null;
  supplyAmount: number | null;
  vat: number | null;
  taxableTotal: number | null;
  nontaxTotal: number | null;
  dueDate: string;
  items: FeeStatementItem[];
}

export function emptyFeeStatementDetail(): FeeStatementDetail {
  return { amountDue: null, supplyAmount: null, vat: null, taxableTotal: null, nontaxTotal: null, dueDate: "", items: [] };
}

export function normalizeFeeStatementDetail(raw: unknown): FeeStatementDetail {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const items = Array.isArray(src.items)
    ? src.items
        .map((it) => {
          const r = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
          const tax = s(r.taxType);
          return { name: s(r.name), amount: n(r.amount) ?? 0, taxType: (tax === "nontax" || tax === "exempt" ? tax : "taxable") as FeeItemTaxType };
        })
        .filter((it) => it.name)
        .slice(0, 60)
    : [];
  return {
    amountDue: n(src.amountDue),
    supplyAmount: n(src.supplyAmount),
    vat: n(src.vat),
    taxableTotal: n(src.taxableTotal),
    nontaxTotal: n(src.nontaxTotal),
    dueDate: s(src.dueDate).slice(0, 10),
    items,
  };
}
