// 변경 이벤트 요약(278 변경 이력 카드) — change_payload_json 은 변경계약 모달의 탭별 상태 그대로라
// 이전값·새값이 함께 있다. 여기서 "무엇이 어떻게 바뀌었는지"를 사람이 읽는 줄로 바꾼다.

export const CHANGE_FIELD_LABELS: Record<string, string> = {
  amounts: "금액·단계",
  servicePeriod: "준공일",
  paymentTerms: "대금 지급 조건",
  serviceCategory: "용역분류",
  paymentMethod: "대금 지급 방식",
  targetFacilities: "대상사업장",
  orderingSubjectType: "발주 주체",
  closing: "준공·허가·기타",
  termination: "해지·중지",
  outsourcing: "외주 용역",
  contractDate: "계약일",
  contractTitle: "계약명",
  counterparty: "업체",
};

type Obj = Record<string, unknown>;

const asObj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const asArr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]).map(asObj) : []);
const text = (v: unknown) => String(v ?? "").trim();
const won = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n.toLocaleString("ko-KR") : text(v);
};
const arrow = (label: string, prev: string, next: string) => `${label}: ${prev || "-"} → ${next}`;

/** 한 변경 이벤트의 변경 내용 줄 목록. 바뀐 값이 없으면 변경 항목 이름만 돌려준다. */
export function summarizeChangeEvent(event: Obj): string[] {
  const payload = asObj(event.change_payload_json);
  const fields = Array.isArray(event.changed_fields_json) ? (event.changed_fields_json as unknown[]).map(String) : [];
  const lines: string[] = [];

  const prevTotal = event.previous_amount != null ? Number(event.previous_amount) : null;
  const delta = event.delta_amount != null ? Number(event.delta_amount) : null;
  if (prevTotal != null && delta) lines.push(arrow("계약금액", won(prevTotal) + "원", won(prevTotal + delta) + "원"));
  for (const row of asArr(payload.amounts)) {
    const next = text(row.nextAmount);
    const prev = text(row.previousAmount);
    if (!next || next === prev) continue;
    lines.push(arrow(text(row.stageLabel) || "단계", prev ? won(prev) : "신규", won(next)));
  }

  const period = asObj(payload.servicePeriod);
  if (text(period.next)) lines.push(arrow("준공일", text(period.previous), text(period.next)));

  for (const row of asArr(payload.paymentTerms)) {
    if (text(row.next)) lines.push(arrow(`${text(row.stageLabel)} 지급 조건`, text(row.previous), text(row.next)));
  }

  const category = asObj(payload.serviceCategory);
  if (text(category.nextType)) lines.push(arrow("용역분류", text(category.previousType), text(category.nextType)));
  if (text(category.nextSubtype)) lines.push(arrow("용역세분류", text(category.previousSubtype), text(category.nextSubtype)));
  if (text(category.nextIndustry)) lines.push(arrow("업종", text(category.previousIndustry), text(category.nextIndustry)));
  if (text(category.nextPaymentMethod)) {
    lines.push(arrow("대금 지급 방식", text(category.previousPaymentMethod), text(category.nextPaymentMethod)));
  }

  const closing = asObj(payload.closing);
  // 준공 탭의 준공일은 기간 변경(servicePeriod)과 같은 값으로 함께 저장되는 경우가 많아 다를 때만 따로 적는다.
  if (text(closing.completionDate) && text(closing.completionDate) !== text(period.next)) {
    lines.push(`준공일: ${text(closing.completionDate)}`);
  }
  if (text(closing.permitAcquiredAt)) lines.push(`허가 취득일: ${text(closing.permitAcquiredAt)}`);

  const termination = asObj(payload.termination);
  if (text(termination.terminatedAt)) {
    lines.push(`해지: ${text(termination.terminatedAt)}${text(termination.terminationReason) ? ` (${text(termination.terminationReason)})` : ""}`);
  }
  if (text(termination.suspendedAt)) {
    lines.push(`중지: ${text(termination.suspendedAt)}${text(termination.suspensionReason) ? ` (${text(termination.suspensionReason)})` : ""}`);
  }

  const outsourcing = asObj(payload.outsourcing);
  if (text(outsourcing.outsourcingTitle)) lines.push(`외주 용역: ${text(outsourcing.outsourcingTitle)}`);

  const note = text(event.detail) || text(closing.etc) || text(asObj(payload.meta).memo);
  if (note) lines.push(`비고: ${note}`);

  // 값으로 표현하지 못한 항목(대상사업장·발주 주체·계약명 등)은 이름만 남긴다.
  const shown = new Set(["amounts", "servicePeriod", "paymentTerms", "serviceCategory", "paymentMethod", "closing", "termination", "outsourcing"]);
  const rest = fields.filter((f) => !shown.has(f)).map((f) => CHANGE_FIELD_LABELS[f] ?? f);
  if (rest.length) lines.push(`변경 항목: ${rest.join(", ")}`);
  return lines;
}

/** 차수에 묶인 이벤트들의 계약금액 변화(첫 이벤트의 이전 금액 → 증감 합 반영). */
export function roundAmountChange(events: Obj[]): { previous: number; next: number } | null {
  const ordered = [...events].sort((a, b) => text(a.created_at).localeCompare(text(b.created_at)));
  const first = ordered.find((e) => e.previous_amount != null);
  if (!first) return null;
  const previous = Number(first.previous_amount);
  const delta = ordered.reduce((acc, e) => acc + (Number(e.delta_amount) || 0), 0);
  if (!delta) return null;
  return { previous, next: previous + delta };
}
