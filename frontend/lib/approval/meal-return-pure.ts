/*
 * 식사 외출 대조(순수 함수) — 지출결의서 식대 결제 시각 × ADT 출입 태그(adt_event_raw, 마이그 200).
 * 2026-11-26 사용자 요청: 초과근무 중 저녁 식사로 밖에 나가 있는 시간의 편차가 커서, 지나치게 오래
 * 나가 있는 사람을 특정할 근거가 필요하다.
 *
 * 출입 태그의 한계(2026-11-26 export 11,130건 실측): 문 앞 단말기는 밖에서 들어올 때만 찍히고
 * (1206호 외부·1208호의 '출입(5)'), 낮·저녁에 나갈 때는 태그가 남지 않는다(1206호 내부 단말기는
 * 거의 퇴근 버튼용). 그래서 '나간 시각'은 알 수 없고, 다음 두 값으로 범위를 잡는다.
 *   · 결제 시각 P: 식당에서 결제했으므로 그 시각엔 밖에 있었다.
 *   · 복귀 태그 R: 결제 이후 첫 사무실 출입문 진입 태그.
 *   · 직전 태그 L: 결제 이전 마지막 태그 — 그때는 안에 있었으므로 나간 시각은 L 이후다.
 *   ⇒ 결제 후 복귀까지(R−P)는 외출 시간의 '최소', 직전 태그부터 복귀까지(R−L)는 '최대'.
 * 복귀 태그보다 먼저 다른 태그(회의실·퇴근 버튼 등)가 찍혔다면 남과 함께 들어와 진입 태그가
 * 빠진 것이므로 R 을 알 수 없다 — '복귀 미기록'으로 두고 최소값을 내지 않는다(그 태그 시각까지는
 * 들어와 있었다는 상한만 남는다). 결제 후 태그가 없으면 '태그 없음'(퇴근했거나 미기록).
 * 배달앱 결제는 자리에서 하므로 외출이 아니다 — 사용처로 가려 '배달'로 두고 집계에서 뺀다.
 */

/** 사무실 출입문(밖→안 진입) 단말기 — 1208호·1206호 외부. 나머지는 회의실·대표실·내부(퇴근) 단말기. */
export const OFFICE_ENTRY_TERMINALS = new Set(["0005", "0006"]);
/** 진입으로 보는 근태내역 — '1' 출근 · '5' 출입. ('2' 퇴근은 안에서 나갈 때 누른다.) */
const ENTRY_CODES = new Set(["1", "5"]);
/** 외출이 길다고 표시하는 기준(분) — 결제 후 복귀까지(최소 외출). */
export const LONG_OUT_MINUTES = 60;
/** 이 시각(초) 이전의 익일 새벽 태그까지 그날 기록으로 본다(근태 집계의 06:00 경계와 동일). */
const NEXT_DAY_CUTOFF_SEC = 6 * 3600;

export interface ReturnTag {
  /** 사용일 0시 기준 초(익일 새벽은 86400 이상). */
  sec: number;
  terminalId: string;
  eventCode: string;
}

export type ReturnStatus = "tagged" | "untagged" | "none" | "delivery";

/** 배달앱 가맹점명(카드 승인 가맹점·영수증 상호) — 자리에서 결제하므로 외출 대조 대상이 아니다. */
const DELIVERY_VENDOR_RE = /배달의\s*민족|배민|우아한\s*형제|쿠팡\s*이츠|요기요|위대한\s*상상|땡겨요|배달특급/;

export function isDeliveryVendor(vendor: string | null | undefined): boolean {
  return DELIVERY_VENDOR_RE.test(String(vendor ?? ""));
}

export interface ReturnPairing {
  status: ReturnStatus;
  lastBefore: ReturnTag | null; // 결제 이전 마지막 태그
  next: ReturnTag | null; // 결제 이후 첫 태그(복귀 태그와 같을 수도)
  /** 결제 후 복귀까지(분) — tagged 일 때만. 외출 시간의 최소값. */
  minOutMinutes: number | null;
  /** 직전 태그부터 복귀까지(분) — tagged 이고 직전 태그가 있을 때. 외출 시간의 최대값. */
  maxOutMinutes: number | null;
}

