import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { findInCatalog } from "@/lib/approval/leave-types";
import { listLeaveTypes } from "@/lib/approval/leave-types-store";

/*
 * 연차 대장(084 annual_leave_ledger, §8-5) — 부여(grant)/사용(use)/조정(adjust) 엔트리 누적.
 * 휴가신청(frm-leave-request) 최종 승인 시 자동으로 use 엔트리를 적재한다(연차·반차만,
 * 경조/공가/병가 등은 규정상 부여휴가라 비차감). 차감 판정은 LEAVE_ENTITLEMENTS 카탈로그의
 * deduct(full/half) 기준(fields.ts). 초기 잔여는 사용자 자료 임포트(grant/adjust)로 맞춘다.
 */

const LEAVE_FORM_ID = "frm-leave-request";

export interface LeaveEntry {
  entryId: string;
  employeeId: string;
  year: string;
  entryType: string; // grant|use|adjust
  days: number;
  docId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface LeaveSummaryRow {
  employeeId: string;
  name: string;
  deptName: string | null;
  positionName: string | null;
  granted: number; // grant + adjust 합
  used: number; // use 합
  remaining: number;
}

/**
 * 휴가신청 최종 승인 훅 — actOnDoc 트랜잭션 내부에서 호출한다.
 * 연차/반차만 차감하며, 같은 문서로 이미 적재됐으면 건너뛴다(재상신·중복 방지).
 */
export async function recordLeaveUsageOnApproval(txn: PgDatabase, docId: string): Promise<void> {
  const rows = rowsToObjects(
    await txn.exec(
      `SELECT d.form_id, d.drafter_employee_id, d.doc_no, d.field_values
         FROM approval_docs d WHERE d.doc_id = $1`,
      [docId]
    )
  );
  if (!rows.length || String(rows[0].form_id) !== LEAVE_FORM_ID) return;
  const employeeId = rows[0].drafter_employee_id != null ? String(rows[0].drafter_employee_id) : null;
  if (!employeeId) return; // 직원 미연결 계정 — 대장 반영 불가(문서 자체는 유지)

  let values: Record<string, unknown> = {};
  try {
    const v = typeof rows[0].field_values === "string" ? JSON.parse(rows[0].field_values) : rows[0].field_values;
    if (v && typeof v === "object") values = v as Record<string, unknown>;
  } catch {
    return;
  }
  const catalog = await listLeaveTypes();
  const item = findInCatalog(catalog, values.leave_type);
  const isFull = item?.deduct === "full";
  const isHalf = item?.deduct === "half";
  if (!isFull && !isHalf) return; // 비차감 휴가(경조·공가·병가 등)

  const dup = rowsToObjects(
    await txn.exec(`SELECT 1 FROM annual_leave_ledger WHERE doc_id = $1 AND entry_type = 'use'`, [docId])
  );
  if (dup.length) return;

  const period = (values.leave_period ?? {}) as { from?: string; to?: string };
  const from = String(period.from ?? "");
  const to = String(period.to ?? from);
  // 사용 일수: 반차 0.5 고정, 연차는 use_days 입력값 우선 — 없으면 기간 일수(주말 미제외 단순 계산)
  let days: number;
  if (isHalf) {
    days = 0.5;
  } else {
    const manual = Number(String(values.use_days ?? "").replace(/[^\d.]/g, ""));
    if (manual > 0) days = manual;
    else if (from && to) days = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1);
    else days = 1;
  }
  const year = (from || new Date().toISOString()).slice(0, 4);
  await txn.run(
    `INSERT INTO annual_leave_ledger (entry_id, employee_id, year, entry_type, days, doc_id, note, created_by, created_at)
     VALUES ($1, $2, $3, 'use', $4, $5, $6, NULL, $7)`,
    [
      "alv-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14),
      employeeId,
      year,
      days,
      docId,
      `${item?.label ?? ""} ${from}${to && to !== from ? `~${to}` : ""}${rows[0].doc_no ? ` (${rows[0].doc_no})` : ""}`,
      new Date().toISOString(),
    ]
  );
}

/** 연도별 직원 집계 — 재직자 전체(대장 엔트리 없는 직원도 0으로 표시). */
export async function listLeaveSummary(year: string): Promise<LeaveSummaryRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, d.dept_name, p.position_name,
              COALESCE(SUM(CASE WHEN l.entry_type IN ('grant','adjust') THEN l.days END), 0) AS granted,
              COALESCE(SUM(CASE WHEN l.entry_type = 'use' THEN l.days END), 0) AS used
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
         LEFT JOIN annual_leave_ledger l ON l.employee_id = e.employee_id AND l.year = $1
        WHERE e.status = 'active'
        GROUP BY e.employee_id, e.name, d.dept_name, p.position_name, p.rank_order, e.hired_at
        ORDER BY p.rank_order DESC NULLS LAST, e.hired_at ASC NULLS LAST, e.name`,
      [year]
    )
  );
  return rows.map((r) => {
    const granted = Number(r.granted ?? 0);
    const used = Number(r.used ?? 0);
    return {
      employeeId: String(r.employee_id ?? ""),
      name: String(r.name ?? ""),
      deptName: r.dept_name != null ? String(r.dept_name) : null,
      positionName: r.position_name != null ? String(r.position_name) : null,
      granted,
      used,
      remaining: Math.round((granted - used) * 100) / 100,
    };
  });
}

/** 직원별 엔트리 내역(연도) */
export async function listLeaveEntries(employeeId: string, year: string): Promise<LeaveEntry[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT * FROM annual_leave_ledger WHERE employee_id = $1 AND year = $2 ORDER BY created_at`,
      [employeeId, year]
    )
  );
  return rows.map((r) => ({
    entryId: String(r.entry_id ?? ""),
    employeeId: String(r.employee_id ?? ""),
    year: String(r.year ?? ""),
    entryType: String(r.entry_type ?? ""),
    days: Number(r.days ?? 0),
    docId: r.doc_id != null ? String(r.doc_id) : null,
    note: r.note != null ? String(r.note) : null,
    createdBy: r.created_by != null ? String(r.created_by) : null,
    createdAt: String(r.created_at ?? ""),
  }));
}

/** 부여/조정 엔트리 추가(admin) — days 는 grant 양수, adjust 는 ± 허용. */
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
        ["alv-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14), e.employeeId, e.year, e.entryType, e.days, e.note ?? null, params.actorUserId, now]
      );
    }
  });
  return valid.length;
}

/** 엔트리 삭제(admin — 잘못 입력 정정용, 자동 use 엔트리도 삭제 가능하되 감사로그 필수) */
export async function deleteLeaveEntry(entryId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run(`DELETE FROM annual_leave_ledger WHERE entry_id = $1`, [entryId]);
  });
}

/** 본인 잔여 연차(기안 화면 배지용) — userId 기준. */
export async function getMyLeaveRemaining(userId: string, year: string): Promise<{ granted: number; used: number; remaining: number } | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(SUM(CASE WHEN l.entry_type IN ('grant','adjust') THEN l.days END), 0) AS granted,
              COALESCE(SUM(CASE WHEN l.entry_type = 'use' THEN l.days END), 0) AS used
         FROM users u
         JOIN annual_leave_ledger l ON l.employee_id = u.employee_id AND l.year = $2
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
