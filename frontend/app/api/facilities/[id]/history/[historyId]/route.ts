import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
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

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { id: facilityId, historyId } = await ctx.params;
    const body = (await req.json()) as HistoryBody;

    await withDbWrite(async (db) => {
      const before = await snapshotHistory(db, facilityId, historyId);
      if (!before) throw new Error("history event not found");
      await db.run(
        `UPDATE facility_history_events SET
           event_type = $1, event_date = $2, previous_company_name = $3, new_company_name = $4,
           previous_business_registration_no = $5, new_business_registration_no = $6,
           previous_group_name = $7, new_group_name = $8, related_company_name = $9, memo = $10
         WHERE id = $11 AND facility_id = $12`,
        [
          normalizeFacilityHistoryEventType(body.eventType),
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
    const actor = await requireEditor();
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
