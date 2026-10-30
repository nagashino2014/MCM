import crypto from "node:crypto";
import { getDb, rowsToObjects, type PgDatabase } from "@/lib/db";
import { parseTimeRange, timeRangeMinutes } from "@/lib/approval/fields";
import { DEFAULT_WORK_SCHEDULE_KIND, WORK_SCHEDULE_KINDS } from "@/lib/adt/types";
import { CONSENT_VERSION, type OvertimeConsent } from "@/lib/approval/overtime-consent";
import { getAttendanceSettings } from "@/lib/adt/queries";
import { DEFAULT_ATTENDANCE_SETTINGS } from "@/lib/adt/settings";
import { weekStartOf } from "@/lib/adt/overtime";
import { getOvertimeRates, weeklyOvertimeExcess, type OvertimeMatchRow } from "@/lib/payroll/overtime";

/*
 * 초과근무 신청(frm-overtime-request) ↔ 근태 연동.
 * ① 기안 화면: 신청 주의 기존 신청·근태 실적을 합산해 주 12h 초과 경고(getWeeklyOvertimeUsage).
 * ② 상신 시: 12h 초과 판정을 field_values._over_limit 로 고정 저장(assessOverLimitOnSubmit)
 *    — 결재 화면이 이 스냅샷으로 경고 배너를 띄운다(나중에 다른 신청이 승인돼도 판정이 흔들리지 않는다).
 * ③ 근태 인제스트·급여대장 생성 시: 주 연장 한도(12h)를 넘어 급여 수당에서 빠진 인정 시간을
 *    특별휴가(초과근무 대체휴가, 시간 단위)로 자동 적재(syncOvertimeCompForWeeks — ref_key 멱등).
 *    수당과 같은 대조·배분(lib/payroll/overtime.ts weeklyOvertimeExcess)을 써서 이중 산정이 없다(F-21).
 */

export const OVERTIME_FORM_ID = "frm-overtime-request";

/** 상신 시 field_values 에 고정 저장되는 12h 초과 판정 스냅샷. */
export interface OverLimitSnapshot {
  weekStart: string;
  /** 같은 주의 기존 신청(진행+승인) 합 — 분. */
  priorRequestedMinutes: number;
  /** 이 문서의 신청 시간 — 분. */
  applyMinutes: number;
  /** 근태 실적 연장(참고) — 분. */
  attendanceOvertimeMinutes: number;
  limitMinutes: number;
  /** 기안자 동의(전자서명) 이력 — 12h 초과 상신의 필수 요건. */
  consent: { version: string; agreedAt: string; signerName: string };
}

const hoursToMin = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 60) : 0;
};