/** 'HH:MM' / 'HH:MM:SS' / 'HHMMSS' → 초. 형식이 어긋나면 null. */
export function secOfClock(v: string | null | undefined): number | null {
  const s = String(v ?? "").trim();
  let m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) m = /^(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]), se = Number(m[3] ?? 0);
  if (h > 23 || mi > 59 || se > 59) return null;
  return h * 3600 + mi * 60 + se;
}

/** 초 → 'HH:MM'(익일은 시각만 — 화면이 '익일' 표기를 붙인다). */
export function clockOfSec(sec: number): string {
  const s = ((sec % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

/**
 * 태그(사용일 YYYYMMDD·익일 YYYYMMDD 의 d_date/t_time) → 사용일 0시 기준 초.
 * 사용일·익일 새벽(06:00 전) 태그만 대상, 그 밖은 null.
 */
export function tagSecOnDay(usedYmd8: string, nextYmd8: string, dDate: string, tTime: string): number | null {
  const sec = secOfClock(tTime);
  if (sec == null) return null;
  if (dDate === usedYmd8) return sec;
  if (dDate === nextYmd8 && sec < NEXT_DAY_CUTOFF_SEC) return 86400 + sec;
  return null;
}

/** 결제 시각(초) × 그날 태그 → 복귀 짝짓기. 배달앱 결제(opts.delivery)는 짝짓지 않는다. */
export function pairReturn(paidSec: number, tags: ReturnTag[], opts?: { delivery?: boolean }): ReturnPairing {
  if (opts?.delivery) return { status: "delivery", lastBefore: null, next: null, minOutMinutes: null, maxOutMinutes: null };
  const sorted = [...tags].sort((a, b) => a.sec - b.sec);
  let lastBefore: ReturnTag | null = null;
  let next: ReturnTag | null = null;
  for (const t of sorted) {
    if (t.sec <= paidSec) lastBefore = t;
    else if (!next) next = t;
  }
  if (!next) return { status: "none", lastBefore, next: null, minOutMinutes: null, maxOutMinutes: null };
  const isEntry = OFFICE_ENTRY_TERMINALS.has(next.terminalId) && ENTRY_CODES.has(next.eventCode);
  if (!isEntry) return { status: "untagged", lastBefore, next, minOutMinutes: null, maxOutMinutes: null };
  return {
    status: "tagged",
    lastBefore,
    next,
    minOutMinutes: Math.floor((next.sec - paidSec) / 60),
    maxOutMinutes: lastBefore ? Math.floor((next.sec - lastBefore.sec) / 60) : null,
  };
}

export interface MealReturnSummaryInput {
  employeeId: string;
  status: ReturnStatus;
  minOutMinutes: number | null;
}

export interface MealReturnPersonSummary {
  employeeId: string;
  count: number; // 대조 대상 식대 건수(배달 포함)
  tagged: number; // 복귀 태그가 확인된 건수
  avgMinOut: number | null; // 복귀 확인 건의 결제 후 복귀까지 평균(분)
  maxMinOut: number | null;
  longCount: number; // LONG_OUT_MINUTES 이상
}

/** 직원별 요약 — 평균·최대·장시간 건수는 복귀 태그가 확인된 건만 센다. */
export function summarizeByPerson(rows: MealReturnSummaryInput[]): MealReturnPersonSummary[] {
  const by = new Map<string, MealReturnSummaryInput[]>();
  for (const r of rows) {
    if (!by.has(r.employeeId)) by.set(r.employeeId, []);
    by.get(r.employeeId)!.push(r);
  }
  const out: MealReturnPersonSummary[] = [];
  for (const [employeeId, list] of by) {
    const mins = list.filter((r) => r.status === "tagged" && r.minOutMinutes != null).map((r) => r.minOutMinutes!);
    out.push({
      employeeId,
      count: list.length,
      tagged: mins.length,
      avgMinOut: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
      maxMinOut: mins.length ? Math.max(...mins) : null,
      longCount: mins.filter((m) => m >= LONG_OUT_MINUTES).length,
    });
  }
  // 장시간 건수 → 평균 순으로 — 확인이 필요한 사람이 위로 온다.
  return out.sort((a, b) => b.longCount - a.longCount || (b.avgMinOut ?? -1) - (a.avgMinOut ?? -1));
}
