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
      if (body.newContractDate !== undefined) {
        pushSet("contract_date", body.newContractDate || null);
      }
      // 계약명 정정(2026-08-24) — 빈 값으로는 덮지 않는다(오기재 정정 전용).
      if (typeof body.newContractTitle === "string" && body.newContractTitle.trim()) {
        pushSet("contract_title", body.newContractTitle.trim());
      }
      // 계약 종류 변경(2026-08-26) — 일반 계약으로 등록했다가 실제로는 단가 계약(추가 기성 발생)인
      // 건을 변경계약에서 바로잡는다. 허용값 외에는 무시한다.
      if (body.newContractKind === "standard" || body.newContractKind === "unit_price") {
        pushSet("contract_kind", body.newContractKind);
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
      // 발주처(계약상대 업체) 변경(2026-08-24) — 엑셀 임포트 오기재 정정용(한솔제지 실사례).
      if (typeof body.newCounterpartyFacilityId === "string" && body.newCounterpartyFacilityId.trim()) {
        pushSet("counterparty_facility_id", body.newCounterpartyFacilityId.trim());
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
      // 금액 탭의 '변경 금액'을 실제 청구·수금 단계 금액에 반영(2026-08-26 사용자 리포트).
      // 종전에는 변경 이벤트 이력과 contracts.current_amount 만 갱신하고 단계 금액은 그대로 두어,
      // 감액(국일인토트 5,000만→3,000만 실사례)이 화면에 전혀 반영되지 않았다.
      // 2026-09-03 보완: ① $금액 파라미터가 amount(double)와 CASE 정수 비교에 섞여 쓰여
      // "inconsistent types deduced for parameter" 로 저장 전체가 실패했다 → ::double precision 명시.
      // ② 단계명을 바꾸면 라벨 매칭이 빗나가 반영이 안 됐다 → 모달이 보내는 milestoneId 우선 매칭,
      //    라벨 매칭도 실패한 신규 행(모달 '+단계 추가')은 새 단계로 INSERT 한다.
      const amountRows = Array.isArray((payload as { amounts?: unknown }).amounts)
        ? ((payload as { amounts: unknown[] }).amounts as Record<string, unknown>[])
        : [];
      let milestoneUpdates = 0;
      // 금액이 바뀌면 수금비율(기준액 대비)·수금완료 판정도 새 금액 기준으로 다시 계산한다.
      // 실제 입금액(collected_amount)은 사실이라 그대로 두고 비율만 파생 재계산.
      const amountRecalcSql = `
              SET amount = $3::double precision,
                  stage_label = $5,
                  collection_ratio = CASE
                    WHEN $3::double precision > 0
                      THEN ROUND((COALESCE(collected_amount, 0) / $3::double precision)::numeric, 3)
                    ELSE collection_ratio END,
                  payment_collected = CASE
                    WHEN $3::double precision > 0
                      THEN (CASE WHEN COALESCE(collected_amount, 0) >= $3::double precision - 1 THEN 1 ELSE 0 END)
                    ELSE payment_collected END,
                  updated_at = $4`;
      for (const row of amountRows) {
        const rowMilestoneId = String(row?.milestoneId ?? "").trim();
        const label = String(row?.stageLabel ?? "").trim();
        const nextRaw = String(row?.nextAmount ?? "").trim();
        const amount = nextRaw ? Number(nextRaw.replace(/[^\d.-]/g, "")) : null;
        const hasAmount = amount != null && Number.isFinite(amount);
        if (!label) continue;

        if (rowMilestoneId) {
          // 기존 단계 — 단계명은 항상 갱신, 금액은 새 값이 입력된 경우만(빈 값 = 유지).
          if (hasAmount) {
            await db.run(
              `UPDATE contract_payment_milestones ${amountRecalcSql}
                WHERE contract_id = $1 AND milestone_id = $2`,
              [contractId, rowMilestoneId, amount, now, label]
            );
          } else {
            await db.run(
              `UPDATE contract_payment_milestones SET stage_label = $3, updated_at = $4
                WHERE contract_id = $1 AND milestone_id = $2 AND stage_label <> $3`,
              [contractId, rowMilestoneId, label, now]
            );
          }
          milestoneUpdates += 1;
          continue;
        }

        if (!hasAmount) continue;
        // milestoneId 가 없는 행(구버전 payload·차수 파생 단계) — 라벨 매칭 폴백.
        const updated = rowsToObjects(
          await db.exec(
            `UPDATE contract_payment_milestones ${amountRecalcSql}
              WHERE contract_id = $1 AND stage_label = $2
              RETURNING milestone_id`,
            [contractId, label, amount, now, label]
          )
        );
        if (updated.length === 0) {
          // 모달 '+단계 추가'로 새로 만든 행 — 청구·수금 단계로 실제 생성한다.
          const maxRow = rowsToObjects(
            await db.exec(
              "SELECT COALESCE(MAX(stage_order), 0) AS max_order FROM contract_payment_milestones WHERE contract_id = $1",
              [contractId]
            )
          );
          const stageOrder = Number(maxRow[0]?.max_order ?? 0) + 1;
          const milestoneId = "mil_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
          await db.run(
            `INSERT INTO contract_payment_milestones
              (milestone_id, contract_id, stage_key, stage_label, stage_order, amount,
               invoice_issued, payment_collected, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, $7)`,
            [milestoneId, contractId, `stage_${stageOrder}_${milestoneId.slice(-6)}`, label, stageOrder, amount, now]
          );
        }
        milestoneUpdates += 1;
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
        after: { contractId, changeId, payload, changedFields, deltaAmount, milestoneUpdates },
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
    "EPC",
    "THIRD_PARTY_PARTNER",
    "ETC",
  ].includes(text)
    ? text
    : null;
}
