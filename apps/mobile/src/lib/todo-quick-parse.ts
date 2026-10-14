/*
 * 원본 frontend/lib/todo/quick-parse.ts — 동기화 유지(순수 TS, 서버와 같은 규칙으로 퀵애드 토큰을 해석한다).
 * ⚠ 여기만 고치지 말 것 — 원본을 고친 뒤 이 파일로 다시 복제한다.
 */
/*
 * 퀵애드 한 줄 파서(한국어) — 순수 TS, DB·Next 의존 없음(모바일 앱이 그대로 복제해 쓴다).
 * 설계: docs/todo-kanban-blueprint.md §7.4.
 *
 *   "내일 오후 3시 ○○사 미팅 !높음 #영업 @홍길동 10/30까지 //자료 준비"
 *   → title "○○사 미팅", doDate 내일, doTime 15:00, priority 3, boardToken "영업", assigneeToken "홍길동",
 *     dueDate 10-30, note "자료 준비"
 *
 * 규칙
 * - 인식 토큰은 원문 기준 [start, end) 범위로 돌려준다 — 화면이 칩·하이라이트를 그리고, 칩 × 로 해제하면 그 텍스트는
 *   제목에 남긴다(해제는 클라이언트 몫: 해당 토큰을 뺀 채 다시 조립).
 * - 날짜는 입력일(opts.today) 기준. 지난 시각·지난 요일이라도 다음 날/다음 주로 넘기지 않는다(명시 입력 존중).
 *   단 "21일"처럼 일(日)만 적으면 이번 달의 그 날이 지났을 때 다음 달로 본다.
 * - 오전/오후 없는 "N시"는 1~6시를 오후로 본다(사무 시간 관례), 7~12시는 그대로.
 * - IME 조합 중 호출 금지(compositionend 뒤 호출)는 클라이언트 책임.
 */

export type QuickTokenKind =
  | "do_date"
  | "do_time"
  | "due_date"
  | "recurrence"
  | "priority"
  | "board"
  | "assignee"
  | "note";

export interface QuickToken {
  kind: QuickTokenKind;
  /** 원문에서 인식한 텍스트 */
  text: string;
  start: number;
  end: number;
  /** 정규화 값(날짜 YYYY-MM-DD · 시간 HH:mm · 규칙 문자열 · 우선순위 숫자 문자열 등) */
  value: string;
}

export interface QuickParseResult {
  title: string;
  doDate: string | null;
  doTime: string | null;
  dueDate: string | null;
  recurrence: string | null;
  priority: 0 | 1 | 2 | 3 | null;
  boardToken: string | null;
  assigneeToken: string | null;
  note: string | null;
  tokens: QuickToken[];
}

export interface QuickParseOptions {
  /** 기준일 YYYY-MM-DD(클라이언트 로컬 날짜) */
  today: string;
  /** 주 시작 요일(1=월, 0=일). 기본 월. */
  weekStart?: 0 | 1;
}

// ── 날짜 유틸(UTC 정오 기준으로 계산해 DST·시간대 영향 제거) ──
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (ymd: string): Date => new Date(`${ymd}T12:00:00Z`);
const toYmd = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (ymd: string, n: number): string => {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return toYmd(d);
};
const pad2 = (n: number): string => String(n).padStart(2, "0");
const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 요일 인덱스: 월=0 … 일=6 */
const WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"];
const WEEKDAY_CODE = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const weekdayIndex = (ymd: string): number => (toDate(ymd).getUTCDay() + 6) % 7;

// ── 토큰 패턴 ──
const WD = "[월화수목금토일]";
/** 날짜 표현(캡처 없음) — due·do 공용. 긴 표현부터. */
const DATE_EXPR =
  "(?:다다음\\s*주\\s*" + WD + "(?:요일)?" +
  "|다음\\s*주\\s*" + WD + "(?:요일)?" +
  "|이번\\s*주\\s*" + WD + "(?:요일)?" +
  "|\\d{1,2}\\s*(?:일|주)\\s*(?:뒤|후)" +
  "|\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일" +
  "|\\d{1,2}/\\d{1,2}" +
  "|오늘|내일|모레|글피" +
  "|" + WD + "요일" +
  "|\\d{1,2}\\s*일(?![\\s]*(?:뒤|후)))";

