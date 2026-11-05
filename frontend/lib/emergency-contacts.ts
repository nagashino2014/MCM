/**
 * 비상 연락망(/directory '비상 연락망' 탭) — 조회·수정·순서 저장.
 * 이름·직급·연락처·직통번호·이메일의 원천은 직원 마스터(employee_profiles)다. 표에서 직원 번호를 고치면 인사카드에 그대로 반영된다.
 * 소속 표시·직책·순서·숨김과 인사카드가 없는 인원, 겸직 줄(한 사람을 다른 소속에도 올리는 둘째 줄)만 emergency_contact_entries(340)에 둔다.
 * 수정 내역은 audit_log, 열람·다운로드는 access_log(API 라우트)에 남긴다.
 */
import { randomUUID } from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { MAIL_DOMAIN } from "@/lib/mail/mailbox";
import {
  EMERGENCY_EMPLOYEE_SQL,
  buildEmergencyRows,
  emergencyEmployeeFromRow,
  type EmergencyContactRow,
  type EmergencyEntryFact,
} from "@/lib/emergency-contacts-rules";

const str = (v: unknown) => (v != null ? String(v) : null);

export async function listEmergencyContacts(): Promise<EmergencyContactRow[]> {
  const db = await getDb();
  const employees = rowsToObjects(await db.exec(EMERGENCY_EMPLOYEE_SQL)).map((r) => emergencyEmployeeFromRow(r, MAIL_DOMAIN));
  const entryRows = rowsToObjects(
    await db.exec(
      `SELECT entry_id, employee_id, same_as_employee_id, group_label, title, display_order, hidden, name, position_name, mobile_phone, direct_phone, email
         FROM emergency_contact_entries`
    )
  );
  const entries: EmergencyEntryFact[] = entryRows.map((r) => ({
    entryId: String(r.entry_id),
    employeeId: str(r.employee_id),
    sameAsEmployeeId: str(r.same_as_employee_id),
    groupLabel: str(r.group_label),
    title: str(r.title),
    displayOrder: r.display_order != null ? Number(r.display_order) : null,
    hidden: Number(r.hidden) === 1,
    name: str(r.name),
    positionName: str(r.position_name),
    mobilePhone: str(r.mobile_phone),
    directPhone: str(r.direct_phone),
    email: str(r.email),
  }));
  return buildEmergencyRows(employees, entries);
}

export interface EmergencyContactPatch {
  groupLabel?: string | null;
  title?: string | null;
  name?: string | null;
  positionName?: string | null;
  mobilePhone?: string | null;
  directPhone?: string | null;
  email?: string | null;
  hidden?: boolean;
}

const clean = (v: string | null | undefined) => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};

function assertValid(patch: EmergencyContactPatch) {
  for (const [label, v] of [
    ["소속", patch.groupLabel],
    ["직책", patch.title],
    ["이름", patch.name],
    ["직급", patch.positionName],
    ["연락처", patch.mobilePhone],
    ["직통번호", patch.directPhone],
    ["이메일", patch.email],
  ] as const) {
    if (v != null && String(v).length > 120) throw new Error(`${label}이(가) 너무 깁니다.`);
  }
  const email = clean(patch.email);
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("이메일 형식이 올바르지 않습니다.");
}