/** 주(weekStart~+6일)와 겹치는 본인 초과근무 신청서(진행+승인)의 신청시간 합(분). */
async function sumRequestedMinutes(
  db: PgDatabase,
  employeeId: string,
  weekStart: string,
  weekEnd: string,
  opts: { excludeDocId?: string | null; approvedOnly?: boolean } = {}
): Promise<number> {
  const status = opts.approvedOnly ? `d.status = 'approved'` : `d.status IN ('in_progress','approved')`;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.field_values->>'apply_hours' AS apply_hours, d.field_values->'work_time' AS work_time
         FROM approval_docs d
        WHERE d.form_id = $1 AND ${status}
          AND d.drafter_employee_id = $2
          AND ($5::text IS NULL OR d.doc_id <> $5)
          AND (d.field_values->'work_period'->>'from') <= $4
          AND COALESCE(NULLIF(d.field_values->'work_period'->>'to',''),
                       d.field_values->'work_period'->>'from') >= $3`,
      [OVERTIME_FORM_ID, employeeId, weekStart, weekEnd, opts.excludeDocId ?? null]
    )
  );
  // 신청시간(apply_hours)이 비어 있는 문서는 근무 시간대(work_time)로 대신 센다 — 빈 값이 0h 로 빠지지 않게.
  return rows.reduce((sum, r) => sum + (hoursToMin(r.apply_hours) || timeRangeMinutes(r.work_time) || 0), 0);
}

const addDaysYmd = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** 같은 근무일의 기존 신청 1건(추가 신청 연동·겹침 검사용). */
export interface SameDayRequest {
  docId: string;
  docNo: string | null;
  start: string | null; // 'HH:MM'
  end: string | null;
  applyMinutes: number;
}

/**
 * 같은 근무일(date)과 겹치는 본인 초과근무 신청(진행+승인) — 상신 순.
 * 업무 특성상 예정보다 길어진 근무를 같은 날 **추가 신청**으로 허용하므로(2026-08-28 확정),
 * 상신 시 이 목록으로 ①시간대 겹침(이중 인정)을 막고 ②원 신청에 ref_doc_id 로 자동 연동한다.
 */
export async function listSameDayRequests(
  db: PgDatabase,
  employeeId: string,
  date: string,
  excludeDocId?: string | null
): Promise<SameDayRequest[]> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.doc_no, d.field_values->'work_time' AS work_time,
              d.field_values->>'apply_hours' AS apply_hours
         FROM approval_docs d
        WHERE d.form_id = $1 AND d.status IN ('in_progress','approved')
          AND d.drafter_employee_id = $2
          AND ($4::text IS NULL OR d.doc_id <> $4)
          AND (d.field_values->'work_period'->>'from') <= $3
          AND COALESCE(NULLIF(d.field_values->'work_period'->>'to',''),
                       d.field_values->'work_period'->>'from') >= $3
        ORDER BY d.submitted_at NULLS LAST, d.created_at`,
      [OVERTIME_FORM_ID, employeeId, date, excludeDocId ?? null]
    )
  );
  return rows.map((r) => {
    const t = parseTimeRange(r.work_time);
    return {
      docId: String(r.doc_id),
      docNo: r.doc_no != null ? String(r.doc_no) : null,
      start: t.start || null,
      end: t.end || null,
      applyMinutes: hoursToMin(r.apply_hours),
    };
  });
}

/** 'HH:MM' 두 구간의 겹침 여부 — 종료가 시작보다 이르면 자정 넘김(+1일)으로 본다. */
export function timeRangesOverlap(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
  const span = (r: { start: string; end: string }): [number, number] => {
    const s = toMin(r.start);
    let e = toMin(r.end);
    if (e <= s) e += 1440;
    return [s, e];
  };
  const [aS, aE] = span(a);
  const [bS, bE] = span(b);
  return aS < bE && bS < aE;
}

export interface WeeklyOvertimeUsage {
  weekStart: string;
  weekEnd: string;
  /** 같은 주의 기존 신청(진행+승인) 합 — 분. */
  requestedMinutes: number;
  /** 근태 실적 연장(인정+초과) — 분. 기록이 없으면 0. */
  attendanceOvertimeMinutes: number;
  limitMinutes: number;
  /** 같은 근무일의 기존 신청 — 추가 신청 안내(자동 연동·겹침 불가) 표시용. */
  sameDay: SameDayRequest[];
  /**
   * 기안자의 출퇴근 유형 — 평일 초과근무는 소정 종료(endHhmm)부터 인정된다(급여 대조 matchOvertimeRequests 와 같은 기준).
   * 미설정이면 기본 유형(8시 출근)이고 isDefault=true.
   */
  schedule: { label: string; startHhmm: string; endHhmm: string; isDefault: boolean };
}

