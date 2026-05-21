import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { getContractDetail } from "@/lib/ieps/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { contractId } = await ctx.params;
    const detail = await getContractDetail(contractId);
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
    const body = await req.json();
    const before = await getContractDetail(contractId);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

    await withDbWrite(async (db) => {
      const setClauses: string[] = [];
      const values: unknown[] = [];
      const pushSet = (column: string, value: unknown) => {
        setClauses.push(`${column} = $${values.length + 1}`);
        values.push(value);
      };

      if (body.facilityId !== undefined) pushSet("facility_id", body.facilityId || null);
      if (body.counterpartyEntityId !== undefined) pushSet("counterparty_entity_id", body.counterpartyEntityId || null);
      if (body.operatingRelationId !== undefined) pushSet("operating_relation_id", body.operatingRelationId || null);
      if (body.contractTitle !== undefined) {
        const title = String(body.contractTitle ?? "").trim();
        if (!title) throw new Error("계약명은 필수입니다.");
        pushSet("contract_title", title);
      }
      if (body.serviceType !== undefined) pushSet("service_type", body.serviceType || null);
      if (body.contractStatus !== undefined) pushSet("contract_status", body.contractStatus || "draft");
      if (body.contractAmount !== undefined) pushSet("contract_amount", toNullableNumber(body.contractAmount));
      if (body.legacyContractNo !== undefined) pushSet("legacy_contract_no", body.legacyContractNo || null);
      if (body.legacyCompanyId !== undefined) pushSet("legacy_company_id", body.legacyCompanyId || null);
      if (body.contractDirection !== undefined) pushSet("contract_direction", body.contractDirection || "sales");
      if (body.industryCategory !== undefined) pushSet("industry_category", body.industryCategory || null);
      if (body.contractDate !== undefined) pushSet("contract_date", body.contractDate || null);
      if (body.startedAt !== undefined) pushSet("started_at", body.startedAt || null);
      if (body.endedAt !== undefined) pushSet("ended_at", body.endedAt || null);
      if (body.originalAmount !== undefined) pushSet("original_amount", toNullableNumber(body.originalAmount));
      if (body.currentAmount !== undefined) pushSet("current_amount", toNullableNumber(body.currentAmount));
      if (body.memo !== undefined) pushSet("memo", body.memo || null);
      if (setClauses.length === 0) return;

      pushSet("updated_at", new Date().toISOString());
      values.push(contractId);
      await db.run(`UPDATE contracts SET ${setClauses.join(", ")} WHERE contract_id = $${values.length}`, values);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_update",
        targetTable: "contracts",
        targetId: contractId,
        before,
        after: body,
      });
    });

    return NextResponse.json(await getContractDetail(contractId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
    const before = await getContractDetail(contractId);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
    await withDbWrite(async (db) => {
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_delete",
        targetTable: "contracts",
        targetId: contractId,
        before,
        after: { deleted: true },
      });
      await db.run("DELETE FROM contracts WHERE contract_id = $1", [contractId]);
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
