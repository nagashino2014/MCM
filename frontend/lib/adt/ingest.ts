/**
 * ADT 근태 인제스트 파이프라인(서버 전용).
 * 스테이징(adt_attendance_raw, processed=false) → 일별 정규화(attendance_daily)
 *   → 영향 주(attendance_weekly) 재산정 → 스테이징 processed=true.
 * 멱등: 자연키 upsert + 주 단위 전체 재계산이라 재실행/중복 전송에 안전.
 */

import { PgDatabase, rowsToObjects, withDbWrite } from "@/lib/db";
import type { AdtRawRecord, AttendanceSettings } from "./types";
import { loadAttendanceSettings } from "./settings";
import { computeDaily, computeWeekly, weekStartOf, ymd8ToDate, type WeeklyDailyInput } from "./overtime";
import { AttendanceSource, DbStagingSource, FileSource, S3Source, type CollectResult } from "./source";

export interface IngestResult {
  collected: number; // 소스가 스테이징에 수렴시킨 건수(파일 등)
  processedRaw: number; // 이번에 정규화한 스테이징 행 수
  dailyUpserts: number;
  weeksRecomputed: number;
  matched: number; // 직원 매핑 성공 행 수
  unmatched: number; // 미매칭 행 수(리포트 대상)
  collectErrors?: string[];
}

interface EmpMatch {
  employeeId: string;
  name: string | null;
}

/** e_idno 목록 → 직원 매핑(adt_emp_no 우선, 없으면 employee_no fallback). */
async function loadEmpMap(db: PgDatabase, eidnos: string[]): Promise<Map<string, EmpMatch>> {
  const map = new Map<string, EmpMatch>();
  if (!eidnos.length) return map;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT employee_id, employee_no, adt_emp_no, name
         FROM employee_profiles
        WHERE adt_emp_no = ANY($1::text[]) OR employee_no = ANY($1::text[])`,
      [eidnos]
    )
  );
  // adt_emp_no 매핑을 우선 등록, employee_no fallback 은 비어있을 때만.
  for (const r of rows) {
    const adt = r.adt_emp_no != null ? String(r.adt_emp_no) : "";
    if (adt) map.set(adt, { employeeId: String(r.employee_id), name: r.name != null ? String(r.name) : null });
  }
  for (const r of rows) {
    const no = r.employee_no != null ? String(r.employee_no) : "";
    if (no && !map.has(no)) map.set(no, { employeeId: String(r.employee_id), name: r.name != null ? String(r.name) : null });
  }
  return map;
}

/** (employee_id, work_date) 휴가일 집합 — annual_leave_ledger 의 use 엔트리(used_on). */
async function loadLeaveDays(db: PgDatabase, empIds: string[], dates: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (!empIds.length || !dates.length) return set;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT employee_id, used_on
         FROM annual_leave_ledger
        WHERE used_on IS NOT NULL
          AND employee_id = ANY($1::text[])
          AND used_on = ANY($2::text[])`,
      [empIds, dates]
    )
  );
  for (const r of rows) set.add(`${String(r.employee_id)}|${String(r.used_on)}`);
  return set;
}