/** 기안 화면용 — 사용자의 해당 주 초과근무 사용량(기존 신청 합 + 근태 실적). */
export async function getWeeklyOvertimeUsage(
  userId: string,
  date: string,
  excludeDocId?: string | null
): Promise<WeeklyOvertimeUsage | null> {
  const db = await getDb();
  let settings = DEFAULT_ATTENDANCE_SETTINGS;
  try {
    settings = await getAttendanceSettings();
  } catch {
    /* 설정 조회 실패 시 사규 기본값 */
  }
  const weekStart = weekStartOf(date, settings.weekStartDow);
  if (!weekStart) return null;
  const weekEnd = addDaysYmd(weekStart, 6);

  const empRows = rowsToObjects(
    await db.exec(`SELECT employee_id FROM users WHERE user_id = $1`, [userId])
  );
  const employeeId = empRows.length && empRows[0].employee_id != null ? String(empRows[0].employee_id) : null;
  if (!employeeId) return null;

  const requestedMinutes = await sumRequestedMinutes(db, employeeId, weekStart, weekEnd, { excludeDocId });

  // 단말 번호가 둘인 직원(본사+울산)은 주간 행이 2개다 — 정렬 없이 첫 행을 쓰면 빈 행이 잡힐 수 있어 큰 값을 쓴다.
  const attRows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(MAX(COALESCE(overtime_minutes, 0) + COALESCE(excess_minutes, 0)), 0) AS minutes
         FROM attendance_weekly
        WHERE employee_id = $1 AND week_start = $2`,
      [employeeId, weekStart]
    )
  );
  const attendanceOvertimeMinutes = Number(attRows[0]?.minutes ?? 0);
  const sameDay = await listSameDayRequests(db, employeeId, date, excludeDocId);
  const schedule = await loadMySchedule(db, employeeId);

  return {
    weekStart,
    weekEnd,
    requestedMinutes,
    attendanceOvertimeMinutes,
    limitMinutes: settings.weeklyOvertimeLimitMinutes,
    sameDay,
    schedule,
  };
}

const fmtHhmm = (v: string): string => {
  const s = String(v).replace(/\D/g, "").padStart(4, "0");
  return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
};

/** 기안자 출퇴근 유형(마이그 167) — 미설정·조회 실패 시 기본 유형. */
async function loadMySchedule(db: PgDatabase, employeeId: string): Promise<WeeklyOvertimeUsage["schedule"]> {
  const preset = (kind: string) => WORK_SCHEDULE_KINDS.find((k) => k.kind === kind);
  try {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT schedule_kind, start_hhmm, end_hhmm FROM attendance_work_schedules WHERE employee_id = $1`,
        [employeeId]
      )
    );
    if (rows.length) {
      const r = rows[0];
      return {
        label: preset(String(r.schedule_kind))?.label ?? String(r.schedule_kind),
        startHhmm: fmtHhmm(String(r.start_hhmm)),
        endHhmm: fmtHhmm(String(r.end_hhmm)),
        isDefault: false,
      };
    }
  } catch {
    /* 167 미적용 등 — 기본 유형으로 안내 */
  }
  const d = preset(DEFAULT_WORK_SCHEDULE_KIND)!;
  return { label: d.label, startHhmm: fmtHhmm(d.startHhmm), endHhmm: fmtHhmm(d.endHhmm), isDefault: true };
}

/**
 * 상신 시 12h 초과 판정을 field_values 에 고정 저장(submitDoc 트랜잭션 내부).
 * 초과가 아니면 기존 스냅샷을 지운다(수정 후 재상신 대응).
 */
