import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { findInCatalog } from "@/lib/approval/leave-types";
import { listLeaveTypes } from "@/lib/approval/leave-types-store";
import { computeAccrual, type AccrualBasis } from "@/lib/approval/leave-accrual";

/*
 * 직원별 휴가 관리(087) — 연차 대장을 날짜별 이력 기반으로 관리(LM-P3).
 * 사용(use) 엔트리는 "날짜 1건 = 1행"(used_on·leave_type_key). 연차·반차뿐 아니라
 * 연차 외 휴가(경조·공가·병가)도 use 로 기록하되, 잔여 차감은 leave_types.deduct 로 판정한다
 * (비차감 항목은 현황 표시·집계용). 부여(grant)/조정(adjust)은 used_on NULL.
 * 잔여 = Σ(grant+adjust) − Σ(use where 차감). 규정 발생연차는 computeAccrual 참고 표시.
 */

const LEAVE_FORM_ID = "frm-leave-request";
const id = () => "alv-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);

export interface LeaveEntry {
  entryId: string;
  employeeId: string;
  year: string;
  entryType: string; // grant|use|adjust
  days: number;
  usedOn: string | null; // YYYY-MM-DD (use)
  leaveTypeKey: string | null;
  leaveLabel: string | null; // 카탈로그 라벨(표시용)
  deduct: "full" | "half" | null;
  docId: string | null;
  source: "groupware" | "excel" | "manual"; // 입력 출처 — 그룹웨어(휴가신청 승인)/엑셀 임포트/수기
  note: string | null;
  createdAt: string;
}

export interface LeaveSummaryRow {
  employeeId: string;
  name: string;
  deptName: string | null;
  positionName: string | null;
  hiredAt: string | null;
  photoPath: string | null;
  granted: number; // grant + adjust
  usedAnnual: number; // 연차 차감분(연차·반차)
  remaining: number;
  otherUsed: number; // 연차 외 휴가 사용일수(현황)
  accrual: number | null; // 규정상 발생연차(참고)
}

export interface LeaveSettings {
  accrualBasis: AccrualBasis;
}

/* ---------- 설정 ---------- */
export async function getLeaveSettings(): Promise<LeaveSettings> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT accrual_basis FROM leave_settings WHERE id = 'default'`));
  const basis = rows.length && rows[0].accrual_basis === "hire_date" ? "hire_date" : "jan1";
  return { accrualBasis: basis as AccrualBasis };
}

export async function saveLeaveSettings(basis: AccrualBasis): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO leave_settings (id, accrual_basis, updated_at) VALUES ('default', $1, $2)
       ON CONFLICT (id) DO UPDATE SET accrual_basis = EXCLUDED.accrual_basis, updated_at = EXCLUDED.updated_at`,
      [basis === "hire_date" ? "hire_date" : "jan1", now]
    );
  });
}

/* ---------- 승인 훅 ---------- */
/**
 * 휴가신청 최종 승인 시 use 엔트리 적재(actOnDoc 트랜잭션 내부). 연차 외 휴가도 기록하며
 * 잔여 차감은 카탈로그 deduct 로 판정한다. 같은 문서로 이미 적재됐으면 건너뛴다.
 */
