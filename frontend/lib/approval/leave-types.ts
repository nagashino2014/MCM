/*
 * 휴가 종류 규정 카탈로그(086 leave_types) — 사규 [별표 5. 경조금 지급 규정] 기반.
 * ★규정이 바뀔 수 있으므로 코드 상수가 아니라 DB 로 관리하고 관리자가 화면에서 편집한다.
 * 연차/반차만 연차 대장에서 차감(deduct), 경조·출산·조의는 규정상 부여일수(days) 고정,
 * 공가·병가는 실사용 기간만큼(가변, 비차감). leave_type 필드가 이 카탈로그로 렌더된다.
 * ⚠ 이 파일은 클라이언트 안전(타입·시드·순수 조회만) — DB 접근은 leave-types-store.ts(서버).
 */

export interface LeaveTypeItem {
  key: string;
  label: string;
  group: string;
  /** 규정상 고정 부여일수(경조·출산·조의·건강검진). null = 실사용 기간만큼(공가·병가·기타) */
  days: number | null;
  /** 연차 대장 차감 방식 — full=1일, half=0.5일. null = 비차감 */
  deduct: "full" | "half" | null;
  sortOrder: number;
  active: boolean;
}

/** 초기 시드(사규 개정안 기준) — 086 마이그레이션과 이 목록이 일치해야 한다. */
export const DEFAULT_LEAVE_TYPES: Omit<LeaveTypeItem, "sortOrder" | "active">[] = [
  { key: "annual", label: "연차", group: "연차·반차", days: null, deduct: "full" },
  { key: "half_am", label: "반차(오전)", group: "연차·반차", days: null, deduct: "half" },
  { key: "half_pm", label: "반차(오후)", group: "연차·반차", days: null, deduct: "half" },
  { key: "wed_self", label: "결혼(본인)", group: "경조 · 결혼", days: 5, deduct: null },
  { key: "wed_child", label: "결혼(자녀)", group: "경조 · 결혼", days: 1, deduct: null },
  { key: "wed_sibling", label: "결혼(형제·자매)", group: "경조 · 결혼", days: 1, deduct: null },
  { key: "longevity_parent", label: "수연(부모)", group: "경조 · 수연", days: 1, deduct: null },
  { key: "longevity_parent_in_law", label: "수연(처·시부모)", group: "경조 · 수연", days: 1, deduct: null },
  { key: "longevity_self", label: "수연(본인)", group: "경조 · 수연", days: 1, deduct: null },
  { key: "longevity_spouse", label: "수연(배우자)", group: "경조 · 수연", days: 1, deduct: null },
  { key: "childbirth_self", label: "출산(여성 본인)", group: "경조 · 출산", days: 90, deduct: null },
  { key: "childbirth_spouse", label: "출산(배우자)", group: "경조 · 출산", days: 20, deduct: null },
  { key: "death_spouse", label: "조의(배우자)", group: "경조 · 조의", days: 5, deduct: null },
  { key: "death_parent", label: "조의(부모)", group: "경조 · 조의", days: 5, deduct: null },
  { key: "death_child", label: "조의(자녀)", group: "경조 · 조의", days: 3, deduct: null },
  { key: "death_grandparent", label: "조의(조부모)", group: "경조 · 조의", days: 2, deduct: null },
  { key: "death_parent_in_law", label: "조의(처·시부모)", group: "경조 · 조의", days: 3, deduct: null },
  { key: "death_sibling", label: "조의(형제·자매)", group: "경조 · 조의", days: 1, deduct: null },
  { key: "official_reserve", label: "공가(예비군)", group: "공가", days: null, deduct: null },
  // 민방위는 1일 부여(146 마이그레이션에서 DB 도 교정) — 예비군만 실사용 기간만큼이다.
  { key: "official_civil", label: "공가(민방위)", group: "공가", days: 1, deduct: null },
  { key: "official_checkup", label: "공가(건강검진)", group: "공가", days: 1, deduct: null },
  { key: "sick_paid", label: "병가(유급)", group: "병가", days: null, deduct: null },
  { key: "sick_injury", label: "병가(산재요양)", group: "병가", days: null, deduct: null },
  { key: "etc", label: "기타", group: "기타", days: null, deduct: null },
  // 특별휴가(363) — 연차가 아니라 특별휴가 원장(special_leave_ledger)에서 차감한다.
  // 잔여가 있는 직원에게만 기안 선택지로 보인다(2026-11-12 직원 개선 요청 18·사용자 결정).
  { key: "special_longevity", label: "장기근속휴가", group: "특별휴가", days: null, deduct: null },
  { key: "special_overtime_comp", label: "초과근무 대체휴가", group: "특별휴가", days: null, deduct: null },
];

/* ---------- 특별휴가 선택지(363) ---------- */

export type SpecialLeaveKind = "longevity" | "overtime_comp";

/** 카탈로그 key → 특별휴가 원장 kind. 이 key 들은 연차를 차감하지 않고 원장 잔여를 차감한다. */
export const SPECIAL_LEAVE_TYPE_KINDS: Readonly<Record<string, SpecialLeaveKind>> = {
  special_longevity: "longevity",
  special_overtime_comp: "overtime_comp",
};