export async function assessOverLimitOnSubmit(txn: PgDatabase, docId: string): Promise<void> {
  const rows = rowsToObjects(
    await txn.exec(
      `SELECT form_id, drafter_employee_id, field_values FROM approval_docs WHERE doc_id = $1`,
      [docId]
    )
  );
  if (!rows.length || String(rows[0].form_id) !== OVERTIME_FORM_ID) return;
  const employeeId = rows[0].drafter_employee_id != null ? String(rows[0].drafter_employee_id) : null;
  let fv: Record<string, unknown> = {};
  try {
    const v = typeof rows[0].field_values === "string" ? JSON.parse(rows[0].field_values) : rows[0].field_values;
    if (v && typeof v === "object") fv = v as Record<string, unknown>;
  } catch {
    return;
  }
  const period = (fv.work_period ?? {}) as { from?: string; to?: string };
  const from = period.from;
  if (!employeeId || !from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return;
  // 초과근무 신청은 1일 1건(2026-08-27 확정) — 일자별 대조(matchOvertimeRequests)가 근무일
  // 하루를 전제하므로 기간(from≠to) 신청은 상신 단계에서 막는다. 여러 날은 날짜별로 나눠 상신.
  const to = period.to;
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to) && to !== from) {
    throw new Error("초과근무 신청은 1일 1건입니다 — 근무일을 하루씩 나눠 상신해 주세요.");
  }

  // 같은 날 추가 신청(예정보다 길어진 근무, 2026-08-28 확정) — 허용하되:
  // ① 기존 신청과 시간대가 겹치면 같은 재실 구간이 이중 인정되므로 상신을 막는다.
  // ② 원 신청(그 날 최초 상신 건)에 ref_doc_id 로 자동 연동해 "같은 용역·같은 날의
  //    연속 초과근무"로 묶는다(결재 화면 선행 문서 표시, 마이그 127). 수동 지정은 유지.
  const sameDay = await listSameDayRequests(txn, employeeId, from, docId);
  if (sameDay.length) {
    const mine = parseTimeRange(fv.work_time);
    if (mine.start && mine.end) {
      const clash = sameDay.find(
        (r) => r.start && r.end && timeRangesOverlap({ start: mine.start!, end: mine.end! }, { start: r.start, end: r.end })
      );
      if (clash) {
        throw new Error(
          `같은 날 기존 신청(${clash.docNo ? `${clash.docNo} · ` : ""}${clash.start}~${clash.end})과 시간대가 겹칩니다 — ` +
            `기존 근무 이후 시간대로 신청해 주세요.`
        );
      }
    }
    const refRows = rowsToObjects(
      await txn.exec(`SELECT ref_doc_id FROM approval_docs WHERE doc_id = $1`, [docId])
    );
    if (!refRows.length || refRows[0].ref_doc_id == null || String(refRows[0].ref_doc_id) === "") {
      await txn.run(`UPDATE approval_docs SET ref_doc_id = $2 WHERE doc_id = $1`, [docId, sameDay[0].docId]);
    }
  }

  let settings = DEFAULT_ATTENDANCE_SETTINGS;
  try {
    settings = await getAttendanceSettings();
  } catch {
    /* 사규 기본값 */
  }
  const weekStart = weekStartOf(from, settings.weekStartDow);
  const weekEnd = addDaysYmd(weekStart, 6);
  const applyMinutes = hoursToMin(fv.apply_hours);
  const prior = await sumRequestedMinutes(txn, employeeId, weekStart, weekEnd, { excludeDocId: docId });
  const attRows = rowsToObjects(
    await txn.exec(
      `SELECT overtime_minutes, excess_minutes FROM attendance_weekly WHERE employee_id = $1 AND week_start = $2`,
      [employeeId, weekStart]
    )
  );
  const attendanceOvertimeMinutes = attRows.length
    ? Number(attRows[0].overtime_minutes ?? 0) + Number(attRows[0].excess_minutes ?? 0)
    : 0;

  const over = prior + applyMinutes > settings.weeklyOvertimeLimitMinutes;
  const next = { ...fv };
  if (over) {
    // 12h 초과 상신은 기안자의 특별휴가 전환 동의(전자서명)가 필수 — 동의 없이는 상신을 막는다.
    // 주가 바뀐 재상신(기간 수정)은 고지 내용이 달라지므로 재동의를 요구한다.
    const consent = fv._overtime_consent as OvertimeConsent | undefined;
    if (!consent || typeof consent !== "object" || !consent.agreedAt || consent.weekStart !== weekStart) {
      throw new Error("주 12시간 초과 신청입니다 — 특별휴가 전환 동의(전자서명) 후 상신할 수 있습니다.");
    }
    const snapshot: OverLimitSnapshot = {
      weekStart,
      priorRequestedMinutes: prior,
      applyMinutes,
      attendanceOvertimeMinutes,
      limitMinutes: settings.weeklyOvertimeLimitMinutes,
      consent: { version: consent.version || CONSENT_VERSION, agreedAt: consent.agreedAt, signerName: consent.signerName ?? "" },
    };
    next._over_limit = snapshot;
  } else {
    delete next._over_limit;
  }
  await txn.run(`UPDATE approval_docs SET field_values = $2::jsonb WHERE doc_id = $1`, [docId, JSON.stringify(next)]);
}

/**
 * 근태 인제스트 후 — 갱신된 주들에 대해 초과근무 대체휴가(시간)를 자동 적재한다(근태 단말 사번 기준 래퍼).
 */
