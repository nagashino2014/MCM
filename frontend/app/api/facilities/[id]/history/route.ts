import { NextRequest, NextResponse } from "next/server";
import {
  authErrorToResponse,
  requireAuthenticated,
  requireEditor,
} from "@/lib/auth/guards";
import { getDb, invalidateDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import {
  FacilityHistoryEvent,
  normalizeFacilityHistoryEventType,
  type FacilityHistoryEventType,
} from "@/lib/ieps/facility-legacy";
import { normalizeBusinessRegistrationNo, normalizeCompanyName } from "@/lib/ieps/formatters";
import { extractRegion } from "@scraper/lib/ieps/region";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface HistoryBody {
  eventType?: FacilityHistoryEventType;
  eventTypes?: FacilityHistoryEventType[] | null;
  eventDate?: string | null;
  previousCompanyName?: string | null;
  newCompanyName?: string | null;
  previousBusinessRegistrationNo?: string | null;
  newBusinessRegistrationNo?: string | null;
  previousGroupName?: string | null;
  newGroupName?: string | null;
  previousSiteAddress?: string | null;
  newSiteAddress?: string | null;
  acquirerCompanyName?: string | null;
  mergerTargetCompanyNames?: (string | null | undefined)[] | null;
  relatedCompanyName?: string | null;
  memo?: string | null;
}

const nullableText = (value: unknown): string | null => {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

// 선택된 이력 유형 집합을 정규화하고, 대표(단일) event_type을 우선순위에 따라 결정한다.
const EVENT_TYPE_PRIORITY: FacilityHistoryEventType[] = [
  "company_name_change",
  "business_registration_no_change",
  "site_address_change",
  "group_change",
  "acquisition",
  "merger",
  "closure",
];

function resolveEventTypes(body: HistoryBody): {
  eventTypes: FacilityHistoryEventType[];
  primary: FacilityHistoryEventType;
} {
  const raw = Array.isArray(body.eventTypes) && body.eventTypes.length
    ? body.eventTypes
    : body.eventType
    ? [body.eventType]
    : [];
  const normalized = Array.from(new Set(raw.map((value) => normalizeFacilityHistoryEventType(value))));
  const primary =
    EVENT_TYPE_PRIORITY.find((type) => normalized.includes(type)) ?? normalized[0] ?? "manual_note";
  return { eventTypes: normalized.length ? normalized : [primary], primary };
}

function normalizeMergerTargets(value: HistoryBody["mergerTargetCompanyNames"]): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item ?? "").toString().trim())
    .filter((item) => item.length > 0);
}

function parseStringArray(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((item) => String(item)).filter(Boolean);
  const text = String(raw).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    /* JSON 아님: 단일 값으로 취급 */
  }
  return [text];
}

