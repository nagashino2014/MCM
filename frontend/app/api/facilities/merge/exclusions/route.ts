import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MatchType = "brn" | "company" | "address";

interface ExclusionBody {
  matchType?: MatchType;
  matchValue?: string | null;
  facilityIds?: string[];
  reason?: string | null;
}

function normalizeMatchType(value: unknown): MatchType | null {
  if (value === "brn" || value === "company" || value === "address") return value;
  return null;
}

function facilityIdsKey(ids: string[]): string {
  return [...new Set(ids)].sort().join("|");
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireEditor();
    const body = (await req.json()) as ExclusionBody;
    const matchType = normalizeMatchType(body.matchType);
    const ids = Array.isArray(body.facilityIds)
      ? body.facilityIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const uniqueIds = [...new Set(ids)].sort();
    if (!matchType || uniqueIds.length < 2) {
      return NextResponse.json(
        { error: "matchType 과 2개 이상의 facilityIds 가 필요합니다." },
        { status: 400 }
      );
    }

    const key = facilityIdsKey(uniqueIds);
    const now = new Date().toISOString();
    const reason = body.reason?.trim() || "서로 다른 개별 통합허가 대상 사업장";
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO facility_merge_exclusions
          (match_type, match_value, facility_ids_key, facility_ids_json, reason, created_at, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
         ON CONFLICT (match_type, facility_ids_key) DO UPDATE SET
           match_value = excluded.match_value,
           facility_ids_json = excluded.facility_ids_json,
           reason = excluded.reason,
           created_at = excluded.created_at,
           created_by = excluded.created_by`,
        [
          matchType,
          body.matchValue?.trim() || null,
          key,
          JSON.stringify(uniqueIds),
          reason,
          now,
          actor.userId,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_merge_exclude",
        targetTable: "facility_merge_exclusions",
        targetId: `${matchType}:${key}`,
        after: {
          matchType,
          matchValue: body.matchValue ?? null,
          facilityIds: uniqueIds,
          reason,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