export async function recordLeaveUsageOnApproval(txn: PgDatabase, docId: string): Promise<void> {
  const rows = rowsToObjects(
    await txn.exec(`SELECT d.form_id, d.drafter_employee_id, d.doc_no, d.field_values FROM approval_docs d WHERE d.doc_id = $1`, [docId])
  );
  if (!rows.length || String(rows[0].form_id) !== LEAVE_FORM_ID) return;
  const employeeId = rows[0].drafter_employee_id != null ? String(rows[0].drafter_employee_id) : null;
  if (!employeeId) return;

  let values: Record<string, unknown> = {};
  try {
    const v = typeof rows[0].field_values === "string" ? JSON.parse(rows[0].field_values) : rows[0].field_values;
    if (v && typeof v === "object") values = v as Record<string, unknown>;
  } catch {
    return;
  }
  const catalog = await listLeaveTypes();
  const item = findInCatalog(catalog, values.leave_type);
  if (!item) return;

  const dup = rowsToObjects(await txn.exec(`SELECT 1 FROM annual_leave_ledger WHERE doc_id = $1 AND entry_type = 'use'`, [docId]));
  if (dup.length) return;

  const period = (values.leave_period ?? {}) as { from?: string; to?: string };
  const from = String(period.from ?? "");
  const to = String(period.to ?? from);
  let days: number;
  if (item.deduct === "half") days = 0.5;
  else {
    const manual = Number(String(values.use_days ?? "").replace(/[^\d.]/g, ""));
    if (manual > 0) days = manual;
    else if (item.days != null) days = item.days;
    else if (from && to) days = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1);
    else days = 1;
  }
  const year = (from || new Date().toISOString()).slice(0, 4);
  await txn.run(
    `INSERT INTO annual_leave_ledger (entry_id, employee_id, year, entry_type, days, used_on, leave_type_key, doc_id, note, created_by, created_at)
     VALUES ($1, $2, $3, 'use', $4, $5, $6, $7, $8, NULL, $9)`,
    [id(), employeeId, year, days, from || null, item.key, docId, `${item.label} ${from}${to && to !== from ? `~${to}` : ""}${rows[0].doc_no ? ` (${rows[0].doc_no})` : ""}`, new Date().toISOString()]
  );
}

/* ---------- 집계 ---------- */
/** 연도별 직원 집계 — 재직자 전체. 연차 차감/연차 외/규정 발생연차·사진 포함. */
export async function listLeaveSummary(year: string): Promise<LeaveSummaryRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, e.hired_at, e.photo_public_path, d.dept_name, p.position_name,
              COALESCE(SUM(CASE WHEN l.entry_type IN ('grant','adjust') THEN l.days END), 0) AS granted,
              COALESCE(SUM(CASE WHEN l.entry_type = 'use' AND (lt.deduct IS NOT NULL OR l.leave_type_key IS NULL) THEN l.days END), 0) AS used_annual,
              COALESCE(SUM(CASE WHEN l.entry_type = 'use' AND l.leave_type_key IS NOT NULL AND lt.deduct IS NULL THEN l.days END), 0) AS used_other
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
         LEFT JOIN annual_leave_ledger l ON l.employee_id = e.employee_id AND l.year = $1
         LEFT JOIN leave_types lt ON lt.key = l.leave_type_key
        WHERE e.status = 'active'
        GROUP BY e.employee_id, e.name, e.hired_at, e.photo_public_path, d.dept_name, p.position_name, p.rank_order
        ORDER BY p.rank_order DESC NULLS LAST, e.hired_at ASC NULLS LAST, e.name`,
      [year]
    )
  );
  const { accrualBasis } = await getLeaveSettings();
  return rows.map((r) => {
    const granted = Number(r.granted ?? 0);
    const usedAnnual = Number(r.used_annual ?? 0);
    const hiredAt = r.hired_at != null ? String(r.hired_at) : null;
    return {
      employeeId: String(r.employee_id ?? ""),
      name: String(r.name ?? ""),
      deptName: r.dept_name != null ? String(r.dept_name) : null,
      positionName: r.position_name != null ? String(r.position_name) : null,
      hiredAt,
      photoPath: r.photo_public_path != null ? String(r.photo_public_path) : null,
      granted,
      usedAnnual,
      remaining: Math.round((granted - usedAnnual) * 100) / 100,
      otherUsed: Number(r.used_other ?? 0),
      accrual: computeAccrual(hiredAt, year, accrualBasis),
    };
  });
}

/** 직원별 엔트리 내역(연도) — 사용일·휴가 종류 라벨 포함, 사용일 순 정렬. */
export async function listLeaveEntries(employeeId: string, year: string): Promise<LeaveEntry[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT l.*, lt.label AS type_label, lt.deduct AS type_deduct
         FROM annual_leave_ledger l
         LEFT JOIN leave_types lt ON lt.key = l.leave_type_key
        WHERE l.employee_id = $1 AND l.year = $2
        ORDER BY (l.entry_type = 'use') DESC, l.used_on NULLS FIRST, l.created_at`,
      [employeeId, year]
    )
  );
  return rows.map((r) => {
    const docId = r.doc_id != null ? String(r.doc_id) : null;
    const note = r.note != null ? String(r.note) : null;
    const source: LeaveEntry["source"] = docId ? "groupware" : note && note.includes("엑셀") ? "excel" : "manual";
    return {
      entryId: String(r.entry_id ?? ""),
      employeeId: String(r.employee_id ?? ""),
      year: String(r.year ?? ""),
      entryType: String(r.entry_type ?? ""),
      days: Number(r.days ?? 0),
      usedOn: r.used_on != null ? String(r.used_on) : null,
      leaveTypeKey: r.leave_type_key != null ? String(r.leave_type_key) : null,
      leaveLabel: r.type_label != null ? String(r.type_label) : r.leave_type_key != null ? String(r.leave_type_key) : null,
      deduct: r.type_deduct === "full" || r.type_deduct === "half" ? r.type_deduct : null,
      docId,
      source,
      note,
      createdAt: String(r.created_at ?? ""),
    };
  });
}

