/** 매입 계약 화면 공용 fetch(331) — 오류 본문의 error 를 메시지로 올린다. 클라이언트 전용. */
export async function purchaseApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string })?.error ?? "HTTP " + res.status);
  }
  return (await res.json()) as T;
}

export const purchaseJson = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** 사업장 검색 결과(GET /api/facilities items) 중 매입 모달이 쓰는 필드. */
export interface PurchaseFacilityItem {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
  tradeRoles?: string[];
}

/** 관련 매출 계약 검색 결과(GET /api/contracts items) 중 매입 모달이 쓰는 필드. */
export interface RelatedContractItem {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  contractDate: string | null;
  serviceType: string | null;
}
