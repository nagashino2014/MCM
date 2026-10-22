// 회사소개서 화면 공용 fetch — JSON/FormData 겸용, 실패 시 서버 오류 문구로 throw.
export async function catalogFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: init?.body instanceof FormData || !init?.body ? undefined : { "Content-Type": "application/json" },
    cache: "no-store",
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `요청 실패 (HTTP ${res.status})`);
  return data as T;
}

/** 원 단위 금액 → '1,234만 원' 같은 짧은 표기(표·요약용). */
export function formatAmountShort(amount: number | null): string {
  if (amount == null || amount <= 0) return "—";
  if (amount >= 100_000_000) return `${(Math.round(amount / 10_000_000) / 10).toLocaleString("ko-KR")}억`;
  return `${Math.round(amount / 10_000).toLocaleString("ko-KR")}만`;
}