const BOUND_R = "(?![^\\s,.])"; // 뒤가 공백·쉼표·마침표 또는 끝

function resolveDateExpr(expr: string, today: string, weekStart: 0 | 1): string | null {
  const s = expr.replace(/\s+/g, "");
  if (s === "오늘") return today;
  if (s === "내일") return addDays(today, 1);
  if (s === "모레") return addDays(today, 2);
  if (s === "글피") return addDays(today, 3);

  let m = /^(이번|다음|다다음)주([월화수목금토일])(?:요일)?$/.exec(s);
  if (m) {
    const offsetWeeks = m[1] === "이번" ? 0 : m[1] === "다음" ? 1 : 2;
    const target = WEEKDAY_KO.indexOf(m[2]);
    // 주 시작: 월(기본) 또는 일. 일요일 시작이면 인덱스를 일=0 … 토=6 으로 재배치.
    const todayIdx = weekdayIndex(today); // 월=0
    const startIdx = weekStart === 1 ? todayIdx : (todayIdx + 1) % 7; // 일=0 기준
    const targetIdx = weekStart === 1 ? target : (target + 1) % 7;
    const weekHead = addDays(today, -startIdx);
    return addDays(weekHead, offsetWeeks * 7 + targetIdx);
  }

  m = /^([월화수목금토일])요일$/.exec(s);
  if (m) {
    const target = WEEKDAY_KO.indexOf(m[1]);
    const diff = (target - weekdayIndex(today) + 7) % 7; // 오늘이면 0
    return addDays(today, diff);
  }

  m = /^(\d{1,2})(일|주)(?:뒤|후)$/.exec(s);
  if (m) return addDays(today, Number(m[1]) * (m[2] === "주" ? 7 : 1));

  m = /^(\d{1,2})월(\d{1,2})일$/.exec(s) ?? /^(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1) return null;
    const year = Number(today.slice(0, 4));
    if (day > daysInMonth(year, month)) return null;
    // 지난 날짜도 그대로(명시 존중) — 해가 바뀌는 보정은 하지 않는다.
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  m = /^(\d{1,2})일$/.exec(s);
  if (m) {
    const day = Number(m[1]);
    if (day < 1 || day > 31) return null;
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const todayDay = Number(today.slice(8, 10));
    let y = year;
    let mo = month;
    if (day < todayDay) {
      mo += 1;
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
    }
    if (day > daysInMonth(y, mo)) return null;
    return `${y}-${pad2(mo)}-${pad2(day)}`;
  }
  return null;
}

