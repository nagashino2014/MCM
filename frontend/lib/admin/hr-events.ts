/**
 * 인사 이력(employee_hr_events) read/write — 승진/부서이동/퇴사.
 * - 첨부 문서는 employee_documents(target_table='employee_hr_events', target_id=event_id)로 연결.
 * - 퇴사(resignation) 기록 시 employee_profiles.status='inactive' + 연결 계정 users.status='disabled'.
 *   삭제 시 'active'로 복구.
 * 마이그레이션: infra/aws/045_employee_hr_events.sql
 */

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export type HrEventType = "promotion" | "transfer" | "resignation";

export interface HrEventRow {
  eventId: string;
  employeeId: string;
  eventType: HrEventType;
  eventDate: string;
  positionId: string | null;
  positionName: string | null;
  fromDeptId: string | null;
  toDeptId: string | null;
  fromDeptName: string | null;
  toDeptName: string | null;
  note: string | null;
  createdAt: string;
}

export interface CreateHrEventInput {
  employeeId: string;
  eventType: HrEventType;
  eventDate: string;
  positionId?: string | null;
  fromDeptId?: string | null;
  toDeptId?: string | null;
  note?: string | null;
}

function nullable(value: unknown): string | null {
  return value != null ? String(value) : null;
}

function mapRow(row: Record<string, unknown>): HrEventRow {
  return {
    eventId: String(row.event_id ?? ""),
    employeeId: String(row.employee_id ?? ""),
    eventType: String(row.event_type ?? "promotion") as HrEventType,
    eventDate: String(row.event_date ?? ""),
    positionId: nullable(row.position_id),
    positionName: nullable(row.position_name),
    fromDeptId: nullable(row.from_dept_id),
    toDeptId: nullable(row.to_dept_id),
    fromDeptName: nullable(row.from_dept_name),
    toDeptName: nullable(row.to_dept_name),
    note: nullable(row.note),
    createdAt: String(row.created_at ?? ""),
  };
}

export async function listHrEvents(employeeId: string): Promise<HrEventRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      "SELECT * FROM employee_hr_events WHERE employee_id = $1 ORDER BY event_date DESC, created_at DESC",
      [employeeId]
    )
  );
  return rows.map(mapRow);
}

export async function createHrEvent(
  actorUserId: string,
  input: CreateHrEventInput
): Promise<HrEventRow> {
  if (!input.employeeId) throw new Error("employeeId가 필요합니다.");
  if (!input.eventDate) throw new Error("일자를 입력하세요.");
  const eventId = "hrev_" + crypto.randomBytes(8).toString("hex");
  const now = new Date().toISOString();

  return withDbWrite(async (db) => {
    // 라벨 스냅샷(직급명/부서명) — id 가 나중에 바뀌거나 삭제돼도 이력 표기 유지.
    let positionName: string | null = null;
    if (input.positionId) {
      const r = rowsToObjects(
        await db.exec("SELECT position_name FROM positions WHERE position_id = $1 LIMIT 1", [input.positionId])
      );
      positionName = r.length ? nullable(r[0].position_name) : null;
    }
    const deptName = async (deptId?: string | null): Promise<string | null> => {
      if (!deptId) return null;
      const r = rowsToObjects(
        await db.exec("SELECT dept_name FROM departments WHERE dept_id = $1 LIMIT 1", [deptId])
      );
      return r.length ? nullable(r[0].dept_name) : null;
    };
    const fromDeptName = await deptName(input.fromDeptId);
    const toDeptName = await deptName(input.toDeptId);

    await db.run(
      `INSERT INTO employee_hr_events
         (event_id, employee_id, event_type, event_date, position_id, position_name,
          from_dept_id, to_dept_id, from_dept_name, to_dept_name, note, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
      [
        eventId,
        input.employeeId,
        input.eventType,
        input.eventDate,
        input.positionId ?? null,
        positionName,
        input.fromDeptId ?? null,
        input.toDeptId ?? null,
        fromDeptName,
        toDeptName,
        input.note ?? null,
        actorUserId,
        now,
      ]
    );

    // 퇴사: 인원 비활성화 + 연결 계정 비활성화.
    if (input.eventType === "resignation") {
      await db.run(
        "UPDATE employee_profiles SET status = 'inactive', updated_at = $1 WHERE employee_id = $2",
        [now, input.employeeId]
      );
      await db.run(
        "UPDATE users SET status = 'disabled', updated_at = $1 WHERE user_id = (SELECT user_id FROM employee_profiles WHERE employee_id = $2)",
        [now, input.employeeId]
      );
    }

    await recordAuditLogInline(db, {
      actorUserId,
      action: "employee_hr_event_create",
      targetTable: "employee_hr_events",
      targetId: eventId,
      after: { ...input, positionName },
    });

    const created = rowsToObjects(
      await db.exec("SELECT * FROM employee_hr_events WHERE event_id = $1 LIMIT 1", [eventId])
    );
    return mapRow(created[0]);
  });
}

export async function deleteHrEvent(actorUserId: string, eventId: string): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec("SELECT * FROM employee_hr_events WHERE event_id = $1 LIMIT 1", [eventId])
    );
    if (!rows.length) throw new Error("이력을 찾을 수 없습니다.");
    const event = rows[0];
    const employeeId = String(event.employee_id ?? "");

    // 연결 첨부 문서 행 삭제(S3 객체는 잔존 — 후속 정리).
    await db.run(
      "DELETE FROM employee_documents WHERE target_table = 'employee_hr_events' AND target_id = $1",
      [eventId]
    );
    await db.run("DELETE FROM employee_hr_events WHERE event_id = $1", [eventId]);

    // 퇴사 취소: 인원/계정 복구.
    if (String(event.event_type ?? "") === "resignation") {
      await db.run(
        "UPDATE employee_profiles SET status = 'active', updated_at = $1 WHERE employee_id = $2",
        [now, employeeId]
      );
      await db.run(
        "UPDATE users SET status = 'active', updated_at = $1 WHERE user_id = (SELECT user_id FROM employee_profiles WHERE employee_id = $2)",
        [now, employeeId]
      );
    }

    await recordAuditLogInline(db, {
      actorUserId,
      action: "employee_hr_event_delete",
      targetTable: "employee_hr_events",
      targetId: eventId,
      before: event,
    });
  });
}
