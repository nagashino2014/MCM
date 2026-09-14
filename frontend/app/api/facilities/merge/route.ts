/**
 * 중복 사업장 병합.
 *
 * POST /api/facilities/merge
 *   {
 *     "targetId": "fac_xxx",       // 흡수 후 살아남는 facility
 *     "sourceIds": ["fac_yyy", ...], // target 으로 흡수될 facility 목록
 *     "fieldOverrides": {           // (선택) 필드별 어느 facility 의 값을 사용할지
 *       "company_name": "fac_yyy",   // facility_id 또는 'target'
 *       "business_registration_no": "target",
 *       ...
 *     },
 *     "mergeReason": "company_change" // 상호 변경 | 합병 | 중복 제거 | 기타
 *   }
 *
 * 동작:
 *   1. target 의 컬럼을 fieldOverrides 에 따라 갱신.
 *   2. permits / parsed_fields 의 facility_id / 외래 참조를 target 으로 재할당.
 *      - permits.facility_id = target
 *      - permit_scales / product_outputs 는 permits를 통해 자동 follow
 *      - parsed_fields 는 attachment 단위라 별도 재할당 불필요(원본 그대로 유지)
 *   3. ★ source 를 가리키는 나머지 모든 참조(계약·사업장 부속정보·연락처·재무 등)를 target 으로 재할당
 *      (FACILITY_REF_COLUMNS / FACILITY_REF_UNIQUE_GUARDED). 종전에는 permits 만 옮겨서
 *      ① contracts.counterparty_facility_id 같은 ON DELETE RESTRICT 참조가 있으면 병합이 실패하고
 *      ② ON DELETE CASCADE 참조(대상사업장·사업자등록증·연차보고서 등)는 조용히 삭제됐다
 *      (2026-09-14 효성화학 4중복 병합 실패 리포트로 발견).
 *   4. source facility 행 삭제.
 *   5. audit_log 에 facility_merge 기록 (before: source 데이터, after: target 데이터).
 */

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { extractRegion } from "@scraper/lib/ieps/region";
import {
  normalizeAddress,
  normalizeBusinessRegistrationNo,
  normalizeCompanyName,
} from "@/lib/ieps/formatters";
import {
  FacilityHistoryEvent,
  FacilityLegacyIdentity,
  FacilityPermitSuccession,
  normalizeFacilityMergeReason,
  type FacilityMergeReason,
  type FacilityHistoryEventType,
} from "@/lib/ieps/facility-legacy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MergeBody {
  targetId: string;
  sourceIds: string[];
  fieldOverrides?: Record<string, string>;
  mergeReason?: FacilityMergeReason;
}

const MERGEABLE_FIELDS = [
  "company_name",
  "business_registration_no",
  "site_address",
  "phone_number",
  "industry_code",
  "industry_name",
  "memo",
] as const;

/**
 * source facility 를 가리키는 참조 중 **중복 걱정 없이 그대로 옮길 수 있는** 것들.
 * (대리키 PK 라 같은 facility 행이 둘 있어도 무방한 테이블)
 * permits 는 승계 이력을 따로 남기므로 아래 본문에서 별도 처리한다.
 */
const FACILITY_REF_COLUMNS: Array<{ table: string; column: string }> = [
  // 계약 — counterparty_facility_id 는 ON DELETE RESTRICT 라 재할당하지 않으면 병합이 아예 실패한다.
  { table: "contracts", column: "counterparty_facility_id" },
  { table: "contracts", column: "facility_id" },
  { table: "contract_outsourcing", column: "counterparty_facility_id" },
  { table: "contract_agreements", column: "counterparty_facility_id" },
  { table: "agreement_templates", column: "origin_facility_id" },
  { table: "deliverable_templates", column: "owner_facility_id" },
  { table: "work_plan_items", column: "facility_id" },
  // 사업장 부속 정보 — ON DELETE CASCADE 라 재할당하지 않으면 source 삭제와 함께 사라진다.
  { table: "facility_business_certificates", column: "facility_id" },
  { table: "facility_aliases", column: "facility_id" },
  { table: "facility_manual_products", column: "facility_id" },
  { table: "facility_contact_people", column: "facility_id" },
  { table: "facility_contact_departments", column: "facility_id" },
  { table: "facility_contact_logs", column: "facility_id" },
  // 영업·견적·정보
  { table: "sales_projects", column: "facility_id" },
  { table: "intel_signals", column: "facility_id" },
  { table: "quotation_sites", column: "facility_id" },
  // 재무 — 수금 자동대조 학습/판정과 세금계산서 귀속(FK 는 없지만 논리 참조)
  { table: "bank_remitter_links", column: "facility_id" },
  { table: "recon_matches", column: "matched_facility_id" },
  { table: "tax_invoices", column: "invoicee_facility_id" },
];

