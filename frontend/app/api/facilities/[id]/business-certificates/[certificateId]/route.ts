import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { analyzeBusinessCertificate } from "@/lib/ieps/business-certificate-analysis";
import { readFacilityBusinessCertificate, deleteFacilityBusinessCertificate, type StoredFacilityBusinessCertificate } from "@/lib/storage/facility-business-certificate-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
interface RouteContext { params: Promise<{ id: string; certificateId: string }> }

function storageLocation(row: Record<string, unknown>) {
  return {
    storageProvider: String(row.storage_provider) as StoredFacilityBusinessCertificate["storageProvider"],
    storageBucket: row.storage_bucket ? String(row.storage_bucket) : null,
    storageKey: String(row.storage_key),
  };
}

async function findCertificate(db: PgDatabase, id: string, certificateId: string, lock = false) {
  const row = rowsToObjects(await db.exec(
    `SELECT c.* FROM facility_business_certificates c
      JOIN facilities f ON f.facility_id = c.facility_id
      WHERE c.facility_id = $1 AND c.certificate_id = $2 AND f.deleted_at IS NULL
        AND c.parsed_json->>'deletedAt' IS NULL${lock ? " FOR UPDATE OF c" : ""}`,
    [id, certificateId]
  ))[0];
  if (!row) throw Object.assign(new Error("사업자등록증을 찾을 수 없습니다."), { status: 404 });
  return row;
}

export async function POST(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id, certificateId } = await ctx.params;
    const row = await findCertificate(await getDb(), id, certificateId);
    const bytes = await readFacilityBusinessCertificate(storageLocation(row));
    const file = new File([new Uint8Array(bytes)], String(row.original_filename || row.display_name || "business-certificate.pdf"), { type: "application/pdf" });
    const parsed = await analyzeBusinessCertificate(file);
    const now = new Date().toISOString();
    const isCurrent = await withDbWrite(async (txn) => {
      // 분석 중 갱신본 업로드/삭제가 일어났다면 최신 상태를 기준으로 반영한다.
      await txn.exec("SELECT facility_id FROM facilities WHERE facility_id = $1 FOR UPDATE", [id]);
      const latest = await findCertificate(txn, id, certificateId, true);
      await txn.run(
        `UPDATE facility_business_certificates
          SET business_type = COALESCE($1, business_type), business_item = COALESCE($2, business_item),
              corporate_registration_no = COALESCE($3, corporate_registration_no),
              ocr_text = COALESCE($4, ocr_text), parsed_json = $5::jsonb, updated_at = $6
          WHERE certificate_id = $7`,
        [parsed.businessType || null, parsed.businessItem || null, parsed.corporateRegistrationNo || null,
          parsed.ocrText || null, JSON.stringify({ ...parsed, analyzedAt: now }), now, certificateId]
      );
      const current = Number(latest.is_current) === 1;
      if (current) {
        await txn.run(
          `UPDATE facilities SET
            business_certificate_business_type = COALESCE($1, business_certificate_business_type),
            business_certificate_business_item = COALESCE($2, business_certificate_business_item),
            business_certificate_corporate_registration_no = COALESCE($3, business_certificate_corporate_registration_no),
            business_certificate_ocr_text = COALESCE($4, business_certificate_ocr_text),
            representative_name = COALESCE($5, representative_name),
            corporate_registration_no = COALESCE($3, corporate_registration_no), updated_at = $6
          WHERE facility_id = $7`,
          [parsed.businessType || null, parsed.businessItem || null, parsed.corporateRegistrationNo || null,
            parsed.ocrText || null, parsed.representativeName || null, now, id]
        );
      }
      await recordAuditLogInline(txn, {
        actorUserId: actor.userId, action: "facility_update", targetTable: "facility_business_certificates", targetId: certificateId,
        after: { operation: "reanalyze", facilityId: id, isCurrent: current, ...parsed },
      });
      return current;
    });
    return NextResponse.json({ certificateId, isCurrent, ...parsed });
  } catch (err) { return authErrorToResponse(err); }
}

export async function DELETE(_: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const { id, certificateId } = await ctx.params;
    const row = await withDbWrite(async (txn) => {
      await txn.exec("SELECT facility_id FROM facilities WHERE facility_id = $1 FOR UPDATE", [id]);
      const certificate = await findCertificate(txn, id, certificateId, true);
      if (Number(certificate.is_current) === 1) {
        throw Object.assign(new Error("현재본은 삭제할 수 없습니다. 갱신본을 업로드한 뒤 과거 이력을 삭제해 주세요."), { status: 409 });
      }
      const now = new Date().toISOString();
      // 버전 번호와 감사 이력은 유지하고, 목록/다운로드에서는 즉시 제외한다.
      await txn.run(
        `UPDATE facility_business_certificates SET
          parsed_json = COALESCE(parsed_json, '{}'::jsonb) || $1::jsonb, updated_at = $2
          WHERE certificate_id = $3`,
        [JSON.stringify({ deletedAt: now, deletedBy: actor.userId }), now, certificateId]
      );
      await recordAuditLogInline(txn, {
        actorUserId: actor.userId, action: "facility_update", targetTable: "facility_business_certificates", targetId: certificateId,
        after: { operation: "delete_certificate", facilityId: id, versionNo: certificate.version_no },
      });
      return certificate;
    });
    let warning: string | null = null;
    try { await deleteFacilityBusinessCertificate(storageLocation(row)); }
    catch (err) {
      console.error("[bizcert] 삭제된 문서 원본 정리 실패:", certificateId, (err as Error).message);
      warning = "업로드 이력은 삭제했지만 저장소 원본 정리에 실패했습니다. 관리자에게 문의해 주세요.";
    }
    return NextResponse.json({ certificateId, deleted: true, warning });
  } catch (err) { return authErrorToResponse(err); }
}
