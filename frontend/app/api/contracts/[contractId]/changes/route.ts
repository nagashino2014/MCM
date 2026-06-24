import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

const newChangeId = () => "chg_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

/**
 * Persist a contract change event with the modal-shaped payload.
 * The payload object is stored as-is in change_payload_json so the change-contract modal
 * can rehydrate per-tab fields. Optionally callers can pass changedFields (string[]) and
 * a documentId pointing to a previously uploaded contract_documents row.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    const body = await req.json();

    const changedAt = body.changedAt ? String(body.changedAt) : null;
    const previousAmount = toNullableNumber(body.previousAmount);
    const deltaAmount = toNullableNumber(body.deltaAmount);
    const changedServicePeriod = body.changedServicePeriod ? String(body.changedServicePeriod) : null;
    const changedPaymentTerms = body.changedPaymentTerms ? String(body.changedPaymentTerms) : null;
    const detail = body.detail ? String(body.detail) : null;
    const documentId = body.documentId ? String(body.documentId) : null;
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    const changedFields = Array.isArray(body.changedFields) ? body.changedFields : [];
    const newFacilityIds = body.newFacilityIds !== undefined ? normalizeStringArray(body.newFacilityIds) : null;

    const changeId = newChangeId();
    const now = new Date().toISOString();

    await withDbWrite(async (db) => {
      const exists = rowsToObjects(
        await db.exec("SELECT contract_id FROM contracts WHERE contract_id = $1", [contractId])
      );
      if (exists.length === 0) throw new Error("계약을 찾을 수 없습니다.");

      await db.run(
        `INSERT INTO contract_change_events
          (change_id, contract_id, changed_at, previous_amount, delta_amount,
           changed_service_period, changed_payment_terms, detail, document_id,
           change_payload_json, changed_fields_json,
           created_at, updated_at)
         VALUES
          ($1, $2, $3, $4, $5,
           $6, $7, $8, $9,
           $10::jsonb, $11::jsonb,
           $12, $13)`,
        [
          changeId,
          contractId,
          changedAt,
          previousAmount,
          deltaAmount,
          changedServicePeriod,
          changedPaymentTerms,
          detail,
          documentId,
          JSON.stringify(payload),
          JSON.stringify(changedFields),
          now,
          now,
        ]
      );

      const contractUpdates: string[] = [];
      const values: unknown[] = [];
      const pushSet = (column: string, value: unknown) => {
        contractUpdates.push(`${column} = $${values.length + 1}`);
        values.push(value);
      };
      if (body.newCurrentAmount !== undefined) {
        pushSet("current_amount", toNullableNumber(body.newCurrentAmount));
      }
      if (body.newEndedAt !== undefined) {
        pushSet("ended_at", body.newEndedAt || null);
      }
      if (body.newServiceType !== undefined) {
        pushSet("service_type", body.newServiceType || null);
      }
      if (body.newServiceSubtype !== undefined) {
        pushSet("service_subtype", body.newServiceSubtype || null);
      }
      if (body.newIndustryCategory !== undefined) {
        pushSet("industry_category", body.newIndustryCategory || null);
      }
      if (body.newPaymentMethod !== undefined) {
        pushSet("payment_method", body.newPaymentMethod || null);
      }
      if (body.newOrderingSubjectType !== undefined) {
        pushSet("ordering_subject_type", normalizeOrderingSubjectType(body.newOrderingSubjectType));
      }
      if (newFacilityIds !== null) {
        pushSet("facility_id", newFacilityIds[0] || null);
      }
      if (body.contractTerminatedAt !== undefined) {
        pushSet("contract_terminated_at", body.contractTerminatedAt || null);
        pushSet("contract_termination_reason", body.contractTerminationReason || null);
      }
      if (body.contractSuspendedAt !== undefined) {
        pushSet("contract_suspended_at", body.contractSuspendedAt || null);
        pushSet("contract_suspension_reason", body.contractSuspensionReason || null);
      }
      if (body.contractTerminatedAt) {
        pushSet("contract_status", "terminated");
      } else if (body.contractSuspendedAt) {
        pushSet("contract_status", "suspended");
      }
      if (contractUpdates.length > 0) {
        contractUpdates.push(`updated_at = $${values.length + 1}`);
        values.push(now);
        values.push(contractId);
        await db.run(`UPDATE contracts SET ${contractUpdates.join(", ")} WHERE contract_id = $${values.length}`, values);
      }
      if (newFacilityIds !== null) {
        await db.run(
          "DELETE FROM contract_facilities WHERE contract_id = $1 AND relation_type = 'integrated_permit_target'",
          [contractId]
        );
        for (const facilityId of newFacilityIds) {
          await db.run(
            `INSERT INTO contract_facilities
              (contract_id, facility_id, relation_type, created_at, updated_at)
             VALUES ($1, $2, 'integrated_permit_target', $3, $4)`,
            [contractId, facilityId, now, now]
          );
        }
      }

      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_update",
        targetTable: "contract_change_events",
        targetId: changeId,
        after: { contractId, changeId, payload, changedFields, deltaAmount },
      });
    });

    return NextResponse.json({ changeId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    )
  );
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