/* ---------- 차트 집계(LM-P4) ---------- */
export interface LeaveCharts {
  year: string;
  monthlyUsed: number[]; // 1~12월 연차 사용일수(전사 합계)
  monthlyRate: number[]; // 1~12월 누적 소진율(%) = 누적 사용 ÷ 총 부여
  yearlyOther: { year: string; days: number }[]; // 연도별 연차 외 휴가 사용일수
}

/** 전사 휴가 차트 데이터 — 월별 연차 사용·월별 소진율·연도별 연차 외. */
export async function getLeaveCharts(year: string): Promise<LeaveCharts> {
  const db = await getDb();
  // 월별 연차 사용(차감분)
  const mu = rowsToObjects(
    await db.exec(
      `SELECT substr(l.used_on, 6, 2) AS mm, COALESCE(SUM(l.days), 0) AS d
         FROM annual_leave_ledger l LEFT JOIN leave_types lt ON lt.key = l.leave_type_key
        WHERE l.year = $1 AND l.entry_type = 'use' AND l.used_on IS NOT NULL
          AND (lt.deduct IS NOT NULL OR l.leave_type_key IS NULL)
        GROUP BY mm`,
      [year]
    )
  );
  const monthlyUsed = Array(12).fill(0) as number[];
  for (const r of mu) {
    const m = Number(r.mm);
    if (m >= 1 && m <= 12) monthlyUsed[m - 1] = Number(r.d ?? 0);
  }
  // 총 부여(소진율 분모)
  const g = rowsToObjects(
    await db.exec(`SELECT COALESCE(SUM(days), 0) AS g FROM annual_leave_ledger WHERE year = $1 AND entry_type IN ('grant','adjust')`, [year])
  );
  const totalGrant = Number(g[0]?.g ?? 0);
  const monthlyRate: number[] = [];
  let cum = 0;
  for (let i = 0; i < 12; i++) {
    cum += monthlyUsed[i];
    monthlyRate.push(totalGrant > 0 ? Math.round((cum / totalGrant) * 1000) / 10 : 0);
  }
  // 연도별 연차 외 휴가
  const yo = rowsToObjects(
    await db.exec(
      `SELECT l.year AS y, COALESCE(SUM(l.days), 0) AS d
         FROM annual_leave_ledger l JOIN leave_types lt ON lt.key = l.leave_type_key
        WHERE l.entry_type = 'use' AND l.leave_type_key IS NOT NULL AND lt.deduct IS NULL
        GROUP BY l.year ORDER BY l.year`,
      []
    )
  );
  return { year, monthlyUsed, monthlyRate, yearlyOther: yo.map((r) => ({ year: String(r.y ?? ""), days: Number(r.d ?? 0) })) };
}

