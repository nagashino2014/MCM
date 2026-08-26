import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { ActionConnector } from "@/lib/approval/actions";

/*
 * 인사 계열 승인 커넥터(FRM-P3, 206) — 퇴직원·휴직원·인사 발령 승인 시 employee_hr_events 자동 기록.
 *  - 퇴직원: resignation 이벤트. 계정 비활성은 승인 즉시가 아니라 **퇴사일 도래 시**(사용자 확정) —
 *    applyDueResignations(리마인드 틱)가 매 틱 판정한다. 퇴사일이 이미 지났으면 즉시 비활성.
 *  - 휴직원: leave_start 이벤트(복직 leave_end 는 인사관리 탭에서 수기).
 *  - 인사 발령: 표 행 단위 promotion/transfer 일괄 — 발령 직급/부서는 이름 매칭(실패 시 라벨 스냅샷만).
 * 멱등 1차는 실행기(action_runs ok 유니크), 2차는 note 의 문서번호 검사.
 */

function id(): string {
  return "hrev_" + crypto.randomBytes(8).toString("hex");
}

async function hasEventForDoc(eventType: string, employeeId: string, docTag: string): Promise<boolean> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT 1 FROM employee_hr_events WHERE employee_id = $1 AND event_type = $2 AND note LIKE $3 LIMIT 1`, [
      employeeId,
      eventType,
      `%${docTag}%`,
    ])
  );
  return rows.length > 0;
}

/** 퇴직원 승인 → resignation 기록. 퇴사일이 오늘 이전이면 즉시 비활성, 미래면 틱이 처리. */
export const recordResignationConnector: ActionConnector = {
  kind: "hr.record_resignation",
  label: "퇴사 이력 기록",
  description: "승인된 퇴직원의 퇴사 정보를 인사관리에 기록합니다. 계정은 퇴사일 도래 시 비활성화됩니다.",
  slots: [
    { key: "date", label: "퇴직(예정)일", required: true },
    { key: "reason", label: "퇴직 사유" },
  ],
  async run(ctx) {
    const employeeId = ctx.drafterEmployeeId;
    if (!employeeId) throw new Error("기안자 직원 정보가 없습니다.");
    const resignDate = String(ctx.slot("date") ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(resignDate)) throw new Error("퇴직(예정)일이 올바르지 않습니다.");
    const docTag = ctx.docNo ?? ctx.docId;
    if (await hasEventForDoc("resignation", employeeId, docTag)) return { detail: "이미 기록됨 — 건너뜀" };
    const reason = String(ctx.slot("reason") ?? "").slice(0, 200);
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    await withDbWrite(async (txn) => {
      await txn.run(
        `INSERT INTO employee_hr_events (event_id, employee_id, event_type, event_date, note, created_by, created_at, updated_at)
         VALUES ($1, $2, 'resignation', $3, $4, $5, $6, $6)`,
        [id(), employeeId, resignDate, `${reason ? `${reason} ` : ""}(퇴직원 ${docTag})`, ctx.drafterUserId, now]
      );
      if (resignDate <= today) {
        await txn.run(`UPDATE employee_profiles SET status = 'inactive', updated_at = $1 WHERE employee_id = $2`, [now, employeeId]);
        await txn.run(
          `UPDATE users SET status = 'disabled', updated_at = $1 WHERE user_id = (SELECT user_id FROM employee_profiles WHERE employee_id = $2)`,
          [now, employeeId]
        );
      }
    });
    return {
      detail:
        resignDate <= today
          ? `퇴사 처리 완료(${resignDate}) — 계정 비활성화`
          : `퇴사 예정 기록(${resignDate}) — 퇴사일 도래 시 계정이 비활성화됩니다`,
    };
  },
};

/** 휴직원 승인 → leave_start 기록. */
export const recordLeaveAbsenceConnector: ActionConnector = {
  kind: "hr.record_leave_absence",
  label: "휴직 이력 기록",
  description: "승인된 휴직원의 휴직 시작을 인사관리에 기록합니다(복직은 인사관리 탭에서 처리).",
  slots: [
    { key: "period", label: "휴직 기간", required: true },
    { key: "kind", label: "휴직 구분" },
    { key: "reason", label: "휴직 사유" },
  ],
  async run(ctx) {
    const employeeId = ctx.drafterEmployeeId;
    if (!employeeId) throw new Error("기안자 직원 정보가 없습니다.");
    const period = (ctx.slot("period") ?? {}) as { from?: string; to?: string };
    const from = String(period.from ?? "").slice(0, 10);
    const to = String(period.to ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("휴직 시작일이 올바르지 않습니다.");
    const docTag = ctx.docNo ?? ctx.docId;
    if (await hasEventForDoc("leave_start", employeeId, docTag)) return { detail: "이미 기록됨 — 건너뜀" };
    const kind = String(ctx.slot("kind") ?? "휴직");
    const now = new Date().toISOString();
    await withDbWrite(async (txn) => {
      await txn.run(
        `INSERT INTO employee_hr_events (event_id, employee_id, event_type, event_date, note, created_by, created_at, updated_at)
         VALUES ($1, $2, 'leave_start', $3, $4, $5, $6, $6)`,
        [id(), employeeId, from, `${kind}${to ? ` ~ ${to} 예정` : ""} (휴직원 ${docTag})`, ctx.drafterUserId, now]
      );
    });
    return { detail: `휴직 시작 기록(${from}${to ? ` ~ ${to}` : ""}) — 복직 시 인사관리 탭에서 처리` };
  },
};

interface AppointmentRow {
  person?: Array<{ employeeId?: string; name?: string }>;
  appoint_kind?: string;
  appoint_date?: string;
  new_position?: string;
  to_dept?: string;
  note?: string;
}

/** 인사 발령 승인 → 표 행 단위 promotion/transfer 기록(행당 복수 대상자 지원). */
export const recordAppointmentsConnector: ActionConnector = {
  kind: "hr.record_appointments",
  label: "인사 발령 이력 기록",
  description: "승인된 인사 발령의 각 행을 대상자별 승진/부서이동 이력으로 기록합니다.",
  slots: [{ key: "rows", label: "발령 내역(표)", required: true }],
  async run(ctx) {
    const rows = ctx.slot("rows");
    if (!Array.isArray(rows) || !rows.length) throw new Error("발령 내역 표가 비어 있습니다.");
    const db = await getDb();
    const positions = rowsToObjects(await db.exec(`SELECT position_id, position_name FROM positions`));
    const departments = rowsToObjects(await db.exec(`SELECT dept_id, dept_name FROM departments`));
    const posByName = new Map(positions.map((p) => [String(p.position_name).trim(), String(p.position_id)]));
    const deptByName = new Map(departments.map((d) => [String(d.dept_name).trim(), String(d.dept_id)]));
    const docTag = ctx.docNo ?? ctx.docId;
    const now = new Date().toISOString();
    let recorded = 0;
    const skipped: string[] = [];

    await withDbWrite(async (txn) => {
      for (const raw of rows as AppointmentRow[]) {
        if (!raw || typeof raw !== "object") continue;
        const people = Array.isArray(raw.person) ? raw.person.filter((p) => p && p.employeeId) : [];
        const kindLabel = String(raw.appoint_kind ?? "").trim();
        const eventType = kindLabel === "승진" ? "promotion" : kindLabel === "부서이동" ? "transfer" : null;
        const eventDate = String(raw.appoint_date ?? "").slice(0, 10);
        if (!people.length || !eventType || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
          if (people.length || kindLabel) skipped.push(`${people.map((p) => p.name).join(",") || "?"} (${kindLabel || "구분 없음"})`);
          continue;
        }
        for (const person of people) {
          const employeeId = String(person.employeeId);
          const existing = rowsToObjects(
            await txn.exec(
              `SELECT 1 FROM employee_hr_events WHERE employee_id = $1 AND event_type = $2 AND event_date = $3 AND note LIKE $4 LIMIT 1`,
              [employeeId, eventType, eventDate, `%${docTag}%`]
            )
          );
          if (existing.length) continue;
          const newPositionName = String(raw.new_position ?? "").trim() || null;
          const toDeptName = String(raw.to_dept ?? "").trim() || null;
          const positionId = newPositionName ? posByName.get(newPositionName) ?? null : null;
          const toDeptId = toDeptName ? deptByName.get(toDeptName) ?? null : null;
          // 부서이동의 현재 부서 스냅샷
          const cur = rowsToObjects(
            await txn.exec(
              `SELECT e.dept_id, d.dept_name FROM employee_profiles e LEFT JOIN departments d ON d.dept_id = e.dept_id WHERE e.employee_id = $1`,
              [employeeId]
            )
          );
          await txn.run(
            `INSERT INTO employee_hr_events
               (event_id, employee_id, event_type, event_date, position_id, position_name,
                from_dept_id, to_dept_id, from_dept_name, to_dept_name, note, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
            [
              id(),
              employeeId,
              eventType,
              eventDate,
              eventType === "promotion" ? positionId : null,
              eventType === "promotion" ? newPositionName : null,
              eventType === "transfer" && cur.length ? (cur[0].dept_id != null ? String(cur[0].dept_id) : null) : null,
              eventType === "transfer" ? toDeptId : null,
              eventType === "transfer" && cur.length ? (cur[0].dept_name != null ? String(cur[0].dept_name) : null) : null,
              eventType === "transfer" ? toDeptName : null,
              `${String(raw.note ?? "").trim() ? `${String(raw.note).trim()} ` : ""}(인사발령 ${docTag})`,
              ctx.drafterUserId,
              now,
            ]
          );
          // 발령 반영 — 승진은 현재 직급, 부서이동은 현재 부서 갱신(이름 매칭 성공 시에만)
          if (eventType === "promotion" && positionId) {
            await txn.run(`UPDATE employee_profiles SET position_id = $2, updated_at = $3 WHERE employee_id = $1`, [employeeId, positionId, now]);
            await txn.run(`UPDATE users SET position_id = $2, updated_at = $3 WHERE employee_id = $1`, [employeeId, positionId, now]);
          }
          if (eventType === "transfer" && toDeptId) {
            await txn.run(`UPDATE employee_profiles SET dept_id = $2, updated_at = $3 WHERE employee_id = $1`, [employeeId, toDeptId, now]);
            await txn.run(`UPDATE users SET dept_id = $2, updated_at = $3 WHERE employee_id = $1`, [employeeId, toDeptId, now]);
          }
          recorded += 1;
        }
      }
    });
    if (!recorded && skipped.length) throw new Error(`기록된 발령이 없습니다 — 확인 필요: ${skipped.join(" / ")}`);
    return {
      detail: `발령 ${recorded}건 기록${skipped.length ? ` (건너뜀: ${skipped.join(" / ")})` : ""}`,
      result: { recorded, skipped },
    };
  },
};

/** 퇴사일이 도래한 직원 비활성화 — 리마인드 틱에서 매회 호출(멱등). */
export async function applyDueResignations(now = new Date()): Promise<{ deactivated: number }> {
  const today = now.toISOString().slice(0, 10);
  const ts = now.toISOString();
  let deactivated = 0;
  await withDbWrite(async (txn) => {
    const due = rowsToObjects(
      await txn.exec(
        `SELECT DISTINCT e.employee_id FROM employee_profiles e
           JOIN employee_hr_events ev ON ev.employee_id = e.employee_id AND ev.event_type = 'resignation'
          WHERE e.status = 'active' AND ev.event_date <= $1`,
        [today]
      )
    );
    for (const r of due) {
      const employeeId = String(r.employee_id);
      await txn.run(`UPDATE employee_profiles SET status = 'inactive', updated_at = $1 WHERE employee_id = $2`, [ts, employeeId]);
      await txn.run(
        `UPDATE users SET status = 'disabled', updated_at = $1 WHERE user_id = (SELECT user_id FROM employee_profiles WHERE employee_id = $2)`,
        [ts, employeeId]
      );
      deactivated += 1;
    }
  });
  return { deactivated };
}
