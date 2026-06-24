import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getFacilityDetail } from "@/lib/ieps/queries";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { extractRegion } from "@scraper/lib/ieps/region";
import { normalizeBusinessRegistrationNo, normalizeCompanyName } from "@/lib/ieps/formatters";
import { normalizeFacilityCompanySize, type FacilityCompanySize } from "@/lib/ieps/facility-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const newTrashId = () => "trash_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("facility.view");
    const { id } = await ctx.params;
    const detail = await getFacilityDetail(id);
    if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PatchBody {
  companyName?: string;
  businessRegistrationNo?: string | null;
  representativeName?: string | null;
  siteAddress?: string | null;
  // 동일 사업자등록번호로 2개 이상의 소재지를 운영하는 사업장의 보조 소재지 목록.
  additionalSiteAddresses?: (string | null | undefined)[] | null;
  phoneNumber?: string | null;
  industryCode?: string | null;
  industryName?: string | null;
  businessCertificateBusinessType?: string | null;
  businessCertificateBusinessItem?: string | null;
  businessCertificateCorporateRegistrationNo?: string | null;
  memo?: string | null;
  logoPath?: string | null;
  companySize?: FacilityCompanySize | null;
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const body = (await req.json()) as PatchBody;
    const before = await getFacilityDetail(id);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

    await withDbWrite(async (db) => {
      const setClauses: string[] = [];
      const values: unknown[] = [];
      const pushSet = (column: string, value: unknown) => {
        setClauses.push(`${column} = $${values.length + 1}`);
        values.push(value);
      };

      if (body.companyName !== undefined) {
        const formattedCompanyName = normalizeCompanyName(body.companyName) ?? "";
        pushSet("company_name", formattedCompanyName);
        const norm = formattedCompanyName
          .replace(/\s+/g, "")
          .replace(/[\(\)（）]/g, "")
          .trim()
          .toLowerCase();
        pushSet("normalized_company_name", norm);
      }
      if (body.businessRegistrationNo !== undefined) {
        pushSet("business_registration_no", normalizeBusinessRegistrationNo(body.businessRegistrationNo));
      }
      if (body.representativeName !== undefined) {
        pushSet("representative_name", body.representativeName?.trim() || null);
      }
      if (body.siteAddress !== undefined) {
        // 사용자가 편집 화면에서 직접 입력한 소재지는 시군구동 구분(자동 띄어쓰기) 로직을
        // 적용하지 않고 입력값을 그대로 저장한다. (앞뒤/중복 공백만 정리)
        const verbatimAddress = (body.siteAddress ?? "").replace(/\s+/g, " ").trim() || null;
        pushSet("site_address", verbatimAddress);
        pushSet("site_address_verbatim", true);
        pushSet("normalized_address", verbatimAddress);
        const region = extractRegion(verbatimAddress);
        pushSet("region_sido", region.sido);
        pushSet("region_sigungu", region.sigungu);
      }
      if (body.additionalSiteAddresses !== undefined) {
        const primary =
          body.siteAddress !== undefined
            ? (body.siteAddress ?? "").replace(/\s+/g, " ").trim()
            : before.siteAddress
            ? before.siteAddress.replace(/\s+/g, " ").trim()
            : "";
        const list = Array.isArray(body.additionalSiteAddresses)
          ? body.additionalSiteAddresses
              .map((addr) => (addr ?? "").replace(/\s+/g, " ").trim())
              .filter((addr) => !!addr && addr !== primary)
          : [];
        pushSet("additional_site_addresses", list.length ? JSON.stringify(list) : null);
      }
      if (body.phoneNumber !== undefined) {
        pushSet("phone_number", body.phoneNumber);
      }
      if (body.industryCode !== undefined) {
        pushSet("industry_code", body.industryCode);
      }
      if (body.industryName !== undefined) {
        pushSet("industry_name", body.industryName);
      }
      if (body.businessCertificateBusinessType !== undefined) {
        pushSet("business_certificate_business_type", normalizeNullableText(body.businessCertificateBusinessType));
      }
      if (body.businessCertificateBusinessItem !== undefined) {
        pushSet("business_certificate_business_item", normalizeNullableText(body.businessCertificateBusinessItem));
      }
      if (body.businessCertificateCorporateRegistrationNo !== undefined) {
        const corporateNo = normalizeCorporateRegistrationNo(body.businessCertificateCorporateRegistrationNo);
        pushSet("business_certificate_corporate_registration_no", corporateNo);
        pushSet("corporate_registration_no", corporateNo);
      }
      if (body.memo !== undefined) {
        pushSet("memo", body.memo);
      }
      if (body.logoPath !== undefined) {
        pushSet("logo_path", body.logoPath);
      }
      if (body.companySize !== undefined) {
        pushSet("company_size", normalizeFacilityCompanySize(body.companySize));
      }
      if (setClauses.length === 0) return;
      pushSet("updated_at", new Date().toISOString());
      values.push(id);
      await db.run(
        `UPDATE facilities SET ${setClauses.join(", ")} WHERE facility_id = $${values.length}`,
        values as any[]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_update",
        targetTable: "facilities",
        targetId: id,
        before,
        after: body,
      });
    });

    const after = await getFacilityDetail(id);
    return NextResponse.json(after);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function normalizeNullableText(value?: string | null): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeCorporateRegistrationNo(value?: string | null): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 13) return `${digits.slice(0, 6)}-${digits.slice(6)}`;
  const text = String(value ?? "").trim();
  return text || null;
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.delete", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const deleteReason = String(body?.deleteReason ?? "사용자 요청").trim() || "사용자 요청";
    const before = await getFacilityDetail(id);
    if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
    const now = new Date().toISOString();

    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO trash_items
          (trash_id, item_type, item_id, item_title, reason, before_json, deleted_by, deleted_at)
         VALUES ($1, 'facility', $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          newTrashId(),
          id,
          before.companyName,
          deleteReason,
          JSON.stringify(before),
          actor.userId,
          now,
        ]
      );
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "facility_delete",
        targetTable: "facilities",
        targetId: id,
        before,
        after: { movedToTrash: true, deleteReason },
      });
      await db.run(
        "UPDATE facilities SET deleted_at = $1, deleted_by = $2, delete_reason = $3, updated_at = $1 WHERE facility_id = $4",
        [now, actor.userId, deleteReason, id]
      );
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
