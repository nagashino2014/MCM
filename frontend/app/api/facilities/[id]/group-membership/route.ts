import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface Body {
  groupId?: string | null;
  companyId?: string | null;
  relationType?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
}

const RELATION_TYPES = new Set(["site", "operating_company", "owner_company", "other"]);

function normalizeRelationType(value: string | null | undefined) {
  const relationType = value?.trim() || "operating_company";
  return RELATION_TYPES.has(relationType) ? relationType : null;
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { id } = await ctx.params;
    const body = (await req.json()) as Body;
    if (!body.groupId || !body.companyId) {
      return NextResponse.json({ error: "그룹과 연결 법인을 선택해야 합니다." }, { status: 400 });
    }
    const groupId = body.groupId;
    const companyId = body.companyId;
    const relationType = normalizeRelationType(body.relationType);
    if (!relationType) {
      return NextResponse.json({ error: "지원하지 않는 사업장 연결 관계입니다." }, { status: 400 });
    }
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_group_memberships WHERE facility_id = $1", [id]);
      await db.run(
        `INSERT INTO facility_group_memberships
          (facility_id, group_id, company_id, relation_type, started_at, ended_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (facility_id) DO UPDATE SET
           group_id = excluded.group_id,
           company_id = excluded.company_id,
           relation_type = excluded.relation_type,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           updated_at = excluded.updated_at`,
        [
          id,
          groupId,
          companyId,
          relationType,
          body.startedAt?.trim() || null,
          body.endedAt?.trim() || null,
          now,
          now,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_group_membership_update",
        targetTable: "facility_group_memberships",
        targetId: id,
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
    const { id } = await ctx.params;
    await withDbWrite(async (db) => {
      const before = await db.exec("SELECT * FROM facility_group_memberships WHERE facility_id = $1", [id]);
      await db.run("DELETE FROM facility_group_memberships WHERE facility_id = $1", [id]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_group_membership_update",
        targetTable: "facility_group_memberships",
        targetId: id,
        before,
        after: { deleted: true },
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