function resolveTime(meridiem: string | undefined, hourRaw: string, minuteRaw: string | undefined, half: boolean, explicitHm: boolean): string | null {
  let hour = Number(hourRaw);
  const minute = half ? 30 : minuteRaw ? Number(minuteRaw) : 0;
  if (!Number.isFinite(hour) || hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  const pm = meridiem === "오후" || meridiem === "저녁" || meridiem === "밤";
  const am = meridiem === "오전" || meridiem === "새벽" || meridiem === "아침";
  if (pm) {
    if (hour < 12) hour += 12;
  } else if (am) {
    if (hour === 12) hour = 0;
  } else if (!explicitHm && hour >= 1 && hour <= 6) {
    hour += 12; // "3시" → 15:00(사무 시간 관례)
  }
  if (hour === 24) hour = 0;
  if (hour > 23) return null;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function recurrenceFrom(text: string, doDateHint: string | null, today: string): string | null {
  const s = text.replace(/\s+/g, "");
  if (s === "매일") return "daily";
  if (s === "평일" || s === "매주평일") return "weekdays";
  let m = /^매주((?:[월화수목금토일](?:요일)?[·,/]?)+)$/.exec(s);
  if (m) {
    const days: string[] = [];
    for (const ch of m[1].replace(/요일/g, "")) {
      const i = WEEKDAY_KO.indexOf(ch);
      if (i >= 0 && !days.includes(WEEKDAY_CODE[i])) days.push(WEEKDAY_CODE[i]);
    }
    days.sort((a, b) => WEEKDAY_CODE.indexOf(a) - WEEKDAY_CODE.indexOf(b));
    return days.length ? `weekly:${days.join(",")}` : null;
  }
  if (s === "매주") {
    const base = doDateHint ?? today;
    return `weekly:${WEEKDAY_CODE[weekdayIndex(base)]}`;
  }
  if (s === "매월말일" || s === "매달말일") return "monthly:last";
  m = /^매(?:월|달)(\d{1,2})일$/.exec(s);
  if (m) {
    const d = Number(m[1]);
    return d >= 1 && d <= 31 ? `monthly:${d}` : null;
  }
  m = /^매년(\d{1,2})월(\d{1,2})일$/.exec(s);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `yearly:${pad2(mo)}-${pad2(d)}` : null;
  }
  m = /^완료후(\d{1,3})일$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 ? `after:${n}` : null;
  }
  return null;
}

