/** 영업 인텔 화면의 공통 JSON 요청. 서버가 돌려준 검증·권한 오류를 그대로 보여 준다. */
export async function intelApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `요청에 실패했습니다 (${response.status}).`);
  return body as T;
}
export function jsonBody(value: unknown): Pick<RequestInit, "body"> { return { body: JSON.stringify(value) }; }
export function intelTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(date);
}
export function commaValues(value: string): string[] { return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))]; }
export function safeIntelUrl(value: string | null | undefined): string | undefined {
  try { const url = new URL(value || ""); return ["https:", "http:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
export const INTEL_STAGE_LABELS: Record<string, string> = { unknown: "미확인", mou: "MOU", announced: "투자 발표", approved: "승인", permitting: "인허가", construction: "공사 중", operating: "가동", delayed: "지연", suspended: "중단", canceled: "취소" };
export const INTEL_SERVICE_LABELS: Record<string, string> = { integrated_permit: "통합환경허가", chem: "화관법", haps: "유해대기오염물질", esg: "ESG", etc: "기타" };
/** 관심 분야·브리핑 분류에 쓰는 서비스(HAPs·기타는 관심 조건에서 제외 — 2026-11-01 사용자 결정). 평가(F04) 코드는 그대로 둔다. */
export const INTEL_INTEREST_SERVICES = ["integrated_permit", "chem", "esg"] as const;
export { INTEL_SOURCE_LABELS, intelSourceLabel, humanizeSourceKeys } from "@/lib/intel/source-labels";

/** 투자금액 표기 — 원화는 조·억·만 단위로 읽히게, 외화는 통화 코드를 붙인다. */
export function formatIntelAmount(amount: number | null | undefined, currency = "KRW"): string {
  if (amount == null || !Number.isFinite(amount)) return "미확인";
  if (currency !== "KRW") return `${amount.toLocaleString()} ${currency}`;
  const eok = Math.round(amount / 1e8);
  if (eok >= 10000) {
    const jo = Math.floor(eok / 10000), rest = eok % 10000;
    return rest ? `${jo.toLocaleString()}조 ${rest.toLocaleString()}억원` : `${jo.toLocaleString()}조원`;
  }
  if (eok >= 1) return `${eok.toLocaleString()}억원`;
  return `${Math.round(amount / 1e4).toLocaleString()}만원`;
}

/** 억원 입력값 ↔ 원 — 관심 조건의 규모 입력에 쓴다. */
export const eokToWon = (value: string): number | null => (value.trim() === "" || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 1e8));
export const wonToEok = (value: number | null | undefined): string => (value == null ? "" : String(Math.round((value / 1e8) * 100) / 100));

/** 추진 단계의 상태 톤 — 색은 진행(성공)·주의(지연·중단)·오류(취소)만 쓴다. */
export function intelStageTone(stage: string | null | undefined): "idle" | "success" | "warn" | "error" | "info" {
  if (stage === "canceled") return "error";
  if (stage === "delayed" || stage === "suspended") return "warn";
  if (stage === "construction" || stage === "operating" || stage === "approved") return "success";
  if (stage === "permitting" || stage === "announced" || stage === "mou") return "info";
  return "idle";
}

export function intelDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length <= 10 ? `${value}T00:00:00+09:00` : value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}
