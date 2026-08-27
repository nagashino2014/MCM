import crypto from "node:crypto";
import { getDb, rowsToObjects, type PgDatabase } from "@/lib/db";
import { CONSENT_VERSION, type OvertimeConsent } from "@/lib/approval/overtime-consent";
import { getAttendanceSettings } from "@/lib/adt/queries";
import { DEFAULT_ATTENDANCE_SETTINGS } from "@/lib/adt/settings";
import { weekStartOf } from "@/lib/adt/overtime";

/*
 * 초과근무 신청(frm-overtime-request) ↔ 근태 연동.
 * ① 기안 화면: 신청 주의 기존 신청·근태 실적을 합산해 주 12h 초과 경고(getWeeklyOvertimeUsage).
 * ② 상신 시: 12h 초과 판정을 field_values._over_limit 로 고정 저장(assessOverLimitOnSubmit)
 *    — 결재 화면이 이 스냅샷으로 경고 배너를 띄운다(나중에 다른 신청이 승인돼도 판정이 흔들리지 않는다).
 * ③ 근태 인제스트 후: 승인된 12h 초과 신청이 있는 주의 실제 초과분(excess_minutes)을
 *    특별휴가(초과근무 대체휴가, 시간 단위)로 자동 적재(syncOvertimeCompForWeeks — ref_key 멱등).
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
      `SELECT d.doc_id, d.field_values->>'apply_hours' AS apply_hours
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
  return rows.reduce((sum, r) => sum + hoursToMin(r.apply_hours), 0);
}

const addDaysYmd = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface WeeklyOvertimeUsage {
  weekStart: string;
  weekEnd: string;
  /** 같은 주의 기존 신청(진행+승인) 합 — 분. */
  requestedMinutes: number;
  /** 근태 실적 연장(인정+초과) — 분. 기록이 없으면 0. */
  attendanceOvertimeMinutes: number;
  limitMinutes: number;
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

  const attRows = rowsToObjects(
    await db.exec(
      `SELECT overtime_minutes, excess_minutes FROM attendance_weekly
        WHERE employee_id = $1 AND week_start = $2`,
      [employeeId, weekStart]
    )
  );
  const attendanceOvertimeMinutes = attRows.length
    ? Number(attRows[0].overtime_minutes ?? 0) + Number(attRows[0].excess_minutes ?? 0)
    : 0;

  return { weekStart, weekEnd, requestedMinutes, attendanceOvertimeMinutes, limitMinutes: settings.weeklyOvertimeLimitMinutes };
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
 * 근태 인제스트 후 — 갱신된 주들에 대해 초과근무 대체휴가(시간)를 자동 적재한다.
 * 조건: 그 주에 최종 승인된 초과근무 신청 합이 주 한도(12h)를 넘겼고, 실제 근태 초과분(excess)이 있을 것.
 * 부여량 = excess_minutes(시간 환산, 소수 1자리). ref_key('ot-<weekStart>') UPSERT 로 재산정에도 멱등,
 * 조건이 사라지면(재업로드로 excess=0 등) 자동 적재분을 회수한다(수기 입력은 건드리지 않는다).
 */
export async function syncOvertimeCompForWeeks(
  db: PgDatabase,
  weeks: Array<{ adtEmpNo: string; weekStart: string }>,
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

  let synced = 0;
  for (const { adtEmpNo, weekStart } of weeks) {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT employee_id, excess_minutes, overtime_minutes, night_minutes
           FROM attendance_weekly WHERE adt_emp_no = $1 AND week_start = $2`,
        [adtEmpNo, weekStart]
      )
    );
    if (!rows.length || rows[0].employee_id == null) continue;
    const employeeId = String(rows[0].employee_id);
    const excessMinutes = Number(rows[0].excess_minutes ?? 0);
    const overtimeMinutes = Number(rows[0].overtime_minutes ?? 0);
    const nightMinutes = Number(rows[0].night_minutes ?? 0);
    const refKey = `ot-${weekStart}`;
    const weekEnd = addDaysYmd(weekStart, 6);

    const approvedMin = await sumRequestedMinutes(db, employeeId, weekStart, weekEnd, { approvedOnly: true });
    const eligible = approvedMin > limitMinutes && excessMinutes > 0;

    if (!eligible) {
      // 조건 미충족 — 이 주의 자동 적재분만 회수(멱등).
      await db.run(
        `DELETE FROM special_leave_ledger
          WHERE employee_id = $1 AND kind = 'overtime_comp' AND ref_key = $2 AND source = 'auto_overtime'`,
        [employeeId, refKey]
      );
      continue;
    }

    // 보상휴가는 임금과 동등해야 하므로 가산율을 반영한다(근로기준법 56·57조, 사규와 동일):
    // 초과분 중 야간 몫 = 주 야간 재실에서 인정연장에 이미 배분된 몫을 뺀 나머지 → 2.0배, 그 외 1.5배.
    const excessNight = Math.min(excessMinutes, Math.max(0, nightMinutes - overtimeMinutes));
    const excessDay = excessMinutes - excessNight;
    const grantMinutes = excessDay * 1.5 + excessNight * 2.0;
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
        `근태 대조 자동 산정 — ${weekStart} 주 12h 초과 ${h1(excessMinutes)}h → 가산 환산 ${hours}h` +
          `(주간 ${h1(excessDay)}h×1.5${excessNight > 0 ? ` + 야간 ${h1(excessNight)}h×2.0` : ""}, 승인 신청 ${h1(approvedMin)}h)`,
        refKey,
        new Date().toISOString(),
      ]
    );
    synced += 1;
  }
  return synced;
}
