import { NextRequest, NextResponse } from "next/server";
import {
  authErrorToResponse,
  requireAuthenticated,
  requireEditor,
} from "@/lib/auth/guards";
import { getDb, invalidateDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import {
  FacilityHistoryEvent,
  normalizeFacilityHistoryEventType,
  type FacilityHistoryEventType,
} from "@/lib/ieps/facility-legacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface HistoryBody {
  eventType?: FacilityHistoryEventType;
  eventDate?: string | null;
  previousCompanyName?: string | null;
  newCompanyName?: string | null;
  previousBusinessRegistrationNo?: string | null;
  newBusinessRegistrationNo?: string | null;
  previousGroupName?: string | null;
  newGroupName?: string | null;
  relatedCompanyName?: string | null;
  memo?: string | null;
}

const nullableText = (value: unknown): string | null => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { id } = await ctx.params;
    invalidateDb();
    const db = await getDb();
    const result = await db.exec(
      `SELECT id, facility_id, event_type, event_date, previous_company_name, new_company_name,
              previous_business_registration_no, new_business_registration_no,
              previous_group_name, new_group_name, related_company_name, source_facility_id,
              memo, source, created_at, created_by
         FROM facility_history_events
        WHERE facility_id = $1
        ORDER BY COALESCE(event_date, created_at) DESC, id DESC`,
      [id]
    );
    return NextResponse.json({
      items: rowsToObjects(result).map((row) => ({
        id: Number(row.id),
        facilityId: String(row.facility_id ?? ""),
        eventType: normalizeFacilityHistoryEventType(row.event_type),
        eventDate: row.event_date != null ? String(row.event_date) : null,
        previousCompanyName:
          row.previous_company_name != null ? String(row.previous_company_name) : null,
        newCompanyName: row.new_company_name != null ? String(row.new_company_name) : null,
        previousBusinessRegistrationNo:
          row.previous_business_registration_no != null
            ? String(row.previous_business_registration_no)
            : null,
        newBusinessRegistrationNo:
          row.new_business_registration_no != null
            ? String(row.new_business_registration_no)
            : null,
        previousGroupName:
          row.previous_group_name != null ? String(row.previous_group_name) : null,
        newGroupName: row.new_group_name != null ? String(row.new_group_name) : null,
        relatedCompanyName:
          row.related_company_name != null ? String(row.related_company_name) : null,
        sourceFacilityId:
          row.source_facility_id != null ? String(row.source_facility_id) : null,
        memo: row.memo != null ? String(row.memo) : null,
        source: row.source != null ? String(row.source) : "manual",
        createdAt: String(row.created_at ?? ""),
        createdBy: row.created_by != null ? String(row.created_by) : null,
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { id } = await ctx.params;
    const body = (await req.json()) as HistoryBody;
    const now = new Date().toISOString();
    const event = new FacilityHistoryEvent({
      facilityId: id,
      eventType: normalizeFacilityHistoryEventType(body.eventType),
      eventDate: nullableText(body.eventDate),
      previousCompanyName: nullableText(body.previousCompanyName),
      newCompanyName: nullableText(body.newCompanyName),
      previousBusinessRegistrationNo: nullableText(body.previousBusinessRegistrationNo),
      newBusinessRegistrationNo: nullableText(body.newBusinessRegistrationNo),
      previousGroupName: nullableText(body.previousGroupName),
      newGroupName: nullableText(body.newGroupName),
      relatedCompanyName: nullableText(body.relatedCompanyName),
      sourceFacilityId: null,
      memo: nullableText(body.memo),
      source: "manual",
      createdAt: now,
      createdBy: actor.userId,
    });

    await withDbWrite(async (db) => {
      const exists = await db.exec("SELECT facility_id FROM facilities WHERE facility_id = $1 LIMIT 1", [id]);
      if (!exists.length || !exists[0].values.length) throw new Error("facility not found");
      await db.run(
        `INSERT INTO facility_history_events
          (facility_id, event_type, event_date, previous_company_name, new_company_name,
           previous_business_registration_no, new_business_registration_no,
           previous_group_name, new_group_name, related_company_name, source_facility_id,
           memo, source, created_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        event.toDbParams() as any[]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_history_create",
        targetTable: "facility_history_events",
        targetId: id,
        after: event,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
