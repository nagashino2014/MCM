// /admin/ai-usage 화면 공용 타입·포맷 — API 응답 타입은 서버 모듈에서 type-only 로 가져온다(번들 미포함).
import type { AiUsageKpis, DailyPoint, FeatureStat, ModelStat, MonthlyPoint, UsageLogRow } from "@/lib/ai/usage-stats";
import type { AiSettings } from "@/lib/ai/settings";
import type { ModelPriceRow } from "@/lib/ai/pricing";

export type { AiUsageKpis, DailyPoint, FeatureStat, ModelStat, MonthlyPoint, UsageLogRow, AiSettings, ModelPriceRow };

export interface SummaryResponse {
  asOf: string;
  range: { from: string; to: string };
  kpis: AiUsageKpis;
  features: FeatureStat[];
  models: ModelStat[];
  daily: DailyPoint[];
  monthly: MonthlyPoint[];
  settings: AiSettings;
  prices: ModelPriceRow[];
  canManage: boolean;
}

export type RangePreset = "today" | "7d" | "30d" | "month" | "custom";

export const STATUS_LABEL: Record<string, string> = {
  ok: "성공",
  truncated: "잘림",
  error: "오류",
  timeout: "타임아웃",
  refusal: "거부",
  budget_blocked: "예산 차단",
};

export const STATUS_TONE: Record<string, string> = {
  ok: "cd-pill-success",
  truncated: "cd-pill-warn",
  error: "cd-pill-error",
  timeout: "cd-pill-error",
  refusal: "cd-pill-warn",
  budget_blocked: "cd-pill-idle",
};

/** USD 금액 — 합계용. 기본 소수 2자리, 소액(< $0.1)은 유효숫자가 보이도록 자릿수를 늘린다. */
export function fmtUsd(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "-";
  const d = v !== 0 && Math.abs(v) < 0.01 ? Math.max(digits, 4) : v !== 0 && Math.abs(v) < 0.1 ? Math.max(digits, 3) : digits;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

/** 차트 축 라벨용 — 크기에 따라 자릿수 자동. */
export function fmtAxisUsd(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (v === 0) return "$0";
  if (Math.abs(v) >= 1) return `$${Math.round(v)}`;
  if (Math.abs(v) >= 0.01) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

/** USD 단가 — 호출당 금액처럼 작은 값(유효숫자 유지: $0.0025). */
export function fmtUsdSmall(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-";
  if (v === 0) return "$0";
  if (v >= 1) return fmtUsd(v, 2);
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}

export function fmtKrw(usd: number | null | undefined, rate: number | null): string {
  if (usd == null || rate == null || !Number.isFinite(usd)) return "";
  return `₩${Math.round(usd * rate).toLocaleString("ko-KR")}`;
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return Math.round(v).toLocaleString("ko-KR");
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return `${v.toFixed(digits)}%`;
}

/** ISO → KST "MM-DD HH:mm". */
export function fmtKstShort(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(5, 16).replace("T", " ");
}

export function fmtKstFull(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export const GROUP_ORDER = ["전자결재", "업무보고", "문서 파싱", "양식 분석", "영업 인텔", "스크래퍼", "기타"];

/** 모델 정규형 ID → 짧은 표시명(단가표 display_name 우선). */
export function modelLabel(family: string | null | undefined, prices: ModelPriceRow[]): string {
  if (!family) return "-";
  return prices.find((p) => p.modelFamily === family)?.displayName ?? family;
}
