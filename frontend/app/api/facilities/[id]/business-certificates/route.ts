import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { type BusinessCertificateKind } from "@/lib/ieps/business-certificate-parser";
import { analyzeBusinessCertificate, type CertificateAnalysis } from "@/lib/ieps/business-certificate-analysis";
import { certificateAnalysisWarning } from "@/lib/ieps/business-certificate-status";
import {
  buildFacilityBusinessCertificateStorageKey,
  putFacilityBusinessCertificate,
} from "@/lib/storage/facility-business-certificate-storage";
import { sanitizeFilename } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_BYTES = 30 * 1024 * 1024;

export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("facility.view");
    const { id } = await ctx.params;
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT c.*, u.name AS created_by_name, u.email AS created_by_email
           FROM facility_business_certificates c
           LEFT JOIN users u ON u.user_id = c.created_by
          WHERE c.facility_id = $1 AND c.parsed_json->>'deletedAt' IS NULL
          ORDER BY c.version_no DESC, c.created_at DESC`,
        [id]
      )
    );
    return NextResponse.json({ items: rows.map(mapCertificate) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id } = await ctx.params;
    const form = await req.formData();
    const file = form.get("file");
    const memo = String(form.get("memo") ?? "").trim() || null;
    const preParsed = buildPreParsedBusinessCertificate(form);
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "사업자등록증 PDF 파일을 첨부하세요." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "PDF 파일은 30MB 이하만 업로드할 수 있습니다." }, { status: 400 });
    }
    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
    }

    const db = await getDb();
    const facility = rowsToObjects(
      await db.exec("SELECT facility_id, company_name FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL", [id])
    )[0];
    if (!facility) return NextResponse.json({ error: "사업장을 찾을 수 없습니다." }, { status: 404 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const parsed = preParsed ?? await analyzeBusinessCertificate(file);
    const ocrText = parsed.ocrText;
    const certificateId = "fbc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date().toISOString();

    const { versionNo, stored } = await withDbWrite(async (txn) => {
      const lockedFacility = rowsToObjects(await txn.exec(
        "SELECT facility_id FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL FOR UPDATE", [id]
      ))[0];
      if (!lockedFacility) throw Object.assign(new Error("사업장을 찾을 수 없습니다."), { status: 404 });
      const versionRows = rowsToObjects(
        await txn.exec("SELECT COALESCE(MAX(version_no), 0) + 1 AS next_version FROM facility_business_certificates WHERE facility_id = $1", [id])
      );
      const versionNo = Number(versionRows[0]?.next_version ?? 1);
      const originalName = sanitizeFilename(file.name || "business-certificate.pdf");
      const { storageKey, fileName } = buildFacilityBusinessCertificateStorageKey({
        facilityId: id,
        companyName: String(facility.company_name ?? ""),
        versionNo,
        originalFilename: originalName,
      });
      const stored = await putFacilityBusinessCertificate(storageKey, buffer, file.type || "application/pdf");

      await txn.run("UPDATE facility_business_certificates SET is_current = 0, updated_at = $1 WHERE facility_id = $2", [now, id]);
      await txn.run(
        `INSERT INTO facility_business_certificates
          (certificate_id, facility_id, version_no, is_current, display_name, original_filename,
           content_type, byte_size, sha256, storage_provider, storage_bucket, storage_key, public_path,
           business_type, business_item, corporate_registration_no, ocr_text, parsed_json, memo,
           created_by, created_at, updated_at)
         VALUES
          ($1, $2, $3, 1, $4, $5,
           $6, $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $17::jsonb, $18,
           $19, $20, $21)`,
        [
          certificateId,
          id,
          versionNo,
          fileName,
          originalName,
          file.type || "application/pdf",
          file.size,
          sha256,
          stored.storageProvider,
          stored.storageBucket,
          stored.storageKey,
          stored.publicPath,
          parsed.businessType || null,
          parsed.businessItem || null,
          parsed.corporateRegistrationNo || null,
          ocrText || null,
          JSON.stringify({
            ...parsed,
            extractionWarning: parsed.warning,
            votedFields: "votedFields" in parsed ? parsed.votedFields : [],
            needsReviewFields: "needsReviewFields" in parsed ? parsed.needsReviewFields : [],
          }),
          memo,
          actor.userId,
          now,
          now,
        ]
      );
      await txn.run(
        `UPDATE facilities
            SET business_certificate_business_type = COALESCE($1, business_certificate_business_type),
                business_certificate_business_item = COALESCE($2, business_certificate_business_item),
                business_certificate_corporate_registration_no = COALESCE($3, business_certificate_corporate_registration_no),
                business_certificate_ocr_text = COALESCE($4, business_certificate_ocr_text),
                representative_name = COALESCE($5, representative_name),
                corporate_registration_no = COALESCE($3, corporate_registration_no),
                updated_at = $6
          WHERE facility_id = $7`,
        [
          parsed.businessType || null,
          parsed.businessItem || null,
          parsed.corporateRegistrationNo || null,
          ocrText || null,
          parsed.representativeName || null,
          now,
          id,
        ]
      );
      await recordAuditLogInline(txn, {
        actorUserId: actor.userId,
        action: "facility_update",
        targetTable: "facility_business_certificates",
        targetId: certificateId,
        after: { operation: "upload_certificate", facilityId: id, versionNo, storageKey, ...parsed, warning: parsed.warning },
      });
      return { versionNo, stored };
    });

    return NextResponse.json({
      certificateId,
      versionNo,
      publicPath: stored.publicPath,
      ...parsed,
      ocrText,
      warning: parsed.warning || null,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function buildPreParsedBusinessCertificate(form: FormData): CertificateAnalysis | null {
  if (form.get("useParsedResult") !== "1") return null;
  const businessType = formText(form, "businessType");
  const businessItem = formText(form, "businessItem");
  const corporateRegistrationNo = formText(form, "corporateRegistrationNo");
  const ocrText = formText(form, "ocrText");
  const representativeName = formText(form, "representativeName");
  const businessKinds = buildBusinessKinds(businessType, businessItem);
  return {
    companyName: "",
    businessRegistrationNo: "",
    representativeName,
    siteAddress: "",
    businessType,
    businessItem,
    businessKinds,
    corporateRegistrationNo,
    ocrText,
    extractionMethod: "preparsed",
    needsReviewFields: [],
    warning: businessType || businessItem || corporateRegistrationNo || representativeName ? null : "분석 결과가 없습니다. 재분석해 주세요.",
  };
}

function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function buildBusinessKinds(businessType: string, businessItem: string): BusinessCertificateKind[] {
  const types = businessType.split(/\n+/).map((item) => item.trim());
  const items = businessItem.split(/\n+/).map((item) => item.trim());
  const max = Math.max(types.length, items.length);
  const out: BusinessCertificateKind[] = [];
  for (let i = 0; i < max; i += 1) {
    const type = types[i] ?? "";
    const item = items[i] ?? "";
    if (type || item) out.push({ businessType: type, businessItem: item });
  }
  return out;
}

function mapCertificate(row: Record<string, unknown>) {
  return {
    analysisWarning: certificateAnalysisWarning(row),
    certificateId: String(row.certificate_id ?? ""),
    facilityId: String(row.facility_id ?? ""),
    versionNo: Number(row.version_no ?? 0),
    isCurrent: Number(row.is_current ?? 0) === 1,
    displayName: String(row.display_name ?? ""),
    originalFilename: row.original_filename != null ? String(row.original_filename) : null,
    byteSize: row.byte_size != null ? Number(row.byte_size) : null,
    publicPath: row.public_path != null ? String(row.public_path) : null,
    businessType: row.business_type != null ? String(row.business_type) : null,
    businessItem: row.business_item != null ? String(row.business_item) : null,
    corporateRegistrationNo: row.corporate_registration_no != null ? String(row.corporate_registration_no) : null,
    memo: row.memo != null ? String(row.memo) : null,
    createdByName: row.created_by_name != null ? String(row.created_by_name) : null,
    createdByEmail: row.created_by_email != null ? String(row.created_by_email) : null,
    createdAt: String(row.created_at ?? ""),
  };
}
