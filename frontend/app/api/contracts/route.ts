import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { listContracts, type ContractListFilter } from "@/lib/ieps/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const id = () => "ctr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
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
    };
    return NextResponse.json(await listContracts(filter));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireEditor();
    const body = await req.json();
    const contractTitle = String(body.contractTitle ?? "").trim();
    const counterpartyEntityId = String(body.counterpartyEntityId ?? "").trim();
    if (!contractTitle) return NextResponse.json({ error: "계약명은 필수입니다." }, { status: 400 });
    if (!counterpartyEntityId) return NextResponse.json({ error: "계약상대 법인은 필수입니다." }, { status: 400 });

    const contractId = id();
    const now = new Date().toISOString();
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO contracts
          (contract_id, facility_id, counterparty_entity_id, operating_relation_id,
           contract_title, service_type, service_subtype, contract_kind, contract_status, contract_amount,
           legacy_contract_no, legacy_company_id, contract_direction, industry_category,
           contract_date, started_at, ended_at, original_amount, current_amount,
           memo, created_at, updated_at)
         VALUES
          ($1, $2, $3, $4,
           $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14,
           $15, $16, $17, $18, $19,
           $20, $21, $22)`,
        [
          contractId,
          body.facilityId || null,
          counterpartyEntityId,
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
          body.memo || null,
          now,
          now,
        ]
      );
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
