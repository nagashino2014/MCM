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
  deptType?: string | null;
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
                email, duties, status, dept_type, appointed_at, transferred_at, resigned_at, created_at, updated_at
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
      deptType: row.dept_type != null ? String(row.dept_type) : null,
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
        deptType: nullableText(item.deptType),
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
      // 명함 OCR 원본(card_*)은 이 replace-all 저장 흐름 밖(049, 명함 촬영 API)에서 기록된다 —
      // DELETE→INSERT 로 재생성할 때 기존 id 기준으로 보존하지 않으면 소실된다.
      const cardByPersonId = new Map<number, Record<string, unknown>>();
      for (const row of rowsToObjects(
        await db.exec(
          `SELECT id, card_storage_provider, card_storage_bucket, card_storage_key,
                  card_public_path, card_ocr_text, card_parsed_json, card_captured_at
             FROM facility_contact_people WHERE facility_id = $1`,
          [id]
        )
      )) {
        cardByPersonId.set(Number(row.id), row);
      }
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
        const card = person.id != null ? cardByPersonId.get(person.id) : undefined;
        const inserted = await db.exec(
          `INSERT INTO facility_contact_people
            (facility_id, department_id, person_name, title, office_phone, mobile_phone, email,
             duties, status, dept_type, appointed_at, transferred_at, resigned_at,
             card_storage_provider, card_storage_bucket, card_storage_key, card_public_path,
             card_ocr_text, card_parsed_json, card_captured_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   $14, $15, $16, $17, $18, $19, $20, $21, $22)
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
            person.deptType,
            person.appointedAt,
            person.transferredAt,
            person.resignedAt,
            card?.card_storage_provider ?? null,
            card?.card_storage_bucket ?? null,
            card?.card_storage_key ?? null,
            card?.card_public_path ?? null,
            card?.card_ocr_text ?? null,
            card?.card_parsed_json != null ? JSON.stringify(card.card_parsed_json) : null,
            card?.card_captured_at ?? null,
            now,
            now,
          ]
        );
        const newId = Number(inserted[0]?.values[0]?.[0] ?? 0);
        personIdMap.set(person.id ?? -(personIndex + 1), newId);
        personIndex += 1;
      }

      // 이 replace-all 저장은 담당자 id 를 재발급한다 — 영업 일정의 "만난 사람" 연결
      // (sales_activity_contacts.person_id, FK 없음)이 옛 id 를 가리킨 채 끊어지므로
      // 새 id 로 재매핑한다(아래 logs 의 person_id 재매핑과 같은 취지).
      for (const [oldId, newId] of personIdMap) {
        if (oldId > 0 && oldId !== newId) {
          await db.run(`UPDATE sales_activity_contacts SET person_id = $2 WHERE person_id = $1`, [oldId, newId]);
        }
      }
      // 삭제된(이번 저장에 없는) 담당자의 일정 연결은 정리 — 끊어진 참조를 남기지 않는다.
      await db.run(
        `DELETE FROM sales_activity_contacts
          WHERE person_id NOT IN (SELECT id FROM facility_contact_people)
            AND EXISTS (SELECT 1 FROM sales_activities a
                         JOIN sales_projects p ON p.project_id = a.project_id
                        WHERE a.activity_id = sales_activity_contacts.activity_id
                          AND p.facility_id = $1)`,
        [id]
      );

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
