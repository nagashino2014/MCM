import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { resolveVisibleContractIds } from "@/lib/auth/contract-scope";
import { listContracts, type ContractListFilter } from "@/lib/ieps/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = () => "ctr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("contract.view");
    const contractIds = await resolveVisibleContractIds(ctx.userId, "contract.view");
    const { searchParams } = new URL(req.url);
    const filter: ContractListFilter = {
      q: searchParams.get("q") || undefined,
      year: searchParams.get("year") || undefined,
      serviceType: searchParams.get("serviceType") || undefined,
      status: searchParams.get("status") || undefined,
      collection: parseCollection(searchParams.get("collection")),
      sort: parseSort(searchParams.get("sort")),
      limit: clampLimit(Number(searchParams.get("limit") ?? "50")),
      offset: Math.max(0, Number(searchParams.get("offset") ?? "0")),
      contractIds,
      facilityId: searchParams.get("facilityId") || undefined,
      dateFrom: parseIsoDate(searchParams.get("dateFrom")),
    };
    return NextResponse.json(await listContracts(filter));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"] });
    const body = await req.json();
    const contractTitle = String(body.contractTitle ?? "").trim();
    const counterpartyFacilityId = String(body.counterpartyFacilityId ?? "").trim();
    const facilityIds = normalizeStringArray(body.facilityIds);
    if (!contractTitle) return NextResponse.json({ error: "계약명은 필수입니다." }, { status: 400 });
    if (!counterpartyFacilityId) return NextResponse.json({ error: "계약상대 업체는 필수입니다." }, { status: 400 });

    const contractId = id();
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      // 수행부서·수행인력은 계약 등록자와 무관하다(등록은 영업관리본부가 대행). 명시 입력이 없으면
      // 해당 부서장·담당자가 별도로 지정할 때까지 비워 둔다.
      const owningDeptId =
        (typeof body.owningDeptId === "string" && body.owningDeptId.trim()) || null;

      await db.run(
        `INSERT INTO contracts
          (contract_id, facility_id, counterparty_facility_id, operating_relation_id,
           contract_title, service_type, service_subtype, contract_kind, contract_status, contract_amount,
           legacy_contract_no, legacy_company_id, contract_direction, industry_category,
           contract_date, started_at, ended_at, original_amount, current_amount,
           payment_method, ordering_subject_type, memo, owning_dept_id, created_at, updated_at)
         VALUES
          ($1, $2, $3, $4,
           $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14,
           $15, $16, $17, $18, $19,
           $20, $21, $22, $23, $24, $25)`,
        [
          contractId,
          facilityIds[0] || body.facilityId || null,
          counterpartyFacilityId,
          body.operatingRelationId || null,
          contractTitle,
          body.serviceType || null,
          body.serviceSubtype || null,
          body.contractKind || "standard",
          body.contractStatus || "active",
          toNullableNumber(body.contractAmount),
          body.legacyContractNo || null,
          body.legacyCompanyId || null,
          body.contractDirection || "sales",
          body.industryCategory || null,
          body.contractDate || null,
          body.startedAt || null,
          body.endedAt || null,
          toNullableNumber(body.originalAmount ?? body.contractAmount),
          toNullableNumber(body.currentAmount ?? body.contractAmount),
          body.paymentMethod || null,
          normalizeOrderingSubjectType(body.orderingSubjectType),
          body.memo || null,
          owningDeptId,
          now,
          now,
        ]
      );
      for (const facilityId of facilityIds) {
        await db.run(
          `INSERT INTO contract_facilities
            (contract_id, facility_id, relation_type, created_at, updated_at)
           VALUES ($1, $2, 'integrated_permit_target', $3, $4)
           ON CONFLICT (contract_id, facility_id, relation_type) DO UPDATE SET updated_at = excluded.updated_at`,
          [contractId, facilityId, now, now]
        );
      }
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_create",
        targetTable: "contracts",
        targetId: contractId,
        after: body,
      });
    });

    return NextResponse.json({ contractId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function parseIsoDate(value: string | null): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function parseCollection(value: string | null): ContractListFilter["collection"] {
  if (value === "unissued" || value === "uncollected" || value === "issued" || value === "collected") return value;
  return undefined;
}

function parseSort(value: string | null): ContractListFilter["sort"] {
  if (value === "amount" || value === "date" || value === "recent") return value;
  return "recent";
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(200, n);
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
