/**
 * 직원 일람표 계산 규칙 — DB·화면과 떨어진 순수 함수(tests/employee-roster.test.ts).
 * 날짜는 인사 테이블 관례대로 문자열(YYYY-MM-DD 또는 YYYY-MM)이다. 점·빗금 구분도 받아 준다.
 */

const DAY_MS = 86_400_000;
/** 한 달 평균 일수 — 경력 개월 수는 기간 일수를 이 값으로 나눠 버린다(엑셀 DATEDIF 개월과 같은 결과). */
const MONTH_DAYS = 30.4375;

export type DegreeLevel = "bachelor" | "master" | "doctor";
export const DEGREE_LABEL: Record<DegreeLevel, string> = { bachelor: "학사", master: "석사", doctor: "박사" };
const DEGREE_RANK: Record<DegreeLevel, number> = { bachelor: 1, master: 2, doctor: 3 };

/** 'YYYY-MM-DD' / 'YYYY-MM' / 'YYYY.MM.DD' → UTC 자정 ms. 달만 있으면 시작은 1일, 끝은 말일로 본다. */
export function parseDay(value: string | null | undefined, edge: "start" | "end" = "start"): number | null {
  const m = String(value ?? "").trim().match(/^(\d{4})[-./](\d{1,2})(?:[-./](\d{1,2}))?/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  if (m[3]) {
    const d = Number(m[3]);
    if (d < 1 || d > 31) return null;
    return Date.UTC(y, mo - 1, d);
  }
  return edge === "start" ? Date.UTC(y, mo - 1, 1) : Date.UTC(y, mo, 0);
}

/** 만 나이(기준일). 생년월일을 읽을 수 없으면 null. */
export function ageOn(birthDate: string | null | undefined, asOf: string): number | null {
  const b = String(birthDate ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  const t = asOf.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!b || !t) return null;
  let age = Number(t[1]) - Number(b[1]);
  if (t[2] + t[3] < b[2] + b[3]) age -= 1;
  return age >= 0 ? age : null;
}

/** 일 단위 기간 묶음(끝 포함)을 겹침 없이 합친 개월 수. */
function unionMonths(intervals: Array<[number, number]>): number {
  const sorted = intervals.filter(([a, b]) => b >= a).sort((x, y) => x[0] - y[0]);
  let days = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of sorted) {
    if (cur && a <= cur[1] + DAY_MS) {
      cur[1] = Math.max(cur[1], b);
    } else {
      if (cur) days += (cur[1] - cur[0]) / DAY_MS + 1;
      cur = [a, b];
    }
  }
  if (cur) days += (cur[1] - cur[0]) / DAY_MS + 1;
  return Math.floor(days / MONTH_DAYS + 1e-9);
}

export interface CareerPeriod {
  workedFrom: string | null;
  workedTo: string | null;
}

/**
 * 경력 개월 수.
 *  - 당사: 입사일 ~ 퇴사일(재직 중이면 기준일).
 *  - 이전: 인사카드 경력 행을 입사일 전날까지로 자르고 겹치는 기간은 한 번만 센다(겸직·동시 재직 경력).
 *    끝이 비어 있는 행은 입사일 전날까지로 본다. 입사일 이후 시작한 행(재직 중 겸직)은 넣지 않는다.
 *  - 합계: 당사 + 이전(이전은 입사일 전으로 잘렸으니 겹치지 않는다).
 */
export function careerMonths(input: {
  hiredAt: string | null;
  endAt: string | null; // 퇴사일 또는 기준일
  careers: CareerPeriod[];
}): { company: number | null; prior: number; total: number | null } {
  const hired = parseDay(input.hiredAt, "start");
  const end = parseDay(input.endAt, "end");
  const company = hired != null && end != null && end >= hired ? unionMonths([[hired, end]]) : null;
  const cap = hired != null ? hired - DAY_MS : end;
  const prior = unionMonths(
    input.careers.flatMap((c): Array<[number, number]> => {
      const from = parseDay(c.workedFrom, "start");
      if (from == null) return [];
      const to = parseDay(c.workedTo, "end") ?? cap;
      if (to == null) return [];
      return [[from, cap != null ? Math.min(to, cap) : to]];
    })
  );
  return { company, prior, total: company == null ? (prior || null) : company + prior };
}

/** 개월 수 → 'N년 M개월'(0 은 '-'). */
export function formatMonths(months: number | null): string {
  if (months == null) return "";
  if (months <= 0) return "-";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (!y) return `${m}개월`;
  return m ? `${y}년 ${m}개월` : `${y}년`;
}

export interface EducationEntry {
  degreeLevel: DegreeLevel;
  schoolName: string;
  major: string | null;
  graduationDate: string | null;
}

/** 최종학력 — 학위가 가장 높은 행, 같으면 졸업이 늦은 행. */
export function finalEducation(rows: EducationEntry[]): EducationEntry | null {
  let best: EducationEntry | null = null;
  for (const r of rows) {
    if (!best) {
      best = r;
      continue;
    }
    const d = (DEGREE_RANK[r.degreeLevel] ?? 0) - (DEGREE_RANK[best.degreeLevel] ?? 0);
    if (d > 0 || (d === 0 && String(r.graduationDate ?? "") > String(best.graduationDate ?? ""))) best = r;
  }
  return best;
}

/** 자격증 열 순서 — 등록 선택지 순서(기술사 → 기사 → 산업기사 → 기능사), 선택지에 없는 이름은 뒤에 가나다순. */
export function orderCertificationNames(names: Iterable<string>, preferred: readonly string[]): string[] {
  const rank = new Map(preferred.map((n, i) => [n, i]));
  return [...new Set(names)].sort((a, b) => {
    const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ra !== rb ? ra - rb : a.localeCompare(b, "ko");
  });
}

/** 일람표 미등록 항목 — 인사카드에서 채워야 하는 칸만(경력·자격은 없을 수 있어 넣지 않는다). */
export function rosterMissing(row: {
  birthDate: string | null;
  hiredAt: string | null;
  education: unknown;
  annualSalary: number | null;
  salaryVisible: boolean;
}): string[] {
  const out: string[] = [];
  if (!row.birthDate) out.push("생년월일");
  if (!row.hiredAt) out.push("입사일");
  if (!row.education) out.push("학력");
  if (row.salaryVisible && row.annualSalary == null) out.push("연봉");
  return out;
}
