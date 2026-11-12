/**
 * 휴가신청 특별휴가 선택지(363) — 장기근속휴가·초과근무 대체휴가는 본인 잔여가 있을 때만 보인다.
 * (2026-11-12 직원 개선 요청 18·사용자 결정) 잔여 차감·상신 거부는 서버가 한다.
 *
 * ⚠ frontend/lib/approval/leave-types.ts 의 특별휴가 부분과 같은 규칙이다(웹이 원본) — 한쪽을 고치면 다른 쪽도 고친다.
 */

export type SpecialLeaveKind = 'longevity' | 'overtime_comp';

/** 카탈로그 key → 특별휴가 원장 kind. */
export const SPECIAL_LEAVE_TYPE_KINDS: Readonly<Record<string, SpecialLeaveKind>> = {
  special_longevity: 'longevity',
  special_overtime_comp: 'overtime_comp',
};

/** 초과근무 대체휴가(시간 단위)를 일 단위로 볼 때 1일 = 8시간. */
export const SPECIAL_LEAVE_HOURS_PER_DAY = 8;

/** /api/approval/leave?me=1 의 special 항목. */
export interface SpecialLeaveBalance {
  kind: SpecialLeaveKind;
  remaining: number;
  unit: 'day' | 'hour';
}

export function specialKindOf(key: string | null | undefined): SpecialLeaveKind | null {
  return (key && SPECIAL_LEAVE_TYPE_KINDS[key]) || null;
}

export function specialRemainingDays(balances: readonly SpecialLeaveBalance[], kind: SpecialLeaveKind): number {
  let days = 0;
  for (const b of balances) {
    if (b.kind !== kind || !(b.remaining > 0)) continue;
    days += b.unit === 'hour' ? b.remaining / SPECIAL_LEAVE_HOURS_PER_DAY : b.remaining;
  }
  return Math.round(days * 100) / 100;
}

/** "잔여 3일" / "잔여 12.5시간" — 잔여가 없으면 null. */
export function specialRemainingText(balances: readonly SpecialLeaveBalance[], kind: SpecialLeaveKind): string | null {
  const hit = balances.filter((b) => b.kind === kind && b.remaining > 0);
  if (!hit.length) return null;
  const hours = hit.filter((b) => b.unit === 'hour').reduce((a, b) => a + b.remaining, 0);
  const days = hit.filter((b) => b.unit !== 'hour').reduce((a, b) => a + b.remaining, 0);
  const r = (n: number) => Math.round(n * 100) / 100;
  if (hours > 0 && days > 0) return `잔여 ${r(days)}일 + ${r(hours)}시간`;
  return hours > 0 ? `잔여 ${r(hours)}시간` : `잔여 ${r(days)}일`;
}

/** 선택지 — 특별휴가는 잔여가 있을 때만, 이미 고른 값(임시저장·반려 문서)은 잔여가 없어도 남긴다. */
export function visibleLeaveTypes<T extends { key: string }>(
  catalog: readonly T[],
  balances: readonly SpecialLeaveBalance[],
  currentKey?: string | null
): T[] {
  return catalog.filter((it) => {
    const kind = specialKindOf(it.key);
    if (!kind) return true;
    if (currentKey && it.key === currentKey) return true;
    return specialRemainingDays(balances, kind) > 0;
  });
}
