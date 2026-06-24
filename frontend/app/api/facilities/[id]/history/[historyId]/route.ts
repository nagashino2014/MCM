import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { normalizeFacilityHistoryEventType, type FacilityHistoryEventType } from "@/lib/ieps/facility-legacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; historyId: string }>;
}

interface HistoryBody {
  eventType?: FacilityHistoryEventType;
  eventTypes?: FacilityHistoryEventType[] | null;
  eventDate?: string | null;
  previousCompanyName?: string | null;
  newCompanyName?: string | null;
  previousBusinessRegistrationNo?: string | null;
  newBusinessRegistrationNo?: string | null;
  previousGroupName?: string | null;
  newGroupName?: string | null;
  previousSiteAddress?: string | null;
  newSiteAddress?: string | null;
  acquirerCompanyName?: string | null;
  mergerTargetCompanyNames?: (string | null | undefined)[] | null;
  relatedCompanyName?: string | null;
  memo?: string | null;
}

const nullableText = (value: unknown): string | null => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const EVENT_TYPE_PRIORITY: FacilityHistoryEventType[] = [
  "company_name_change",
  "business_registration_no_change",
  "site_address_change",
  "group_change",
  "acquisition",
  "merger",
  "closure",
];

function resolveEventTypes(body: HistoryBody): {
  eventTypes: FacilityHistoryEventType[];
  primary: FacilityHistoryEventType;
} {
  const raw = Array.isArray(body.eventTypes) && body.eventTypes.length
    ? body.eventTypes
    : body.eventType
    ? [body.eventType]
    : [];
  const normalized = Array.from(new Set(raw.map((value) => normalizeFacilityHistoryEventType(value))));
  const primary =
    EVENT_TYPE_PRIORITY.find((type) => normalized.includes(type)) ?? normalized[0] ?? "manual_note";
  return { eventTypes: normalized.length ? normalized : [primary], primary };
}

function normalizeMergerTargets(value: HistoryBody["mergerTargetCompanyNames"]): string | null {
  if (!Array.isArray(value)) return null;
  const list = value.map((item) => (item ?? "").toString().trim()).filter((item) => item.length > 0);
  return list.length ? JSON.stringify(list) : null;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id: facilityId, historyId } = await ctx.params;
    const body = (await req.json()) as HistoryBody;

    await withDbWrite(async (db) => {
      const before = await snapshotHistory(db, facilityId, historyId);
      if (!before) throw new Error("history event not found");
      const { eventTypes, primary } = resolveEventTypes(body);
      await db.run(
        `UPDATE facility_history_events SET
           event_type = $1, event_date = $2, previous_company_name = $3, new_company_name = $4,
           previous_business_registration_no = $5, new_business_registration_no = $6,
           previous_group_name = $7, new_group_name = $8, related_company_name = $9, memo = $10,
           previous_site_address = $13, new_site_address = $14, acquirer_company_name = $15,
           merger_target_company_names = $16, event_types = $17
         WHERE id = $11 AND facility_id = $12`,
        [
          primary,
          nullableText(body.eventDate),
          nullableText(body.previousCompanyName),
          nullableText(body.newCompanyName),
          nullableText(body.previousBusinessRegistrationNo),
          nullableText(body.newBusinessRegistrationNo),
          nullableText(body.previousGroupName),
          nullableText(body.newGroupName),
          nullableText(body.relatedCompanyName),
          nullableText(body.memo),
          historyId,
          facilityId,
          nullableText(body.previousSiteAddress),
          nullableText(body.newSiteAddress),
          nullableText(body.acquirerCompanyName),
          normalizeMergerTargets(body.mergerTargetCompanyNames),
          eventTypes.length ? JSON.stringify(eventTypes) : null,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_history_update",
        targetTable: "facility_history_events",
        targetId: historyId,
        before,
        after: body,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id: facilityId, historyId } = await ctx.params;
    await withDbWrite(async (db) => {
      const before = await snapshotHistory(db, facilityId, historyId);
      if (!before) throw new Error("history event not found");
      await db.run("DELETE FROM facility_history_events WHERE id = $1 AND facility_id = $2", [
        historyId,
        facilityId,
      ]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_history_delete",
        targetTable: "facility_history_events",
        targetId: historyId,
        before,
        after: { deleted: true },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

async function snapshotHistory(
  db: any,
  facilityId: string,
  historyId: string
): Promise<Record<string, unknown> | null> {
  const result = await db.exec(
    "SELECT * FROM facility_history_events WHERE id = $1 AND facility_id = $2 LIMIT 1",
    [historyId, facilityId]
  );
  if (!result.length || !result[0].values.length) return null;
  const row: Record<string, unknown> = {};
  result[0].columns.forEach((col: string, idx: number) => {
    row[col] = result[0].values[0][idx];
  });
  return row;
}
