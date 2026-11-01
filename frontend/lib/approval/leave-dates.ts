// 휴가 날짜 계산 — 주말(토·일)과 휴무일(법정공휴일·근로자의 날·사내 지정 휴무일)을 뺀 근무일 기준.
// 2026-10-30 사내 테스트 피드백: 2주에 걸친 연차를 기간으로 넣으면 주말까지 일수에 들어갔고,
// 시작일 + 일수로만 저장된 휴가(대장 1행)는 캘린더·목록에 시작일 하루만 보였다.
// 클라이언트(기안 화면)와 서버(캘린더 API) 공용 — DB·Node 의존 없음. 휴무일 집합은 호출자가 넘긴다
// (서버: lib/hr/holidays offDaySet, 클라이언트: /api/home/holidays).

export const addDaysYmd = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const isYmd = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** 토·일 여부(UTC 정오 기준이라 시간대에 흔들리지 않는다). */
export function isWeekendYmd(ymd: string): boolean {
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

export const isWorkday = (ymd: string, offDays: ReadonlySet<string>): boolean => !isWeekendYmd(ymd) && !offDays.has(ymd);

/** from~to(양끝 포함) 사이 근무일 수. 날짜가 잘못되었거나 뒤집혔으면 0. */
export function countWorkdays(from: string, to: string, offDays: ReadonlySet<string>): number {
  if (!isYmd(from) || !isYmd(to) || to < from) return 0;
  let n = 0;
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) if (isWorkday(d, offDays)) n += 1;
  return n;
}

/**
 * 시작일부터 근무일 n일을 채우는 종료일 — 고정 일수 휴가(경조 등)·시작일+일수 휴가의 끝 날짜.
 * 시작일이 휴무일이어도 시작일로 둔다(사용자가 고른 날짜를 옮기지 않는다).
 */
export function endAfterWorkdays(from: string, days: number, offDays: ReadonlySet<string>): string {
  const need = Math.max(1, Math.ceil(days));
  let last = from;
  let count = 0;
  for (let d = from, guard = 0; count < need && guard < 400; d = addDaysYmd(d, 1), guard += 1) {
    if (d === from || isWorkday(d, offDays)) {
      count += 1;
      last = d;
    }
  }
  return last;
}

/**
 * 휴가 1건이 실제로 쉬는 날짜 목록.
 * - 기간(from~to)이 있으면 그 사이 근무일(근무일이 하나도 없으면 기간 전체 — 휴일 근무 대체 등 예외 보존).
 * - 종료일이 없거나 시작일과 같으면 시작일부터 일수(days, 반차 0.5 → 하루)만큼의 근무일.
 */
export function leaveDates(
  input: { from: string; to?: string | null; days?: number | null },
  offDays: ReadonlySet<string>,
): string[] {
  const { from } = input;
  if (!isYmd(from)) return [];
  let to = isYmd(input.to) && input.to >= from ? input.to : from;
  const days = Number(input.days ?? 0);
  if (to === from && days > 1) to = endAfterWorkdays(from, days, offDays);
  const all: string[] = [];
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) all.push(d);
  if (all.length === 1) return all;
  const work = all.filter((d) => d === from || isWorkday(d, offDays));
  return work.length ? work : all;
}

/** 대장 비고에 남은 기간("YYYY-MM-DD~YYYY-MM-DD")의 종료일 — 결재 승인으로 적재된 행은 비고에 기간이 있다. */
export function periodEndFromNote(note: unknown): string | null {
  const m = String(note ?? "").match(/(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})/);
  return m ? m[2] : null;
}

/** 목록 표시용 'MM.DD' 나열 — 복수일 휴가는 실제 쉬는 날짜를 모두 보여 준다(사용자 요청 2026-10-30). */
export function formatLeaveDateList(dates: string[]): string {
  return dates.map((d) => d.slice(5).replace("-", ".")).join(", ");
}