function parseEventTypes(raw: unknown, fallback: FacilityHistoryEventType): FacilityHistoryEventType[] {
  const list = parseStringArray(raw).map((value) => normalizeFacilityHistoryEventType(value));
  return list.length ? Array.from(new Set(list)) : [fallback];
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { id } = await ctx.params;
    invalidateDb();
    const db = await getDb();
    const result = await db.exec(
      `SELECT id, facility_id, event_type, event_types, event_date, previous_company_name, new_company_name,
              previous_business_registration_no, new_business_registration_no,
              previous_group_name, new_group_name, previous_site_address, new_site_address,
              acquirer_company_name, merger_target_company_names,
              related_company_name, source_facility_id,
              memo, source, created_at, created_by
         FROM facility_history_events
        WHERE facility_id = $1
        ORDER BY COALESCE(event_date, created_at) DESC, id DESC`,
      [id]
    );
    return NextResponse.json({
      items: rowsToObjects(result).map((row) => ({
        id: Number(row.id),
        facilityId: String(row.facility_id ?? ""),
        eventType: normalizeFacilityHistoryEventType(row.event_type),
        eventTypes: parseEventTypes(row.event_types, normalizeFacilityHistoryEventType(row.event_type)),
        eventDate: row.event_date != null ? String(row.event_date) : null,
        previousCompanyName:
          row.previous_company_name != null ? String(row.previous_company_name) : null,
        newCompanyName: row.new_company_name != null ? String(row.new_company_name) : null,
        previousBusinessRegistrationNo:
          row.previous_business_registration_no != null
            ? String(row.previous_business_registration_no)
            : null,
        newBusinessRegistrationNo:
          row.new_business_registration_no != null
            ? String(row.new_business_registration_no)
            : null,
        previousGroupName:
          row.previous_group_name != null ? String(row.previous_group_name) : null,
        newGroupName: row.new_group_name != null ? String(row.new_group_name) : null,
        previousSiteAddress:
          row.previous_site_address != null ? String(row.previous_site_address) : null,
        newSiteAddress: row.new_site_address != null ? String(row.new_site_address) : null,
        acquirerCompanyName:
          row.acquirer_company_name != null ? String(row.acquirer_company_name) : null,
        mergerTargetCompanyNames: parseStringArray(row.merger_target_company_names),
        relatedCompanyName:
          row.related_company_name != null ? String(row.related_company_name) : null,
        sourceFacilityId:
          row.source_facility_id != null ? String(row.source_facility_id) : null,
        memo: row.memo != null ? String(row.memo) : null,
        source: row.source != null ? String(row.source) : "manual",
        createdAt: String(row.created_at ?? ""),
        createdBy: row.created_by != null ? String(row.created_by) : null,
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { id } = await ctx.params;
    const body = (await req.json()) as HistoryBody;
    const now = new Date().toISOString();
    const { eventTypes, primary } = resolveEventTypes(body);
    const event = new FacilityHistoryEvent({
      facilityId: id,
      eventType: primary,
      eventTypes,
      eventDate: nullableText(body.eventDate),
      previousCompanyName: nullableText(body.previousCompanyName),
      newCompanyName: nullableText(body.newCompanyName),
      previousBusinessRegistrationNo: nullableText(body.previousBusinessRegistrationNo),
      newBusinessRegistrationNo: nullableText(body.newBusinessRegistrationNo),
      previousGroupName: nullableText(body.previousGroupName),
      newGroupName: nullableText(body.newGroupName),
      previousSiteAddress: nullableText(body.previousSiteAddress),
      newSiteAddress: nullableText(body.newSiteAddress),
      acquirerCompanyName: nullableText(body.acquirerCompanyName),
      mergerTargetCompanyNames: normalizeMergerTargets(body.mergerTargetCompanyNames),
      relatedCompanyName: nullableText(body.relatedCompanyName),
      sourceFacilityId: null,
      memo: nullableText(body.memo),
      source: "manual",
      createdAt: now,
      createdBy: actor.userId,
    });

    await withDbWrite(async (db) => {
      const exists = await db.exec("SELECT facility_id FROM facilities WHERE facility_id = $1 LIMIT 1", [id]);
      if (!exists.length || !exists[0].values.length) throw new Error("facility not found");
      await db.run(
        `INSERT INTO facility_history_events
          (facility_id, event_type, event_date, previous_company_name, new_company_name,
           previous_business_registration_no, new_business_registration_no,
           previous_group_name, new_group_name, related_company_name, source_facility_id,
           memo, source, created_at, created_by,
           previous_site_address, new_site_address, acquirer_company_name,
           merger_target_company_names, event_types)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19, $20)`,
        event.toDbParams() as any[]
      );

      // 이력 추가 시 입력된 신규값을 사업장 본 레코드(상호/사업자번호/소재지)에도 반영한다.
      // 계열/그룹은 그룹 관리 모달이 group-membership API로 직접 반영하므로 여기서는 건드리지 않는다.
      const facilitySetClauses: string[] = [];
      const facilityValues: unknown[] = [];
      const pushFacilitySet = (column: string, value: unknown) => {
        facilitySetClauses.push(`${column} = $${facilityValues.length + 1}`);
        facilityValues.push(value);
      };
      if (event.newCompanyName) {
        const formattedCompanyName = normalizeCompanyName(event.newCompanyName) ?? event.newCompanyName;
        pushFacilitySet("company_name", formattedCompanyName);
        const norm = formattedCompanyName
          .replace(/\s+/g, "")
          .replace(/[\(\)（）]/g, "")
          .trim()
          .toLowerCase();
        pushFacilitySet("normalized_company_name", norm);
      }
      if (event.newBusinessRegistrationNo) {
        pushFacilitySet(
          "business_registration_no",
          normalizeBusinessRegistrationNo(event.newBusinessRegistrationNo)
        );
      }
      if (event.newSiteAddress) {
        // 사용자가 입력한 소재지는 자동 띄어쓰기 로직을 적용하지 않고 그대로 저장한다.
        const verbatimAddress = event.newSiteAddress.replace(/\s+/g, " ").trim() || null;
        pushFacilitySet("site_address", verbatimAddress);
        pushFacilitySet("site_address_verbatim", true);
        pushFacilitySet("normalized_address", verbatimAddress);
        const region = extractRegion(verbatimAddress);
        pushFacilitySet("region_sido", region.sido);
        pushFacilitySet("region_sigungu", region.sigungu);
      }
      if (facilitySetClauses.length) {
        pushFacilitySet("updated_at", now);
        facilityValues.push(id);
        await db.run(
          `UPDATE facilities SET ${facilitySetClauses.join(", ")} WHERE facility_id = $${facilityValues.length}`,
          facilityValues as any[]
        );
      }

      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_history_create",
        targetTable: "facility_history_events",
        targetId: id,
        after: event,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
