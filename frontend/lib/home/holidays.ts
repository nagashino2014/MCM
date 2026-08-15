// 공휴일 데이터 — 외부 무키 소스(Nager.Date)에서 연 단위로 받아 서버 메모리에 캐시한다.
// 쓰임: ①홈 캘린더 일·공휴일 색 구분 ②날씨 위젯의 설·추석 시즌 판정(당일 20일 전 ~ 연휴 마지막 날).
// 변동 휴일(설·추석·부처님오신날)과 대체·임시 공휴일까지 커버하려면 정적 표로는 부족해 외부 소스를 쓴다.
// 외부 실패 시엔 고정일 공휴일만이라도 돌려준다(화면 동작을 막지 않는다).

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string; // 한글 명칭
}

/** 명절 시즌 구간 — 날씨 위젯이 당일 20일 전부터 연휴 마지막 날까지 시즌 씬을 튼다. */
export interface HolidaySeason {
  kind: "seol" | "chuseok";
  day: string; // 명절 당일 YYYY-MM-DD
  start: string; // 표시 시작(당일 - 20일)
  end: string; // 연휴 마지막 날(대체휴일 포함)
}

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
}

// 연도별 캐시 — 공휴일은 하루 안에 바뀔 일이 없지만 임시공휴일 지정을 놓치지 않게 24h TTL.
const cache = new Map<string, { holidays: Holiday[]; fetchedAt: number }>();
const TTL_MS = 24 * 3600 * 1000;

/** 제헌절이 공휴일로 되살아난 해 — 2008년 제외 이후 2026년부터 다시 법정공휴일이다. */
export const CONSTITUTION_DAY_RESTORED_YEAR = 2026;

/** 고정일 공휴일 — 외부 소스 실패 시 폴백이자, 성공 시에도 항상 병합한다.
 *  (Nager 는 대체공휴일이 생기면 당일 대신 대체일만 반환한다 — 예: 광복절이 토요일이면 8/15 가 빠지고
 *  8/17 만 온다. 달력 관례상 당일도 붉게 표시해야 하므로 고정일을 되살린다.) */
function fixedHolidays(year: number): Holiday[] {
  return [
    { date: `${year}-01-01`, name: "신정" },
    { date: `${year}-03-01`, name: "삼일절" },
    { date: `${year}-05-05`, name: "어린이날" },
    { date: `${year}-06-06`, name: "현충일" },
    ...(year >= CONSTITUTION_DAY_RESTORED_YEAR ? [{ date: `${year}-07-17`, name: "제헌절" }] : []),
    { date: `${year}-08-15`, name: "광복절" },
    { date: `${year}-10-03`, name: "개천절" },
    { date: `${year}-10-09`, name: "한글날" },
    { date: `${year}-12-25`, name: "성탄절" },
  ];
}

export async function getHolidays(year: number): Promise<Holiday[]> {
  const key = String(year);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.holidays;
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`, {
      // Next fetch 캐시와 무관하게 우리 메모리 캐시로 관리한다.
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as NagerHoliday[];
    const fetched = rows
      .map((r) => ({ date: String(r.date), name: String(r.localName || r.name) }))
      // 제헌절은 2008~2025 사이 공휴일이 아니었다(Nager 데이터에 국경일로 섞여 온다).
      // 2026년부터 법정공휴일로 되살아났으므로 그 해부터는 남긴다.
      .filter(
        (h) =>
          /^\d{4}-\d{2}-\d{2}$/.test(h.date) &&
          (!h.name.includes("제헌절") || year >= CONSTITUTION_DAY_RESTORED_YEAR)
      );
    if (fetched.length === 0) throw new Error("empty");
    // 고정일 국경일 병합(대체공휴일만 온 해에 당일을 복원) 후 날짜순 정렬.
    const seen = new Set(fetched.map((h) => h.date));
    const holidays = [...fetched, ...fixedHolidays(year).filter((h) => !seen.has(h.date))].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    cache.set(key, { holidays, fetchedAt: Date.now() });
    return holidays;
  } catch {
    // 실패는 짧게(1h) 캐시해 외부 장애 때 매 요청 재시도를 막는다.
    const holidays = hit?.holidays ?? fixedHolidays(year);
    cache.set(key, { holidays, fetchedAt: Date.now() - TTL_MS + 3600 * 1000 });
    return holidays;
  }
}

const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** 한 해의 공휴일에서 설·추석 연휴 구간을 뽑는다(대체휴일이 이름에 명절을 담고 있으면 함께 묶인다). */
function extractSeasons(holidays: Holiday[]): HolidaySeason[] {
  const out: HolidaySeason[] = [];
  for (const kind of ["seol", "chuseok"] as const) {
    const label = kind === "seol" ? "설" : "추석";
    const dates = holidays
      .filter((h) => h.name.includes(label))
      .map((h) => h.date)
      .sort();
    if (dates.length === 0) continue;
    // 당일 식별: 전날·당일·다음날 3연휴 구성이면 두 번째 날이 당일. 항목이 그보다 적으면 첫날로 근사한다
    // (표시 시작이 하루 이틀 어긋나도 "20일 전부터"라는 규칙의 성격상 무해).
    const day = dates.length >= 3 ? dates[1] : dates[0];
    out.push({ kind, day, start: addDays(day, -20), end: dates[dates.length - 1] });
  }
  return out;
}

/** 시즌 구간 — 요청 연도와 다음 연도의 설까지 함께 준다(12월 말에 이듬해 1월 설의 20일 전 구간이 걸린다). */
export async function getHolidaySeasons(year: number): Promise<HolidaySeason[]> {
  const [cur, next] = await Promise.all([getHolidays(year), getHolidays(year + 1)]);
  return [...extractSeasons(cur), ...extractSeasons(next)];
}
