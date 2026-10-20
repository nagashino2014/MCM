// 성과급 기안 표 ↔ 현재 산정 명세 대조(F-20) — 발송 게이트(lib/bonus/send.ts)·화면 배지의 근거.

const planMoney = (v: unknown) => Math.round(Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0);

/**
 * 기안 표와 현재 명세의 불일치 인원 수 — 이름별 금액 목록(중복 이름 포함)을 맞대어 짝이 안 맞는 행을 센다
 * (금액만 바뀐 1명은 양쪽에 1행씩 남으므로 큰 쪽을 인원 수로 본다).
 * 기안 후 [일괄산정]·배분 조정으로 금액이 바뀌었거나 기안 화면에서 금액을 고친 경우를 모두 잡는다.
 */
export function countPlanMismatch(
  planRows: Array<{ name?: unknown; amount?: unknown }>,
  overview: Array<{ employeeName: string; totalAmount: number }>
): number {
  const pending = new Map<string, number>();
  for (const r of planRows) {
    const key = `${String(r.name ?? "").trim()}|${planMoney(r.amount)}`;
    pending.set(key, (pending.get(key) ?? 0) + 1);
  }
  let unmatchedCurrent = 0;
  for (const r of overview) {
    const key = `${r.employeeName.trim()}|${Math.round(r.totalAmount)}`;
    const left = pending.get(key) ?? 0;
    if (left > 0) pending.set(key, left - 1);
    else unmatchedCurrent += 1;
  }
  let unmatchedPlan = 0;
  for (const left of pending.values()) unmatchedPlan += left;
  return Math.max(unmatchedCurrent, unmatchedPlan);
}