/** 한 주(adt_emp_no, weekStart)를 attendance_daily 로부터 재산정해 attendance_weekly upsert. */
async function recomputeWeek(
  db: PgDatabase,
  adtEmpNo: string,
  weekStart: string,
  settings: AttendanceSettings
): Promise<void> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT worked_minutes, night_minutes, is_leave_day, employee_id, emp_name
         FROM attendance_daily
        WHERE adt_emp_no = $1
          AND work_date >= $2::date
          AND work_date < ($2::date + 7)`,
      [adtEmpNo, weekStart]
    )
  );
  const inputs: WeeklyDailyInput[] = rows.map((r) => ({
    workedMinutes: r.worked_minutes != null ? Number(r.worked_minutes) : null,
    nightMinutes: r.night_minutes != null ? Number(r.night_minutes) : null,
    isLeaveDay: r.is_leave_day === true || r.is_leave_day === "t",
  }));
  const w = computeWeekly(inputs, settings);
  const employeeId = rows.find((r) => r.employee_id != null)?.employee_id ?? null;
  const empName = rows.find((r) => r.emp_name != null)?.emp_name ?? null;

  await db.run(
    `INSERT INTO attendance_weekly
       (adt_emp_no, week_start, employee_id, emp_name, worked_minutes, standard_minutes,
        overtime_minutes, overtime_night_minutes, overtime_day_minutes, excess_minutes,
        night_minutes, days_worked, over_limit, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     ON CONFLICT (adt_emp_no, week_start) DO UPDATE SET
        employee_id=EXCLUDED.employee_id, emp_name=EXCLUDED.emp_name,
        worked_minutes=EXCLUDED.worked_minutes, standard_minutes=EXCLUDED.standard_minutes,
        overtime_minutes=EXCLUDED.overtime_minutes, overtime_night_minutes=EXCLUDED.overtime_night_minutes,
        overtime_day_minutes=EXCLUDED.overtime_day_minutes, excess_minutes=EXCLUDED.excess_minutes,
        night_minutes=EXCLUDED.night_minutes, days_worked=EXCLUDED.days_worked,
        over_limit=EXCLUDED.over_limit, updated_at=now()`,
    [
      adtEmpNo, weekStart, employeeId, empName, w.workedMinutes, w.standardMinutes,
      w.overtimeMinutes, w.overtimeNightMinutes, w.overtimeDayMinutes, w.excessMinutes,
      w.nightMinutes, w.daysWorked, w.overLimit,
    ]
  );
}

/** 미처리 스테이징을 일별·주별로 정규화·산정. batchLimit 로 1회 처리량 제한. */
export async function ingestStaging(db: PgDatabase, opts: { batchLimit?: number } = {}): Promise<IngestResult> {
  const settings = await loadAttendanceSettings(db);
  const limit = opts.batchLimit && opts.batchLimit > 0 ? opts.batchLimit : 5000;

  const raws = rowsToObjects(
    await db.exec(
      `SELECT * FROM adt_attendance_raw WHERE processed = false ORDER BY d_date, e_idno LIMIT $1`,
      [limit]
    )
  ) as unknown as AdtRawRecord[];

  if (!raws.length) {
    return { collected: 0, processedRaw: 0, dailyUpserts: 0, weeksRecomputed: 0, matched: 0, unmatched: 0 };
  }

  const eidnos = Array.from(new Set(raws.map((r) => String(r.e_idno))));
  const empMap = await loadEmpMap(db, eidnos);

  // 매핑된 직원의 근무일에 대해서만 휴가일 판정.
  const empIds = Array.from(new Set(Array.from(empMap.values()).map((e) => e.employeeId)));
  const dates = Array.from(new Set(raws.map((r) => ymd8ToDate(String(r.d_date))).filter(Boolean)));
  const leaveSet = await loadLeaveDays(db, empIds, dates);

  const affectedWeeks = new Set<string>();
  let dailyUpserts = 0;
  let matched = 0;
  let unmatched = 0;

  for (const raw of raws) {
    const date = ymd8ToDate(String(raw.d_date));
    if (!date) continue;
    const emp = empMap.get(String(raw.e_idno)) ?? null;
    if (emp) matched += 1; else unmatched += 1;
    const isLeaveDay = emp ? leaveSet.has(`${emp.employeeId}|${date}`) : false;
    const c = computeDaily(raw, settings);

    await db.run(
      `INSERT INTO attendance_daily
         (adt_emp_no, work_date, employee_id, emp_name, dept_snapshot, pos_snapshot,
          in_at, out_at, present_minutes, break_minutes, worked_minutes, night_minutes,
          late_minutes, early_minutes, is_leave_day,
          vendor_over_raw, vendor_night_raw, vendor_total_raw, vendor_allow_raw, source, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20, now())
       ON CONFLICT (adt_emp_no, work_date) DO UPDATE SET
          employee_id=EXCLUDED.employee_id, emp_name=EXCLUDED.emp_name, dept_snapshot=EXCLUDED.dept_snapshot,
          pos_snapshot=EXCLUDED.pos_snapshot, in_at=EXCLUDED.in_at, out_at=EXCLUDED.out_at,
          present_minutes=EXCLUDED.present_minutes, break_minutes=EXCLUDED.break_minutes,
          worked_minutes=EXCLUDED.worked_minutes, night_minutes=EXCLUDED.night_minutes,
          late_minutes=EXCLUDED.late_minutes, early_minutes=EXCLUDED.early_minutes,
          is_leave_day=EXCLUDED.is_leave_day, vendor_over_raw=EXCLUDED.vendor_over_raw,
          vendor_night_raw=EXCLUDED.vendor_night_raw, vendor_total_raw=EXCLUDED.vendor_total_raw,
          vendor_allow_raw=EXCLUDED.vendor_allow_raw, source=EXCLUDED.source, updated_at=now()`,
      [
        String(raw.e_idno), date, emp?.employeeId ?? null, raw.e_name ?? emp?.name ?? null,
        raw.c_dept ?? null, raw.c_pos ?? null,
        c.inAt, c.outAt, c.presentMinutes, c.breakMinutes, c.workedMinutes, c.nightMinutes,
        c.lateMinutes, c.earlyMinutes, isLeaveDay,
        raw.over_time ?? null, raw.night_time ?? null, raw.total_time ?? null, raw.allow_time ?? null,
        (raw as { source?: string }).source ?? "db",
      ]
    );
    dailyUpserts += 1;
    affectedWeeks.add(`${String(raw.e_idno)}|${weekStartOf(date, settings.weekStartDow)}`);

    await db.run(
      `UPDATE adt_attendance_raw SET processed = true WHERE e_idno = $1 AND d_date = $2`,
      [String(raw.e_idno), String(raw.d_date).replace(/\D/g, "")]
    );
  }

  for (const key of affectedWeeks) {
    const [adtEmpNo, weekStart] = key.split("|");
    if (!weekStart) continue;
    await recomputeWeek(db, adtEmpNo, weekStart, settings);
  }

  return {
    collected: 0,
    processedRaw: raws.length,
    dailyUpserts,
    weeksRecomputed: affectedWeeks.size,
    matched,
    unmatched,
  };
}

/**
 * 배치 엔트리용 상위 실행: 지정 소스로 스테이징 수렴 후 정규화·산정까지.
 * mode: 'db'(컨트롤러 직접) | 'file'(txt) | 'both'.
 */
export async function runAdtIngest(opts: {
  mode?: "db" | "file" | "both";
  file?: { dir: string; delimiter?: string; hasHeader?: boolean };
  s3?: { bucket: string; prefix?: string; delimiter?: string; hasHeader?: boolean };
  batchLimit?: number;
}): Promise<IngestResult> {
  const mode = opts.mode ?? "db";
  const sources: AttendanceSource[] = [];
  if (mode === "db" || mode === "both") sources.push(new DbStagingSource());
  if (mode === "file" || mode === "both") {
    // S3(사내 sync 업로드) 우선, 로컬 디렉토리(사내 러너 직접)도 지원.
    if (opts.s3?.bucket) {
      sources.push(new S3Source({ bucket: opts.s3.bucket, prefix: opts.s3.prefix, delimiter: opts.s3.delimiter, hasHeader: opts.s3.hasHeader }));
    }
    if (opts.file?.dir) {
      sources.push(new FileSource({ dir: opts.file.dir, delimiter: opts.file.delimiter, hasHeader: opts.file.hasHeader }));
    }
  }

  return withDbWrite(async (db) => {
    let collected = 0;
    const collectErrors: string[] = [];
    for (const src of sources) {
      const r: CollectResult = await src.collect(db);
      collected += r.ingested;
      if (r.errors?.length) collectErrors.push(...r.errors);
    }
    const res = await ingestStaging(db, { batchLimit: opts.batchLimit });
    return { ...res, collected, ...(collectErrors.length ? { collectErrors } : {}) };
  });
}
