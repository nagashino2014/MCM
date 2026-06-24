import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface DepartmentBody {
  id?: number | null;
  departmentName?: string | null;
  phoneNumber?: string | null;
  faxNumber?: string | null;
  duties?: string | null;
}

interface PersonBody {
  id?: number | null;
  departmentId?: number | null;
  personName?: string | null;
  title?: string | null;
  officePhone?: string | null;
  mobilePhone?: string | null;
  email?: string | null;
  duties?: string | null;
  status?: string | null;
  appointedAt?: string | null;
  transferredAt?: string | null;
  resignedAt?: string | null;
}

interface LogBody {
  id?: number | null;
  departmentId?: number | null;
  personId?: number | null;
  eventType?: string | null;
  eventDate?: string | null;
  memo?: string | null;
}

interface PutBody {
  mainNumber?: { phoneNumber?: string | null; note?: string | null } | null;
  departments?: DepartmentBody[];
  people?: PersonBody[];
  logs?: LogBody[];
}

const nullableText = (value: unknown): string | null => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const numberOrNull = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("facility.view");
    const { id } = await ctx.params;
    const db = await getDb();
    const mainNumberRow = rowsToObjects(
      await db.exec(
        `SELECT facility_id, phone_number, note, created_at, updated_at
           FROM facility_contact_main_numbers
          WHERE facility_id = $1
          LIMIT 1`,
        [id]
      )
    )[0];
    const mainNumber = mainNumberRow
      ? {
          facilityId: String(mainNumberRow.facility_id ?? ""),
          phoneNumber: mainNumberRow.phone_number != null ? String(mainNumberRow.phone_number) : null,
          note: mainNumberRow.note != null ? String(mainNumberRow.note) : null,
          createdAt: String(mainNumberRow.created_at ?? ""),
          updatedAt: String(mainNumberRow.updated_at ?? ""),
        }
      : null;
    const departments = rowsToObjects(
      await db.exec(
        `SELECT id, facility_id, department_name, phone_number, fax_number, duties, created_at, updated_at
           FROM facility_contact_departments
          WHERE facility_id = $1
          ORDER BY department_name ASC, id ASC`,
        [id]
      )
    ).map((row) => ({
      id: Number(row.id),
      facilityId: String(row.facility_id ?? ""),
      departmentName: String(row.department_name ?? ""),
      phoneNumber: row.phone_number != null ? String(row.phone_number) : null,
      faxNumber: row.fax_number != null ? String(row.fax_number) : null,
      duties: row.duties != null ? String(row.duties) : null,
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
    }));
    const people = rowsToObjects(
      await db.exec(
        `SELECT id, facility_id, department_id, person_name, title, office_phone, mobile_phone,
                email, duties, status, appointed_at, transferred_at, resigned_at, created_at, updated_at
           FROM facility_contact_people
          WHERE facility_id = $1
          ORDER BY person_name ASC, id ASC`,
        [id]
      )
    ).map((row) => ({
      id: Number(row.id),
      facilityId: String(row.facility_id ?? ""),
      departmentId: row.department_id != null ? Number(row.department_id) : null,
      personName: String(row.person_name ?? ""),
      title: row.title != null ? String(row.title) : null,
      officePhone: row.office_phone != null ? String(row.office_phone) : null,
      mobilePhone: row.mobile_phone != null ? String(row.mobile_phone) : null,
      email: row.email != null ? String(row.email) : null,
      duties: row.duties != null ? String(row.duties) : null,
      status: row.status != null ? String(row.status) : "active",
      appointedAt: row.appointed_at != null ? String(row.appointed_at) : null,
      transferredAt: row.transferred_at != null ? String(row.transferred_at) : null,
      resignedAt: row.resigned_at != null ? String(row.resigned_at) : null,
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
    }));
    const logs = rowsToObjects(
      await db.exec(
        `SELECT id, facility_id, department_id, person_id, event_type, event_date, memo, created_at
           FROM facility_contact_logs
          WHERE facility_id = $1
          ORDER BY COALESCE(event_date, created_at) DESC, id DESC`,
        [id]
      )
    ).map((row) => ({
      id: Number(row.id),
      facilityId: String(row.facility_id ?? ""),
      departmentId: row.department_id != null ? Number(row.department_id) : null,
      personId: row.person_id != null ? Number(row.person_id) : null,
      eventType: String(row.event_type ?? ""),
      eventDate: row.event_date != null ? String(row.event_date) : null,
      memo: row.memo != null ? String(row.memo) : null,
      createdAt: String(row.created_at ?? ""),
    }));
    return NextResponse.json({ mainNumber, departments, people, logs });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const body = (await req.json()) as PutBody;
    const mainNumber = {
      phoneNumber: nullableText(body.mainNumber?.phoneNumber),
      note: nullableText(body.mainNumber?.note),
    };
    const departments = (body.departments ?? [])
      .map((item) => ({
        id: numberOrNull(item.id),
        departmentName: nullableText(item.departmentName),
        phoneNumber: nullableText(item.phoneNumber),
        faxNumber: nullableText(item.faxNumber),
        duties: nullableText(item.duties),
      }))
      .filter((item) => item.departmentName);
    const people = (body.people ?? [])
      .map((item) => ({
        id: numberOrNull(item.id),
        departmentId: numberOrNull(item.departmentId),
        personName: nullableText(item.personName),
        title: nullableText(item.title),
        officePhone: nullableText(item.officePhone),
        mobilePhone: nullableText(item.mobilePhone),
        email: nullableText(item.email),
        duties: nullableText(item.duties),
        status: nullableText(item.status) ?? "active",
        appointedAt: nullableText(item.appointedAt),
        transferredAt: nullableText(item.transferredAt),
        resignedAt: nullableText(item.resignedAt),
      }))
      .filter((item) => item.personName);
    const logs = (body.logs ?? [])
      .map((item) => ({
        departmentId: numberOrNull(item.departmentId),
        personId: numberOrNull(item.personId),
        eventType: nullableText(item.eventType) ?? "memo",
        eventDate: nullableText(item.eventDate),
        memo: nullableText(item.memo),
      }))
      .filter((item) => item.memo || item.eventDate);
    const now = new Date().toISOString();

    await withDbWrite(async (db) => {
      const before = {
        departments: await db.exec("SELECT * FROM facility_contact_departments WHERE facility_id = $1", [id]),
        people: await db.exec("SELECT * FROM facility_contact_people WHERE facility_id = $1", [id]),
        logs: await db.exec("SELECT * FROM facility_contact_logs WHERE facility_id = $1", [id]),
        mainNumber: await db.exec("SELECT * FROM facility_contact_main_numbers WHERE facility_id = $1", [id]),
      };
      await db.run("DELETE FROM facility_contact_main_numbers WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_contact_logs WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_contact_people WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_contact_departments WHERE facility_id = $1", [id]);

      if (mainNumber.phoneNumber || mainNumber.note) {
        await db.run(
          `INSERT INTO facility_contact_main_numbers
            (facility_id, phone_number, note, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, mainNumber.phoneNumber, mainNumber.note, now, now]
        );
      }

      const departmentIdMap = new Map<number, number>();
      let depIndex = 0;
      for (const department of departments) {
        const inserted = await db.exec(
          `INSERT INTO facility_contact_departments
            (facility_id, department_name, phone_number, fax_number, duties, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [id, department.departmentName, department.phoneNumber, department.faxNumber, department.duties, now, now]
        );
        const newId = Number(inserted[0]?.values[0]?.[0] ?? 0);
        departmentIdMap.set(department.id ?? -(depIndex + 1), newId);
        depIndex += 1;
      }

      const personIdMap = new Map<number, number>();
      let personIndex = 0;
      for (const person of people) {
        const mappedDepartmentId =
          person.departmentId != null ? departmentIdMap.get(person.departmentId) ?? person.departmentId : null;
        const inserted = await db.exec(
          `INSERT INTO facility_contact_people
            (facility_id, department_id, person_name, title, office_phone, mobile_phone, email,
             duties, status, appointed_at, transferred_at, resigned_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING id`,
          [
            id,
            mappedDepartmentId,
            person.personName,
            person.title,
            person.officePhone,
            person.mobilePhone,
            person.email,
            person.duties,
            person.status,
            person.appointedAt,
            person.transferredAt,
            person.resignedAt,
            now,
            now,
          ]
        );
        const newId = Number(inserted[0]?.values[0]?.[0] ?? 0);
        personIdMap.set(person.id ?? -(personIndex + 1), newId);
        personIndex += 1;
      }

      for (const log of logs) {
        const mappedDepartmentId =
          log.departmentId != null ? departmentIdMap.get(log.departmentId) ?? log.departmentId : null;
        const mappedPersonId = log.personId != null ? personIdMap.get(log.personId) ?? log.personId : null;
        await db.run(
          `INSERT INTO facility_contact_logs
            (facility_id, department_id, person_id, event_type, event_date, memo, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, mappedDepartmentId, mappedPersonId, log.eventType, log.eventDate, log.memo, now]
        );
      }

      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_contact_update",
        targetTable: "facility_contacts",
        targetId: id,
        before,
        after: { mainNumber, departments, people, logs },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