/* ---------- 이력 CRUD ---------- */
/** 사용(use) 엔트리 추가/수정(admin) — 날짜별 이력. entryId 있으면 수정. */
export async function upsertUsageEntry(params: {
  entryId: string | null;
  employeeId: string;
  usedOn: string; // YYYY-MM-DD
  leaveTypeKey: string;
  days: number;
  note?: string | null;
  actorUserId: string;
}): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.usedOn)) throw new Error("사용일(YYYY-MM-DD)이 올바르지 않습니다.");
  if (!params.leaveTypeKey.trim()) throw new Error("휴가 종류가 필요합니다.");
  if (!isFinite(params.days) || params.days <= 0) throw new Error("일수가 올바르지 않습니다.");
  const year = params.usedOn.slice(0, 4);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    if (params.entryId) {
      await txn.run(
        `UPDATE annual_leave_ledger SET used_on = $2, leave_type_key = $3, days = $4, year = $5, note = $6
          WHERE entry_id = $1 AND entry_type = 'use'`,
        [params.entryId, params.usedOn, params.leaveTypeKey, params.days, year, params.note ?? null]
      );
    } else {
      await txn.run(
        `INSERT INTO annual_leave_ledger (entry_id, employee_id, year, entry_type, days, used_on, leave_type_key, doc_id, note, created_by, created_at)
         VALUES ($1, $2, $3, 'use', $4, $5, $6, NULL, $7, $8, $9)`,
        [id(), params.employeeId, year, params.days, params.usedOn, params.leaveTypeKey, params.note ?? null, params.actorUserId, now]
      );
    }
  });
}

/** 부여/조정 엔트리 추가(admin) — grant 양수, adjust ± 허용. */
export async function addLeaveEntries(params: {
  entries: { employeeId: string; year: string; entryType: "grant" | "adjust"; days: number; note?: string | null }[];
  actorUserId: string;
}): Promise<number> {
  const valid = params.entries.filter(
    (e) => e.employeeId && /^\d{4}$/.test(e.year) && ["grant", "adjust"].includes(e.entryType) && isFinite(e.days) && e.days !== 0
  );
  if (!valid.length) return 0;
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    for (const e of valid) {
      await txn.run(
        `INSERT INTO annual_leave_ledger (entry_id, employee_id, year, entry_type, days, doc_id, note, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8)`,
        [id(), e.employeeId, e.year, e.entryType, e.days, e.note ?? null, params.actorUserId, now]
      );
    }
  });
  return valid.length;
}

/** 엔트리 삭제(admin) */
export async function deleteLeaveEntry(entryId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(`DELETE FROM annual_leave_ledger WHERE entry_id = $1`, [entryId]);
  });
}

/** 본인 잔여 연차(기안 화면 배지용) — 차감분만 used. */
export async function getMyLeaveRemaining(userId: string, year: string): Promise<{ granted: number; used: number; remaining: number } | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(SUM(CASE WHEN l.entry_type IN ('grant','adjust') THEN l.days END), 0) AS granted,
              COALESCE(SUM(CASE WHEN l.entry_type = 'use' AND (lt.deduct IS NOT NULL OR l.leave_type_key IS NULL) THEN l.days END), 0) AS used
         FROM users u
         JOIN annual_leave_ledger l ON l.employee_id = u.employee_id AND l.year = $2
         LEFT JOIN leave_types lt ON lt.key = l.leave_type_key
        WHERE u.user_id = $1`,
      [userId, year]
    )
  );
  if (!rows.length) return null;
  const granted = Number(rows[0].granted ?? 0);
  const used = Number(rows[0].used ?? 0);
  if (granted === 0 && used === 0) return null;
  return { granted, used, remaining: Math.round((granted - used) * 100) / 100 };
}
