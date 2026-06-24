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
 *   3. source facility 행 삭제.
 *   4. audit_log 에 facility_merge 기록 (before: source 데이터, after: target 데이터).
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
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