// ── 본체 ──
export function parseQuickAdd(input: string, opts: QuickParseOptions): QuickParseResult {
  const text = String(input ?? "");
  const today = DATE_RE.test(opts.today) ? opts.today : new Date().toISOString().slice(0, 10);
  const weekStart: 0 | 1 = opts.weekStart === 0 ? 0 : 1;
  const tokens: QuickToken[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  const take = (kind: QuickTokenKind, start: number, end: number, value: string) => {
    tokens.push({ kind, text: text.slice(start, end), start, end, value });
    taken.push([start, end]);
  };

  const result: QuickParseResult = {
    title: "",
    doDate: null,
    doTime: null,
    dueDate: null,
    recurrence: null,
    priority: null,
    boardToken: null,
    assigneeToken: null,
    note: null,
    tokens,
  };

  // 1) //메모 — 첫 "//" 부터 끝까지
  {
    const i = text.indexOf("//");
    if (i >= 0) {
      const note = text.slice(i + 2).trim();
      take("note", i, text.length, note);
      result.note = note || null;
    }
  }

  // 2) #보드  3) @이름  4) !우선순위
  const scan = (re: RegExp, fn: (m: RegExpExecArray, start: number, end: number) => void) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const start = m.index + (m[1]?.length ?? 0);
      const end = m.index + m[0].length;
      if (end <= start) {
        re.lastIndex++;
        continue;
      }
      if (!overlaps(start, end)) fn(m, start, end);
    }
  };
  scan(/(^|\s)#([^\s#@!/]+)/g, (m, s, e) => {
    if (result.boardToken) return;
    result.boardToken = m[2];
    take("board", s, e, m[2]);
  });
  scan(/(^|\s)@([^\s#@!/]+)/g, (m, s, e) => {
    if (result.assigneeToken) return;
    result.assigneeToken = m[2];
    take("assignee", s, e, m[2]);
  });
  scan(/(^|\s)!(높음|보통|낮음|[123])(?=\s|$|[,.])/g, (m, s, e) => {
    if (result.priority != null) return;
    const v = m[2];
    const p: 1 | 2 | 3 = v === "높음" || v === "3" ? 3 : v === "보통" || v === "2" ? 2 : 1;
    result.priority = p;
    take("priority", s, e, String(p));
  });

  // 5) 반복 — 날짜보다 먼저(“매월 15일”·“완료 후 7일”이 날짜로 잡히지 않게)
  scan(
    new RegExp(
      "(^|\\s)(매일|평일|매주\\s*평일|매주(?:\\s*[월화수목금토일](?:요일)?[·,/]?)*|매(?:월|달)\\s*말일|매(?:월|달)\\s*\\d{1,2}\\s*일|매년\\s*\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일|완료\\s*후\\s*\\d{1,3}\\s*일)" +
        BOUND_R,
      "g"
    ),
    (m, s, e) => {
      if (result.recurrence) return;
      const rule = recurrenceFrom(m[2], null, today);
      if (!rule) return;
      result.recurrence = rule;
      take("recurrence", s, e, rule);
    }
  );

  // 6) 마감 — "<날짜>까지" / "~<날짜>까지" / "마감 <날짜>"
  scan(new RegExp("(^|\\s)(~?\\s*" + DATE_EXPR + "\\s*까지)" + BOUND_R, "g"), (m, s, e) => {
    if (result.dueDate) return;
    const expr = m[2].replace(/^~\s*/, "").replace(/\s*까지$/, "");
    const d = resolveDateExpr(expr, today, weekStart);
    if (!d) return;
    result.dueDate = d;
    take("due_date", s, e, d);
  });
  scan(new RegExp("(^|\\s)(마감\\s*" + DATE_EXPR + ")" + BOUND_R, "g"), (m, s, e) => {
    if (result.dueDate) return;
    const d = resolveDateExpr(m[2].replace(/^마감\s*/, ""), today, weekStart);
    if (!d) return;
    result.dueDate = d;
    take("due_date", s, e, d);
  });

  // 7) 할 날짜 — 남은 첫 날짜 표현
  scan(new RegExp("(^|\\s)(" + DATE_EXPR + ")" + BOUND_R, "g"), (m, s, e) => {
    if (result.doDate) return;
    const d = resolveDateExpr(m[2], today, weekStart);
    if (!d) return;
    result.doDate = d;
    take("do_date", s, e, d);
  });
  // "매주"만 적고 요일이 없으면 할 날짜(없으면 오늘)의 요일을 따른다.
  if (result.recurrence === "weekly:" + WEEKDAY_CODE[weekdayIndex(today)] && result.doDate) {
    const tok = tokens.find((t) => t.kind === "recurrence");
    if (tok && tok.text.replace(/\s+/g, "") === "매주") {
      const rule = recurrenceFrom("매주", result.doDate, today);
      if (rule) {
        result.recurrence = rule;
        tok.value = rule;
      }
    }
  }

  // 8) 시각 — "오후 3시", "15:00", "15시 반", "오전 9시 10분"
  scan(
    /(^|\s)((오전|오후|저녁|밤|새벽|아침)?\s*(\d{1,2})\s*시(?:\s*(반|(\d{1,2})\s*분))?)(?=\s|$|[,.])/g,
    (m, s, e) => {
      if (result.doTime) return;
      const t = resolveTime(m[3], m[4], m[6], m[5] === "반", false);
      if (!t) return;
      result.doTime = t;
      take("do_time", s, e, t);
    }
  );
  scan(/(^|\s)((오전|오후|저녁|밤|새벽|아침)?\s*(\d{1,2}):(\d{2}))(?=\s|$|[,.])/g, (m, s, e) => {
    if (result.doTime) return;
    const t = resolveTime(m[3], m[4], m[5], false, true);
    if (!t) return;
    result.doTime = t;
    take("do_time", s, e, t);
  });

  // 시각만 있고 날짜가 없으면 오늘(명시 시각 존중, 다음 날로 넘기지 않음)
  if (result.doTime && !result.doDate) result.doDate = today;

  // 9) 제목 = 토큰을 뺀 나머지
  tokens.sort((a, b) => a.start - b.start);
  let title = "";
  let cursor = 0;
  for (const t of tokens) {
    title += text.slice(cursor, t.start) + " ";
    cursor = t.end;
  }
  title += text.slice(cursor);
  result.title = title
    .replace(/\s+/g, " ")
    .replace(/^[\s~,.·-]+|[\s~,.·-]+$/g, "")
    .trim();
  return result;
}
