import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
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
      if (body.counterpartyFacilityId !== undefined) pushSet("counterparty_facility_id", body.counterpartyFacilityId || null);
      if (body.operatingRelationId !== undefined) pushSet("operating_relation_id", body.operatingRelationId || null);
      if (body.contractTitle !== undefined) {
        const title = String(body.contractTitle ?? "").trim();
        if (!title) throw new Error("계약명은 필수입니다.");
        pushSet("contract_title", title);
      }
      if (body.serviceType !== undefined) pushSet("service_type", body.serviceType || null);
      if (body.serviceSubtype !== undefined) pushSet("service_subtype", body.serviceSubtype || null);
      if (body.contractKind !== undefined) pushSet("contract_kind", body.contractKind || "standard");
      if (body.contractStatus !== undefined) pushSet("contract_status", body.contractStatus || "draft");
      if (body.contractAmount !== undefined) pushSet("contract_amount", toNullableNumber(body.contractAmount));
      if (body.legacyContractNo !== undefined) pushSet("legacy_contract_no", body.legacyContractNo || null);
      if (body.legacyCompanyId !== undefined) pushSet("legacy_company_id", body.legacyCompanyId || null);
      if (body.contractDirection !== undefined) pushSet("contract_direction", body.contractDirection || "sales");
      if (body.industryCategory !== undefined) pushSet("industry_category", body.industryCategory || null);
      if (body.paymentMethod !== undefined) pushSet("payment_method", body.paymentMethod || null);
      if (body.orderingSubjectType !== undefined) pushSet("ordering_subject_type", normalizeOrderingSubjectType(body.orderingSubjectType));
      if (body.contractDate !== undefined) pushSet("contract_date", body.contractDate || null);
      if (body.startedAt !== undefined) pushSet("started_at", body.startedAt || null);
      if (body.endedAt !== undefined) pushSet("ended_at", body.endedAt || null);
      if (body.contractTerminatedAt !== undefined) pushSet("contract_terminated_at", body.contractTerminatedAt || null);
      if (body.contractTerminationReason !== undefined) pushSet("contract_termination_reason", body.contractTerminationReason || null);
      if (body.contractSuspendedAt !== undefined) pushSet("contract_suspended_at", body.contractSuspendedAt || null);
      if (body.contractSuspensionReason !== undefined) pushSet("contract_suspension_reason", body.contractSuspensionReason || null);
      if (body.originalAmount !== undefined) pushSet("original_amount", toNullableNumber(body.originalAmount));
      if (body.currentAmount !== undefined) pushSet("current_amount", toNullableNumber(body.currentAmount));
      if (body.memo !== undefined) pushSet("memo", body.memo || null);
      // 허가 정보 (통합허가 분류 전용 — 025 마이그레이션)
      if (body.permitIssuedAt !== undefined) pushSet("permit_issued_at", body.permitIssuedAt || null);
      if (body.permitNo !== undefined) pushSet("permit_no", body.permitNo || null);
      if (body.permitNote !== undefined) pushSet("permit_note", body.permitNote || null);
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

const DELETE_REASONS = new Set(["중복 입력 삭제", "계약 무산", "계약 포기"]);
const newDeleteLogId = () => "cdel_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const newTrashId = () => "trash_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const deleteReason = String(body?.deleteReason ?? "").trim();
    if (!DELETE_REASONS.has(deleteReason)) {
      return NextResponse.json({ error: "삭제 사유를 선택하세요." }, { status: 400 });
    }
    const before = await getContractDetail(contractId);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO contract_delete_logs
          (delete_log_id, contract_id, contract_title, delete_reason, before_json, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          newDeleteLogId(),
          contractId,
          String(before.contract.contract_title ?? ""),
          deleteReason,
          JSON.stringify(before),
          actor.userId,
          now,
        ]
      );
      await db.run(
        `INSERT INTO trash_items
          (trash_id, item_type, item_id, item_title, reason, before_json, deleted_by, deleted_at)
         VALUES ($1, 'contract', $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          newTrashId(),
          contractId,
          String(before.contract.contract_title ?? ""),
          deleteReason,
          JSON.stringify(before),
          actor.userId,
          now,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_delete",
        targetTable: "contracts",
        targetId: contractId,
        before,
        after: { movedToTrash: true, deleteReason },
      });
      await db.run(
        "UPDATE contracts SET deleted_at = $1, deleted_by = $2, delete_reason = $3, updated_at = $1 WHERE contract_id = $4",
        [now, actor.userId, deleteReason, contractId]
      );
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

function normalizeOrderingSubjectType(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return [
    "SITE_DIRECT",
    "PARENT_CORP",
    "CONSIGNED_OPERATOR",
    "THIRD_PARTY_PARTNER",
    "ETC",
  ].includes(text)
    ? text
    : null;
}