/**
 * facility 컬럼이 PK/UNIQUE 의 일부라 그대로 옮기면 중복 충돌이 나는 참조.
 * target 에 같은 키의 행이 이미 있으면 source 행을 버리고(=target 값 우선), 없으면 옮긴다.
 * keys = facility 컬럼과 함께 유일성을 이루는 나머지 컬럼.
 */
const FACILITY_REF_UNIQUE_GUARDED: Array<{ table: string; column: string; keys: string[] }> = [
  { table: "contract_facilities", column: "facility_id", keys: ["contract_id", "relation_type"] },
  { table: "facility_facility_info", column: "facility_id", keys: [] },
  { table: "facility_order_info", column: "facility_id", keys: [] },
  { table: "facility_annual_reports", column: "facility_id", keys: [] },
  { table: "facility_facility_documents", column: "facility_id", keys: ["doc_type"] },
  { table: "facility_contact_main_numbers", column: "facility_id", keys: [] },
  { table: "facility_group_memberships", column: "facility_id", keys: [] },
  { table: "facility_service_categories", column: "facility_id", keys: ["category"] },
];

function historyTypeFromMergeReason(reason: FacilityMergeReason): FacilityHistoryEventType {
  if (reason === "company_change") return "company_name_change";
  if (reason === "acquisition") return "acquisition";
  return "manual_note";
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("facility.merge", { fallbackRoles: ["editor"] });
    const body = (await req.json()) as MergeBody;
    if (!body?.targetId || !Array.isArray(body.sourceIds) || body.sourceIds.length === 0) {
      return NextResponse.json(
        { error: "targetId 와 1개 이상의 sourceIds 가 필요합니다." },
        { status: 400 }
      );
    }
    if (body.sourceIds.includes(body.targetId)) {
      return NextResponse.json(
        { error: "target 은 sourceIds 에 포함될 수 없습니다." },
        { status: 400 }
      );
    }

    const result = await withDbWrite(async (db) => {
      // 모든 facility row 로드
      const allIds = [body.targetId, ...body.sourceIds];
      const placeholders = allIds.map((_, i) => `$${i + 1}`).join(",");
      const r = await db.exec(
        `SELECT facility_id, company_name, business_registration_no, site_address, phone_number,
                industry_code, industry_name, normalized_company_name, normalized_address,
                region_sido, region_sigungu, source, memo, created_at, updated_at
         FROM facilities WHERE facility_id IN (${placeholders})`,
        allIds
      );
      if (!r.length) throw new Error("facility 를 찾을 수 없습니다.");
      const cols = r[0].columns;
      const rowsByid = new Map<string, Record<string, unknown>>();
      for (const v of r[0].values) {
        const obj: Record<string, unknown> = {};
        cols.forEach((c, i) => (obj[c] = v[i]));
        rowsByid.set(String(obj.facility_id), obj);
      }
      const target = rowsByid.get(body.targetId);
      if (!target) throw new Error("target facility 를 찾을 수 없습니다.");
      for (const sid of body.sourceIds) {
        if (!rowsByid.has(sid)) throw new Error("source facility " + sid + " 를 찾을 수 없습니다.");
      }

      // 필드별 우선순위 적용 → target 갱신
      const fieldOverrides = body.fieldOverrides ?? {};
      const mergeReason = normalizeFacilityMergeReason(body.mergeReason);
      const updatedTarget: Record<string, unknown> = { ...target };
      for (const field of MERGEABLE_FIELDS) {
        const choice = fieldOverrides[field];
        if (!choice || choice === "target") continue;
        if (choice === body.targetId) continue;
        const src = rowsByid.get(choice);
        if (!src) continue;
        updatedTarget[field] = src[field] ?? null;
      }

      // 필드 변경분이 있으면 표시값과 normalized 키를 같은 규칙으로 재계산
      const newCompany = normalizeCompanyName(String(updatedTarget.company_name ?? "")) ?? "";
      const newAddress = normalizeAddress(updatedTarget.site_address as string | null);
      updatedTarget.company_name = newCompany;
      updatedTarget.business_registration_no = normalizeBusinessRegistrationNo(
        updatedTarget.business_registration_no as string | null
      );
      updatedTarget.site_address = newAddress;
      updatedTarget.normalized_company_name = newCompany
        ? newCompany.replace(/\s+/g, "").replace(/[\(\)（）]/g, "").trim().toLowerCase()
        : null;
      updatedTarget.normalized_address = newAddress ? newAddress.replace(/\s+/g, " ").trim() : null;
      const region = extractRegion(newAddress ?? null);
      updatedTarget.region_sido = region.sido;
      updatedTarget.region_sigungu = region.sigungu;
      updatedTarget.updated_at = new Date().toISOString();

      // target UPDATE
      await db.run(
        `UPDATE facilities SET
           company_name = $1, business_registration_no = $2, site_address = $3, phone_number = $4,
           industry_code = $5, industry_name = $6, normalized_company_name = $7, normalized_address = $8,
           region_sido = $9, region_sigungu = $10, memo = $11, updated_at = $12
         WHERE facility_id = $13`,
        ([
          updatedTarget.company_name,
          updatedTarget.business_registration_no,
          updatedTarget.site_address,
          updatedTarget.phone_number,
          updatedTarget.industry_code,
          updatedTarget.industry_name,
          updatedTarget.normalized_company_name,
          updatedTarget.normalized_address,
          updatedTarget.region_sido,
          updatedTarget.region_sigungu,
          updatedTarget.memo,
          updatedTarget.updated_at,
          body.targetId,
        ] as any[])
      );

      const aliases: FacilityLegacyIdentity[] = body.sourceIds.map((sid) => {
        const src = rowsByid.get(sid)!;
        return new FacilityLegacyIdentity({
          targetFacilityId: body.targetId,
          sourceFacilityId: sid,
          previousCompanyName: src.company_name != null ? String(src.company_name) : null,
          previousBusinessRegistrationNo:
            src.business_registration_no != null ? String(src.business_registration_no) : null,
          mergeReason,
          createdAt: String(updatedTarget.updated_at),
          createdBy: actor.userId,
        });
      });
      const targetCompanyChanged = target.company_name !== updatedTarget.company_name;
      const targetBrnChanged =
        target.business_registration_no !== updatedTarget.business_registration_no;
      if (targetCompanyChanged || targetBrnChanged) {
        aliases.push(
          new FacilityLegacyIdentity({
            targetFacilityId: body.targetId,
            sourceFacilityId: body.targetId,
            previousCompanyName: target.company_name != null ? String(target.company_name) : null,
            previousBusinessRegistrationNo:
              target.business_registration_no != null
                ? String(target.business_registration_no)
                : null,
            mergeReason,
            createdAt: String(updatedTarget.updated_at),
            createdBy: actor.userId,
          })
        );
      }
      for (const alias of aliases) {
        await db.run(
          `INSERT INTO facility_merge_aliases
            (target_facility_id, source_facility_id, previous_company_name,
             previous_business_registration_no, merge_reason, created_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          alias.toDbParams() as any[]
        );
      }

      const historyEvents = body.sourceIds.map((sid) => {
        const src = rowsByid.get(sid)!;
        return new FacilityHistoryEvent({
          facilityId: body.targetId,
          eventType: historyTypeFromMergeReason(mergeReason),
          eventDate: null,
          previousCompanyName: src.company_name != null ? String(src.company_name) : null,
          newCompanyName:
            updatedTarget.company_name != null ? String(updatedTarget.company_name) : null,
          previousBusinessRegistrationNo:
            src.business_registration_no != null ? String(src.business_registration_no) : null,
          newBusinessRegistrationNo:
            updatedTarget.business_registration_no != null
              ? String(updatedTarget.business_registration_no)
              : null,
          previousGroupName: null,
          newGroupName: null,
          relatedCompanyName: src.company_name != null ? String(src.company_name) : null,
          sourceFacilityId: sid,
          memo: "사업장 병합으로 이전 사업장 식별자와 허가 정보가 승계되었습니다.",
          source: "merge",
          createdAt: String(updatedTarget.updated_at),
          createdBy: actor.userId,
        });
      });
      if (targetCompanyChanged || targetBrnChanged) {
        historyEvents.push(
          new FacilityHistoryEvent({
            facilityId: body.targetId,
            eventType: targetBrnChanged
              ? "business_registration_no_change"
              : "company_name_change",
            eventDate: null,
            previousCompanyName: target.company_name != null ? String(target.company_name) : null,
            newCompanyName:
              updatedTarget.company_name != null ? String(updatedTarget.company_name) : null,
            previousBusinessRegistrationNo:
              target.business_registration_no != null
                ? String(target.business_registration_no)
                : null,
            newBusinessRegistrationNo:
              updatedTarget.business_registration_no != null
                ? String(updatedTarget.business_registration_no)
                : null,
            previousGroupName: null,
            newGroupName: null,
            relatedCompanyName: null,
            sourceFacilityId: body.targetId,
            memo: "병합 필드 우선순위 선택으로 target 사업장 식별자가 변경되었습니다.",
            source: "merge",
            createdAt: String(updatedTarget.updated_at),
            createdBy: actor.userId,
          })
        );
      }
      for (const event of historyEvents) {
        await db.run(
          `INSERT INTO facility_history_events
            (facility_id, event_type, event_date, previous_company_name, new_company_name,
             previous_business_registration_no, new_business_registration_no,
             previous_group_name, new_group_name, related_company_name, source_facility_id,
             memo, source, created_at, created_by, previous_site_address, new_site_address,
             acquirer_company_name, merger_target_company_names, event_types)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          event.toDbParams() as any[]
        );
      }

      // permits 재할당
      const sourcePh = body.sourceIds.map((_, i) => `$${i + 1}`).join(",");
      const permitRowsResult = await db.exec(
        `SELECT permit_id, facility_id, decision_no, permit_type, permit_date
           FROM permits WHERE facility_id IN (${sourcePh})`,
        body.sourceIds
      );
      const permitSuccessions: FacilityPermitSuccession[] = [];
      if (permitRowsResult.length) {
        const permitCols = permitRowsResult[0].columns;
        for (const values of permitRowsResult[0].values) {
          const permit: Record<string, unknown> = {};
          permitCols.forEach((col, i) => (permit[col] = values[i]));
          const sourceFacilityId = String(permit.facility_id ?? "");
          const sourceFacility = rowsByid.get(sourceFacilityId);
          if (!sourceFacility || !permit.permit_id) continue;
          permitSuccessions.push(
            new FacilityPermitSuccession({
              targetFacilityId: body.targetId,
              sourceFacilityId,
              permitId: String(permit.permit_id),
              decisionNo: permit.decision_no != null ? String(permit.decision_no) : null,
              permitType: permit.permit_type != null ? String(permit.permit_type) : null,
              permitDate: permit.permit_date != null ? String(permit.permit_date) : null,
              previousCompanyName:
                sourceFacility.company_name != null ? String(sourceFacility.company_name) : null,
              previousBusinessRegistrationNo:
                sourceFacility.business_registration_no != null
                  ? String(sourceFacility.business_registration_no)
                  : null,
              mergeReason,
              createdAt: String(updatedTarget.updated_at),
              createdBy: actor.userId,
            })
          );
        }
      }
      for (const succession of permitSuccessions) {
        await db.run(
          `INSERT INTO facility_permit_successions
            (target_facility_id, source_facility_id, permit_id, decision_no, permit_type,
             permit_date, previous_company_name, previous_business_registration_no,
             merge_reason, created_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          succession.toDbParams() as any[]
        );
      }
      const sourcePhShifted = body.sourceIds.map((_, i) => `$${i + 3}`).join(",");
      await db.run(
        `UPDATE permits SET facility_id = $1, updated_at = $2 WHERE facility_id IN (${sourcePhShifted})`,
        [body.targetId, updatedTarget.updated_at, ...body.sourceIds] as any[]
      );

      // ── source 를 가리키는 나머지 참조를 target 으로 재할당 ──────────────────────
      // 이걸 빠뜨리면 RESTRICT 참조(계약 발주처)는 삭제가 막혀 병합이 실패하고,
      // CASCADE 참조(대상사업장·사업자등록증·연차보고서·수주정보 등)는 source 와 함께 지워진다.
      const reassigned: Record<string, number> = {};
      const countRows = (result: Awaited<ReturnType<typeof db.exec>>) =>
        result.length ? result[0].values.length : 0;

      // (1) facility 컬럼이 유일성 키의 일부인 테이블 — target 에 같은 키가 이미 있으면 source 행을 버린다.
      //     (예: 같은 계약에 target·source 가 둘 다 대상사업장으로 걸린 경우)
      for (const { table, column, keys } of FACILITY_REF_UNIQUE_GUARDED) {
        const keyMatch = keys.map((k) => `x.${k} = s.${k}`).join(" AND ");
        const dropped = await db.exec(
          `DELETE FROM ${table} s
            WHERE s.${column} = ANY($2::text[])
              AND EXISTS (
                SELECT 1 FROM ${table} x
                 WHERE x.${column} = $1${keyMatch ? ` AND ${keyMatch}` : ""}
              )
            RETURNING 1`,
          [body.targetId, body.sourceIds]
        );
        const n = countRows(dropped);
        if (n > 0) reassigned[`${table}.${column}(중복 정리)`] = n;
      }

      // (2) 운영주체 — 부분 유일 인덱스(활성 대표 운영주체는 relation_type 당 1건)가 걸려 있어
      //     target 에 이미 대표가 있으면 source 쪽 대표 플래그를 내린 뒤 옮긴다(행 자체는 보존).
      await db.run(
        `UPDATE facility_operating_entities s
            SET is_primary = 0
          WHERE s.facility_id = ANY($2::text[]) AND s.ended_at IS NULL AND s.is_primary = 1
            AND EXISTS (
              SELECT 1 FROM facility_operating_entities x
               WHERE x.facility_id = $1 AND x.relation_type = s.relation_type
                 AND x.ended_at IS NULL AND x.is_primary = 1
            )`,
        [body.targetId, body.sourceIds]
      );

      // (3) 전체 재할당
      for (const { table, column } of [
        ...FACILITY_REF_COLUMNS,
        ...FACILITY_REF_UNIQUE_GUARDED.map(({ table: t, column: c }) => ({ table: t, column: c })),
        { table: "facility_operating_entities", column: "facility_id" },
        { table: "facility_operating_entities", column: "related_facility_id" },
      ]) {
        const moved = await db.exec(
          `UPDATE ${table} SET ${column} = $1 WHERE ${column} = ANY($2::text[]) RETURNING 1`,
          [body.targetId, body.sourceIds]
        );
        const n = countRows(moved);
        if (n > 0) reassigned[`${table}.${column}`] = n;
      }

      // (4) 병합으로 자기 자신을 운영주체로 가리키게 된 행은 의미가 없으므로 제거한다.
      await db.run(
        `DELETE FROM facility_operating_entities WHERE facility_id = $1 AND related_facility_id = $1`,
        [body.targetId]
      );

      // source facility 삭제 (FK CASCADE 가 permits 를 따라가지 않도록 위에서 미리 재할당했음)
      // SQLite ON DELETE CASCADE 는 permits → facility_id 인 경우 source 가 삭제되면 permits 가 삭제될 수 있음.
      // 위에서 facility_id 를 target 으로 변경했으므로 안전.
      await db.run(`DELETE FROM facilities WHERE facility_id IN (${sourcePh})`, body.sourceIds);

      // audit_log
      const before = body.sourceIds.map((sid) => rowsByid.get(sid));
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_merge",
        targetTable: "facilities",
        targetId: body.targetId,
        before: { sources: before, target },
        after: {
          merged: updatedTarget,
          fieldOverrides,
          mergeReason,
          reassigned,
          permitSuccessions: permitSuccessions.map((succession) => ({
            sourceFacilityId: succession.sourceFacilityId,
            permitId: succession.permitId,
            decisionNo: succession.decisionNo,
          })),
        },
      });

      return {
        mergedTo: body.targetId,
        removedSources: body.sourceIds,
        succeededPermits: permitSuccessions.length,
        reassigned,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
