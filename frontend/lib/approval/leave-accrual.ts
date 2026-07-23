/*
 * 연차 발생 자동계산(순수 — 클라/서버 공유). 근로기준법 기준.
 * - 입사 1년 미만: 1개월 개근 시 1일씩, 최대 11일(입사 후 1년까지).
 * - 1년 이상: 15일. 3년 이상부터 매 2년마다 1일 가산, 최대 25일.
 *   (근속 n년: 15 + floor((n-1)/2), 상한 25 — n=1→15, 3→16, 5→17 … 21년+→25)
 * accrual_basis:
 *   - 'hire_date': 해당 연도 중 입사기념일 시점의 근속연수 기준 발생.
 *   - 'jan1'(회계연도): 해당 연도 1/1 시점 근속 기준. 입사 첫 회계연도는 전년 재직일수 비례(*15).
 * ※ 회사 실제 부여(임포트 grant)와 다를 수 있어 "규정 발생일수(참고)"로 표시하며,
 *   관리자가 필요 시 grant 로 반영한다(자동 덮어쓰지 않음).
 */

export type AccrualBasis = "jan1" | "hire_date";

/** 만 근속연수(기준일 시점, 미만 버림). */
function completedYears(hire: Date, at: Date): number {
  let y = at.getFullYear() - hire.getFullYear();
  const anniv = new Date(at.getFullYear(), hire.getMonth(), hire.getDate());
  if (at < anniv) y -= 1;
  return y;
}

/** 만 근속개월(입사 후 경과 개월, 미만 버림). */
function completedMonths(hire: Date, at: Date): number {
  let m = (at.getFullYear() - hire.getFullYear()) * 12 + (at.getMonth() - hire.getMonth());
  if (at.getDate() < hire.getDate()) m -= 1;
  return Math.max(0, m);
}

/** 근속연수 → 정규 연차일수(1년 이상). */
function annualForYears(years: number): number {
  if (years < 1) return 0;
  return Math.min(25, 15 + Math.floor((years - 1) / 2));
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * 규정상 발생연차 계산. hireDate = 'YYYY-MM-DD', year = 대상 연도(숫자|문자).
 * 계산 불가(입사일 없음/미래 입사)면 null.
 */
export function computeAccrual(hireDate: string | null, year: number | string, basis: AccrualBasis): number | null {
  const hire = parseDate(hireDate);
  if (!hire) return null;
  const y = Number(year);
  if (!Number.isFinite(y)) return null;
  if (hire.getFullYear() > y) return null; // 아직 입사 전

  if (basis === "hire_date") {
    // 대상 연도 말 시점 근속으로 발생일수 산정. 1년 미만은 개근 월수(최대 11).
    const at = new Date(y, 11, 31);
    const months = completedMonths(hire, at);
    const years = completedYears(hire, at);
    if (years < 1) return Math.min(11, months);
    return annualForYears(years);
  }

  // jan1 (회계연도): 대상 연도 1/1 시점 근속 기준.
  const jan1 = new Date(y, 0, 1);
  if (hire.getFullYear() === y) {
    // 입사 첫 회계연도: 입사일~연말 재직일수 비례(*15), 소수 첫째자리 반올림.
    const yearEnd = new Date(y, 11, 31);
    const daysWorked = Math.round((yearEnd.getTime() - hire.getTime()) / 86400000) + 1;
    const prorated = Math.round(((daysWorked / 365) * 15) * 10) / 10;
    return Math.min(15, prorated);
  }
  const years = completedYears(hire, jan1);
  return annualForYears(years);
}