/** 초과근무 대체휴가(시간 단위 원장)를 일 단위 휴가신청으로 쓸 때 1일 = 8시간으로 환산한다. */
export const SPECIAL_LEAVE_HOURS_PER_DAY = 8;

/** 본인 특별휴가 잔여 — /api/approval/leave?me=1 의 special 항목과 같은 모양. */
export interface SpecialLeaveBalance {
  kind: SpecialLeaveKind;
  remaining: number;
  unit: "day" | "hour";
}

export function specialKindOf(key: string | null | undefined): SpecialLeaveKind | null {
  return (key && SPECIAL_LEAVE_TYPE_KINDS[key]) || null;
}

/** kind 의 잔여를 일 단위로(시간 단위는 8시간 = 1일). 단위가 섞여 있으면 합친다. */
export function specialRemainingDays(balances: readonly SpecialLeaveBalance[], kind: SpecialLeaveKind): number {
  let days = 0;
  for (const b of balances) {
    if (b.kind !== kind || !(b.remaining > 0)) continue;
    days += b.unit === "hour" ? b.remaining / SPECIAL_LEAVE_HOURS_PER_DAY : b.remaining;
  }
  return Math.round(days * 100) / 100;
}

/** 선택지 옆 잔여 표기 — "잔여 3일" / "잔여 12.5시간". 잔여가 없으면 null. */
export function specialRemainingText(balances: readonly SpecialLeaveBalance[], kind: SpecialLeaveKind): string | null {
  const hit = balances.filter((b) => b.kind === kind && b.remaining > 0);
  if (!hit.length) return null;
  const hours = hit.filter((b) => b.unit === "hour").reduce((a, b) => a + b.remaining, 0);
  const days = hit.filter((b) => b.unit !== "hour").reduce((a, b) => a + b.remaining, 0);
  const r = (n: number) => Math.round(n * 100) / 100;
  if (hours > 0 && days > 0) return `잔여 ${r(days)}일 + ${r(hours)}시간`;
  return hours > 0 ? `잔여 ${r(hours)}시간` : `잔여 ${r(days)}일`;
}

/**
 * 기안 화면 휴가 종류 선택지 — 특별휴가 항목은 본인 잔여가 있을 때만 보인다.
 * 이미 저장된 값(임시저장·반려 문서)은 잔여가 없어도 표시가 깨지지 않게 남긴다.
 */
export function visibleLeaveTypes<T extends Pick<LeaveTypeItem, "key">>(
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

/**
 * 특별휴가 상신 검증(순수) — 사용일수가 잔여(진행 중인 다른 신청분 제외)를 넘으면 안내 문구.
 * remainingDays·pendingDays 는 일 단위(시간 원장은 8시간 = 1일로 환산한 값).
 */
export function specialLeaveSubmitError(params: {
  label: string;
  useDays: number;
  remainingDays: number;
  pendingDays?: number;
}): string | null {
  const pending = Math.max(0, params.pendingDays ?? 0);
  const available = Math.round((params.remainingDays - pending) * 100) / 100;
  if (params.remainingDays <= 0) {
    return `${params.label} 잔여가 없어 신청할 수 없습니다. 다른 휴가 종류를 고르세요.`;
  }
  if (!(params.useDays > 0)) return `${params.label} 사용일수를 입력하세요.`;
  if (params.useDays > available) {
    const pendingNote = pending > 0 ? ` (결재 중인 다른 신청 ${pending}일 제외)` : "";
    return `${params.label} 잔여 ${Math.max(0, available)}일${pendingNote}보다 많이 신청할 수 없습니다 — 사용일수 ${params.useDays}일.`;
  }
  return null;
}

/** 승인 시 특별휴가 원장 use 수량 — 시간 단위 원장(초과근무 대체)은 일수 × 8시간. */
export function specialLeaveUseAmount(kind: SpecialLeaveKind, useDays: number): { amount: number; unit: "day" | "hour" } {
  if (kind === "overtime_comp") return { amount: Math.round(useDays * SPECIAL_LEAVE_HOURS_PER_DAY * 10) / 10, unit: "hour" };
  return { amount: useDays, unit: "day" };
}

/**
 * 카탈로그에서 휴가 종류 조회(순수) — key 또는 구버전 label 문자열 모두 매칭.
 * 카탈로그가 비어 있으면(DB 미적용 등) DEFAULT 로 폴백한다.
 */
export function findInCatalog(catalog: LeaveTypeItem[], value: unknown): LeaveTypeItem | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const list: Pick<LeaveTypeItem, "key" | "label" | "days" | "deduct" | "group">[] = catalog.length ? catalog : (DEFAULT_LEAVE_TYPES as LeaveTypeItem[]);
  const hit =
    list.find((x) => x.key === v) ??
    list.find((x) => x.label === v) ??
    (v === "반차" ? list.find((x) => x.key === "half_am") : undefined);
  if (!hit) return null;
  return {
    key: hit.key,
    label: hit.label,
    group: hit.group,
    days: hit.days,
    deduct: hit.deduct,
    sortOrder: 0,
    active: true,
  };
}

