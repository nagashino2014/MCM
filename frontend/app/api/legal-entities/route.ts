import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requireEditor } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { normalizeAddress, normalizeBusinessRegistrationNo, normalizeCompanyName } from "@/lib/ieps/formatters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = () => "ent_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

function mapEntity(row: Record<string, unknown>) {
  return {
    entityId: String(row.entity_id ?? ""),
    entityName: String(row.entity_name ?? ""),
    businessRegistrationNo: row.business_registration_no != null ? String(row.business_registration_no) : null,
    address: row.address != null ? String(row.address) : null,
    phoneNumber: row.phone_number != null ? String(row.phone_number) : null,
    memo: row.memo != null ? String(row.memo) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const q = req.nextUrl.searchParams.get("q")?.trim();
    const db = await getDb();
    const rows = q
      ? rowsToObjects(
          await db.exec(
            `SELECT * FROM legal_entities
             WHERE entity_name ILIKE $1 OR business_registration_no ILIKE $1
             ORDER BY entity_name ASC
             LIMIT 100`,
            ["%" + q + "%"]
          )
        )
      : rowsToObjects(await db.exec("SELECT * FROM legal_entities ORDER BY entity_name ASC LIMIT 100"));
    return NextResponse.json({ items: rows.map(mapEntity) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireEditor();
    const body = await req.json();
    const entityName = normalizeCompanyName(body.entityName) ?? String(body.entityName ?? "").trim();
    if (!entityName) return NextResponse.json({ error: "법인명은 필수입니다." }, { status: 400 });
    const entityId = id();
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO legal_entities
          (entity_id, entity_name, business_registration_no, address, phone_number, memo, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          entityId,
          entityName,
          normalizeBusinessRegistrationNo(body.businessRegistrationNo),
          normalizeAddress(body.address),
          body.phoneNumber?.trim?.() || null,
          body.memo?.trim?.() || null,
          now,
          now,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "legal_entity_create",
        targetTable: "legal_entities",
        targetId: entityId,
        after: body,
      });
    });
    return NextResponse.json({ entityId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
