export const DASHBOARD_CATEGORIES = [
  "통합환경허가",
  "장외·화관법",
  "HAPs 용역",
  "ESG·탄소중립",
  "기타 용역",
] as const;

/**
 * 용역분류별 메타 — 색상/아이콘은 사업장 수주 모달(FacilityOrdersModal)의
 * ORDER_CATEGORIES 와 동일한 체계를 사용한다. short 는 수금 현황 레이블용 축약명.
 */
export const CATEGORY_META: Record<string, { color: string; iconSrc: string; short: string }> = {
  통합환경허가: { color: "#ED7D31", iconSrc: "/icons/services/integrated-permit.png", short: "통합" },
  "장외·화관법": { color: "#FFC000", iconSrc: "/icons/services/chemical.png", short: "장외" },
  "HAPs 용역": { color: "#70AD47", iconSrc: "/icons/services/haps.png", short: "HAPs" },
  "ESG·탄소중립": { color: "#5B9BD5", iconSrc: "/icons/services/esg.png", short: "ESG" },
  "기타 용역": { color: "#7F7F7F", iconSrc: "/icons/services/etc.png", short: "기타" },
};

export type CdTheme = "dark" | "light";

export interface MonthlyBlock {
  total: number;
  monthly: number[];
  byCategory: Array<{
    category: string;
    current: number;
    d1: number;
    d2: number;
    share: number;
  }>;
}

export interface DashboardData {
  year: string;
  availableYears: string[];
  category: string;
  sales: MonthlyBlock;
  orders: MonthlyBlock;
  serviceDetail: {
    totalCount: number;
    rows: Array<{ label: string; count: number; amount: number }>;
  };
  collection: {
    collectedTotal: number;
    collectedCategory: number;
    prevCollectedTotal: number;
    prevCollectedCategory: number;
    rateTotal: number;
    rateCategory: number;
  };
  regions: Array<{ sido: string; amount: number }>;
  uncollected: Array<{
    contractId: string;
    contractTitle: string;
    counterpartyName: string;
    /** 발행/수금 모달용 청구·수금 단계 ID */
    milestoneId: string;
    category: string;
    stageLabel: string;
    paymentTerms: string | null;
    amount: number;
    /** 부분입금 차감 후 미수 잔액 */
    outstandingAmount: number;
    invoiceIssuedAt: string | null;
    agingMonths: number;
  }>;
  recentCollections: Array<{
    contractId: string;
    contractTitle: string;
    counterpartyName: string;
    /** 발행/수금 모달용 청구·수금 단계 ID */
    milestoneId: string;
    category: string;
    stageLabel: string;
    paymentTerms: string | null;
    invoiceIssuedAt: string | null;
    invoiceAmount: number;
    amount: number;
    collectedAt: string;
    daysAgo: number;
  }>;
}

export interface CounterpartySearchItem {
  facilityId: string;
  name: string;
  contractCount: number;
}

export interface CounterpartyDetail {
  facilityId: string;
  name: string;
  yearly: Array<{ year: string; orders: number; sales: number }>;
  current: {
    year: string;
    orderAmount: number;
    salesAmount: number;
    orderCount: number;
    topCategory: string | null;
  };
  contracts: Array<{
    contractId: string;
    contractDate: string | null;
    contractTitle: string;
    amount: number;
  }>;
}

/** 전체 자리수 콤마 표기 (엑셀 원본과 동일). 0 이하/비유한 값은 "-" */
export function fmtFull(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "-";
  return Math.round(value).toLocaleString();
}

/** 축약 표기: 6.3억 / 1,250만 */
export function fmtCompact(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "-";
  const abs = Math.abs(value);
  if (abs >= 100000000) return (value / 100000000).toFixed(1).replace(/\.0$/, "") + "억";
  if (abs >= 10000) return Math.round(value / 10000).toLocaleString() + "만";
  return Math.round(value).toLocaleString();
}

/** 전년 대비 증감률 (%). 기준값이 0이면 null */
export function pctDiff(current: number, base: number): number | null {
  if (!Number.isFinite(base) || base === 0) return null;
  return Math.round(((current - base) / base) * 100);
}

/**
 * 빌링(수주/수금/발행 현황) 차트용: 카테고리 원색을 흰색 방향으로 살짝 밝게 만든다.
 * amount(0~1)만큼 흰색(255,255,255)과 선형 보간해 연한 파스텔 톤을 만든다.
 */
export function softCategoryColor(hex: string, amount = 0.22): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** ApexCharts 옵션에 쓰는 테마 상수 (dashboard.css 토큰과 동기화) */
export function chartPalette(theme: CdTheme) {
  return theme === "dark"
    ? {
        text: "#eaeff4",
        muted: "#8c9bb5",
        faint: "#5a6a85",
        grid: "#232c39",
        primary: "#5d87ff",
        secondary: "#49beff",
        accent: "#fa896b",
        success: "#7eba56",
        warning: "#ffae1f",
        surface: "#1d2530",
      }
    : {
        text: "#2a3547",
        muted: "#5a6a85",
        faint: "#7c8fac",
        grid: "#ebf1f6",
        primary: "#5d87ff",
        secondary: "#49beff",
        accent: "#fa896b",
        success: "#7eba56",
        warning: "#ffae1f",
        surface: "#f2f6fa",
      };
}