/** 인사카드가 없는 인원 추가. */
export async function createEmergencyContact(input: EmergencyContactPatch, actorUserId: string): Promise<string> {
  assertValid(input);
  const name = clean(input.name);
  if (!name) throw new Error("이름을 입력하세요.");
  const entryId = randomUUID();
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO emergency_contact_entries
         (entry_id, group_label, title, name, position_name, mobile_phone, direct_phone, email, created_by, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $10)`,
      [
        entryId,
        clean(input.groupLabel),
        clean(input.title),
        name,
        clean(input.positionName),
        clean(input.mobilePhone),
        clean(input.directPhone),
        clean(input.email),
        actorUserId,
        now,
      ]
    );
    await recordAuditLogInline(db, {
      actorUserId,
      action: "emergency_contact_create",
      targetTable: "emergency_contact_entries",
      targetId: entryId,
      after: input,
    });
  });
  return entryId;
}

async function assertLineFree(db: PgDatabase, employeeId: string, groupLabel: string, exceptEntryId: string | null) {
  const taken = rowsToObjects(
    await db.exec(
      `SELECT 1 FROM emergency_contact_entries
        WHERE same_as_employee_id = $1 AND group_label = $2 AND ($3::text IS NULL OR entry_id <> $3)`,
      [employeeId, groupLabel, exceptEntryId]
    )
  )[0];
  if (taken) throw new Error("이미 그 소속에 표시돼 있습니다.");
}

/** 겸직 줄 추가 — 같은 직원을 다른 소속에도 표시한다. 이름·번호는 인사카드를 따른다. */
export async function addEmergencyContactLine(
  employeeId: string,
  input: Pick<EmergencyContactPatch, "groupLabel" | "title">,
  actorUserId: string
): Promise<string> {
  assertValid(input);
  const groupLabel = clean(input.groupLabel);
  if (!groupLabel) throw new Error("소속을 입력하세요.");
  const entryId = randomUUID();
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    const employee = rowsToObjects(await db.exec(`SELECT 1 FROM employee_profiles WHERE employee_id = $1 AND status = 'active'`, [employeeId]))[0];
    if (!employee) throw new Error("직원을 찾을 수 없습니다.");
    await assertLineFree(db, employeeId, groupLabel, null);
    await db.run(
      `INSERT INTO emergency_contact_entries (entry_id, same_as_employee_id, group_label, title, created_by, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $6)`,
      [entryId, employeeId, groupLabel, clean(input.title), actorUserId, now]
    );
    await recordAuditLogInline(db, {
      actorUserId,
      action: "emergency_contact_create",
      targetTable: "emergency_contact_entries",
      targetId: entryId,
      after: { sameAsEmployeeId: employeeId, groupLabel, title: clean(input.title) },
    });
  });
  return entryId;
}

function parseKey(key: string): { employeeId: string } | { entryId: string } {
  if (key.startsWith("emp:") && key.length > 4) return { employeeId: key.slice(4) };
  if (key.startsWith("entry:") && key.length > 6) return { entryId: key.slice(6) };
  throw new Error("잘못된 행입니다.");
}

/** 직원 행의 표시 설정 upsert. 전달된 칸만 바꾼다. */
async function upsertEmployeeEntry(
  db: PgDatabase,
  employeeId: string,
  fields: { groupLabel?: string | null; title?: string | null; hidden?: boolean; displayOrder?: number },
  actorUserId: string,
  now: string
) {
  const sets: string[] = ["updated_by = $3", "updated_at = $4"];
  const insertCols: string[] = [];
  const insertVals: string[] = [];
  const params: unknown[] = [randomUUID(), employeeId, actorUserId, now];
  const put = (col: string, val: unknown) => {
    params.push(val);
    insertCols.push(col);
    insertVals.push(`$${params.length}`);
    sets.push(`${col} = EXCLUDED.${col}`);
  };
  if (fields.groupLabel !== undefined) put("group_label", fields.groupLabel);
  if (fields.title !== undefined) put("title", fields.title);
  if (fields.hidden !== undefined) put("hidden", fields.hidden ? 1 : 0);
  if (fields.displayOrder !== undefined) put("display_order", fields.displayOrder);
  await db.run(
    `INSERT INTO emergency_contact_entries (entry_id, employee_id, created_by, updated_by, created_at, updated_at${insertCols.map((c) => `, ${c}`).join("")})
     VALUES ($1, $2, $3, $3, $4, $4${insertVals.map((v) => `, ${v}`).join("")})
     ON CONFLICT (employee_id) WHERE employee_id IS NOT NULL DO UPDATE SET ${sets.join(", ")}`,
    params
  );
}

/** 직원의 연락처·직통번호·이메일을 인사카드에 쓴다. 전달된 칸만 바꾼다. */
async function writeEmployeeContacts(db: PgDatabase, employeeId: string, patch: EmergencyContactPatch, now: string) {
  const sets: string[] = [];
  const params: unknown[] = [employeeId];
  const put = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.mobilePhone !== undefined) put("mobile_phone", clean(patch.mobilePhone));
  if (patch.directPhone !== undefined) put("company_phone", clean(patch.directPhone));
  if (patch.email !== undefined) put("email", clean(patch.email));
  if (!sets.length) return;
  put("updated_at", now);
  await db.run(`UPDATE employee_profiles SET ${sets.join(", ")} WHERE employee_id = $1`, params);
}

/** 행 수정. 직원 행·겸직 줄의 연락처·직통번호·이메일은 인사카드(employee_profiles)를 고친다. */
export async function updateEmergencyContact(key: string, patch: EmergencyContactPatch, actorUserId: string): Promise<void> {
  assertValid(patch);
  const target = parseKey(key);
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    if ("employeeId" in target) {
      const before = rowsToObjects(
        await db.exec(
          `SELECT e.employee_id, e.mobile_phone, e.company_phone, e.email, x.group_label, x.title, x.hidden
             FROM employee_profiles e
             LEFT JOIN emergency_contact_entries x ON x.employee_id = e.employee_id
            WHERE e.employee_id = $1`,
          [target.employeeId]
        )
      )[0];
      if (!before) throw new Error("직원을 찾을 수 없습니다.");
      await writeEmployeeContacts(db, target.employeeId, patch, now);
      if (patch.groupLabel !== undefined || patch.title !== undefined || patch.hidden !== undefined) {
        await upsertEmployeeEntry(
          db,
          target.employeeId,
          {
            ...(patch.groupLabel !== undefined ? { groupLabel: clean(patch.groupLabel) } : {}),
            ...(patch.title !== undefined ? { title: clean(patch.title) } : {}),
            ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
          },
          actorUserId,
          now
        );
      }
      await recordAuditLogInline(db, {
        actorUserId,
        action: "emergency_contact_update",
        targetTable: "employee_profiles",
        targetId: target.employeeId,
        before,
        after: patch,
      });
      return;
    }
    const before = rowsToObjects(
      await db.exec(
        `SELECT x.*, e.mobile_phone AS employee_mobile_phone, e.company_phone AS employee_company_phone, e.email AS employee_email
           FROM emergency_contact_entries x
           LEFT JOIN employee_profiles e ON e.employee_id = x.same_as_employee_id
          WHERE x.entry_id = $1 AND x.employee_id IS NULL`,
        [target.entryId]
      )
    )[0];
    if (!before) throw new Error("행을 찾을 수 없습니다.");
    const sameAs = str(before.same_as_employee_id);
    if (sameAs) {
      await writeEmployeeContacts(db, sameAs, patch, now);
      if (patch.groupLabel !== undefined) {
        const groupLabel = clean(patch.groupLabel);
        if (!groupLabel) throw new Error("소속을 입력하세요.");
        await assertLineFree(db, sameAs, groupLabel, target.entryId);
      }
    }
    const sets: string[] = ["updated_by = $2", "updated_at = $3"];
    const params: unknown[] = [target.entryId, actorUserId, now];
    const put = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (!sameAs && patch.name !== undefined) {
      const name = clean(patch.name);
      if (!name) throw new Error("이름을 입력하세요.");
      put("name", name);
    }
    if (patch.groupLabel !== undefined) put("group_label", clean(patch.groupLabel));
    if (patch.title !== undefined) put("title", clean(patch.title));
    if (!sameAs) {
      if (patch.positionName !== undefined) put("position_name", clean(patch.positionName));
      if (patch.mobilePhone !== undefined) put("mobile_phone", clean(patch.mobilePhone));
      if (patch.directPhone !== undefined) put("direct_phone", clean(patch.directPhone));
      if (patch.email !== undefined) put("email", clean(patch.email));
    }
    if (patch.hidden !== undefined) put("hidden", patch.hidden ? 1 : 0);
    await db.run(`UPDATE emergency_contact_entries SET ${sets.join(", ")} WHERE entry_id = $1`, params);
    await recordAuditLogInline(db, {
      actorUserId,
      action: "emergency_contact_update",
      targetTable: "emergency_contact_entries",
      targetId: target.entryId,
      before,
      after: patch,
    });
  });
}

/** 직접 입력 행·겸직 줄 삭제. 직원 행은 지우지 않고 숨긴다(퇴사는 인사 이력으로 처리). */
export async function deleteEmergencyContact(key: string, actorUserId: string): Promise<void> {
  const target = parseKey(key);
  if (!("entryId" in target)) throw new Error("직원은 삭제할 수 없습니다. 표에서 숨기거나 인사 이력으로 퇴사 처리하세요.");
  await withDbWrite(async (db) => {
    const before = rowsToObjects(
      await db.exec(`SELECT * FROM emergency_contact_entries WHERE entry_id = $1 AND employee_id IS NULL`, [target.entryId])
    )[0];
    if (!before) throw new Error("행을 찾을 수 없습니다.");
    await db.run(`DELETE FROM emergency_contact_entries WHERE entry_id = $1`, [target.entryId]);
    await recordAuditLogInline(db, {
      actorUserId,
      action: "emergency_contact_delete",
      targetTable: "emergency_contact_entries",
      targetId: target.entryId,
      before,
    });
  });
}

/** 표 순서 저장 — 화면에 보이는 순서 그대로 10 단위로 기록한다. */
export async function saveEmergencyContactOrder(keys: string[], actorUserId: string): Promise<void> {
  const parsed = keys.map(parseKey);
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    for (let i = 0; i < parsed.length; i++) {
      const target = parsed[i];
      const displayOrder = (i + 1) * 10;
      if ("employeeId" in target) {
        await upsertEmployeeEntry(db, target.employeeId, { displayOrder }, actorUserId, now);
      } else {
        await db.run(
          `UPDATE emergency_contact_entries SET display_order = $2, updated_by = $3, updated_at = $4 WHERE entry_id = $1 AND employee_id IS NULL`,
          [target.entryId, displayOrder, actorUserId, now]
        );
      }
    }
    await recordAuditLogInline(db, {
      actorUserId,
      action: "emergency_contact_reorder",
      targetTable: "emergency_contact_entries",
      targetId: "order",
      after: { count: parsed.length },
    });
  });
}