export async function syncOvertimeCompForWeeks(
  db: PgDatabase,
  weeks: Array<{ adtEmpNo: string; weekStart: string }>,
  limitMinutes: number
): Promise<number> {
  const items: Array<{ employeeId: string; weekStart: string }> = [];
  for (const { adtEmpNo, weekStart } of weeks) {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT employee_id FROM attendance_weekly WHERE adt_emp_no = $1 AND week_start = $2`,
        [adtEmpNo, weekStart]
      )
    );
    if (rows.length && rows[0].employee_id != null) items.push({ employeeId: String(rows[0].employee_id), weekStart });
  }
  return syncOvertimeCompForEmployeeWeeks(db, items, limitMinutes);
}

/**
 * 직원·주별 초과근무 대체휴가 자동 적재(F-21, 2026-10-20 사용자 확정).
 * 부여량 = 그 주 인정 초과근무를 시간순으로 쌓아 한도(12h)를 넘긴 몫 — 급여 수당에서 빠진 바로 그 시간 —
 * 에 가산율(연장·야간 배수, 근태 설정)을 곱한 시간(소수 1자리). 급여는 한도까지만 수당을 준다.
 * ref_key('ot-<weekStart>') UPSERT 로 재산정에도 멱등, 초과분이 사라지면 자동 적재분을 회수한다(수기 입력은 건드리지 않는다).
 */
export async function syncOvertimeCompForEmployeeWeeks(
  db: PgDatabase,
  weeks: Array<{ employeeId: string; weekStart: string }>,
  limitMinutes: number
): Promise<number> {
  // 특별휴가 원장(133)+단위 확장(134) 미적용 환경이면 조용히 건너뛴다
  // (인제스트 트랜잭션 내부에서 SQL 에러를 내면 전체 롤백되므로 사전 확인).
  const schema = rowsToObjects(
    await db.exec(
      `SELECT count(*) AS c FROM information_schema.columns
        WHERE table_name = 'special_leave_ledger' AND column_name = 'ref_key'`
    )
  );
  if (Number(schema[0]?.c ?? 0) === 0) return 0;

  const rates = await getOvertimeRates(db);
  const cache = new Map<string, Promise<OvertimeMatchRow[]>>();
  let synced = 0;
  for (const { employeeId, weekStart } of weeks) {
    const refKey = `ot-${weekStart}`;
    const { recognizedMin, excessDayMin, excessNightMin } = await weeklyOvertimeExcess(
      db,
      employeeId,
      weekStart,
      limitMinutes,
      cache
    );
    const excessMinutes = excessDayMin + excessNightMin;

    if (excessMinutes <= 0) {
      // 조건 미충족 — 이 주의 자동 적재분만 회수(멱등).
      await db.run(
        `DELETE FROM special_leave_ledger
          WHERE employee_id = $1 AND kind = 'overtime_comp' AND ref_key = $2 AND source = 'auto_overtime'`,
        [employeeId, refKey]
      );
      continue;
    }

    // 보상휴가는 임금과 동등해야 하므로 수당과 같은 가산율을 반영한다(근로기준법 56·57조, 사규와 동일).
    const grantMinutes = excessDayMin * rates.rateDay + excessNightMin * rates.rateNight;
    const h1 = (min: number) => Math.round((min / 60) * 10) / 10;
    const hours = h1(grantMinutes);

    await db.run(
      `INSERT INTO special_leave_ledger
         (entry_id, employee_id, kind, entry_type, days, unit, effective_on, note, source, ref_key, created_at)
       VALUES ($1, $2, 'overtime_comp', 'grant', $3, 'hour', $4, $5, 'auto_overtime', $6, $7)
       ON CONFLICT (employee_id, kind, ref_key) WHERE ref_key IS NOT NULL
       DO UPDATE SET days = EXCLUDED.days, note = EXCLUDED.note, effective_on = EXCLUDED.effective_on`,
      [
        "slv-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14),
        employeeId,
        hours,
        weekStart,
        `근태 대조 자동 산정 — ${weekStart} 주 인정 ${h1(recognizedMin)}h 중 ${h1(limitMinutes)}h 초과 ${h1(excessMinutes)}h(수당 제외) → 가산 환산 ${hours}h` +
          `(주간 ${h1(excessDayMin)}h×${rates.rateDay}${excessNightMin > 0 ? ` + 야간 ${h1(excessNightMin)}h×${rates.rateNight}` : ""})`,
        refKey,
        new Date().toISOString(),
      ]
    );
    synced += 1;
  }
  return synced;
}
