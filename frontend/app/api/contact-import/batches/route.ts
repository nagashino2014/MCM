import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { parseAmaranthContacts } from "@/lib/contact-import/amaranth-xlsx";
import { ingestContactFile, loadFacilityRefs } from "@/lib/contact-import/store";
import { enqueueAwsJob, isFacilityQualityQueueEnabled } from "@/lib/ieps/aws-job-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 올린 파일 목록. 관리자는 전체, 그 외 직원은 자기 파일만 본다. */
export async function GET() {
  try {
    const actor = await requirePermission("contact.edit", { fallbackRoles: ["editor"] });
    const canReview = await hasPermission(actor.userId, "facility.edit");
    const db = await getDb();
    const batches = rowsToObjects(await db.exec(
      `SELECT b.batch_id, b.original_filename, b.uploaded_at, b.uploaded_by, b.row_count, b.new_count, b.duplicate_count,
              COALESCE(e.name, u.name, '') AS uploader_name,
              (SELECT COUNT(*)::int FROM contact_import_rows r WHERE r.batch_id = b.batch_id AND r.status = 'pending') AS pending_count
         FROM contact_import_batches b
         LEFT JOIN users u ON u.user_id = b.uploaded_by
         LEFT JOIN employee_profiles e ON e.user_id = b.uploaded_by
        WHERE $1::boolean OR b.uploaded_by = $2
        ORDER BY b.uploaded_at DESC LIMIT 100`,
      [canReview, actor.userId]
    )).map((r) => ({
      batchId: String(r.batch_id),
      filename: String(r.original_filename),
      uploadedAt: String(r.uploaded_at),
      uploaderName: String(r.uploader_name ?? ""),
      rowCount: Number(r.row_count ?? 0),
      newCount: Number(r.new_count ?? 0),
      duplicateCount: Number(r.duplicate_count ?? 0),
      pendingCount: Number(r.pending_count ?? 0),
    }));
    return NextResponse.json({ batches, canReview, queueEnabled: isFacilityQualityQueueEnabled() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 아마란스10 연락처 엑셀을 대기 명단에 넣고, 새 회사가 있으면 사업자번호 검색을 시작한다. */
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("contact.edit", { fallbackRoles: ["editor"] });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "엑셀 파일을 첨부하세요." }, { status: 400 });
    if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: ".xlsx 파일만 올릴 수 있습니다." }, { status: 400 });
    if (file.size > 30 * 1024 * 1024) return NextResponse.json({ error: "파일이 너무 큽니다(30MB 이하)." }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    let parsed;
    try {
      parsed = parseAmaranthContacts(buffer);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    if (!parsed.contacts.length) return NextResponse.json({ error: "파일에 가져올 연락처가 없습니다." }, { status: 400 });
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const facilities = await loadFacilityRefs(await getDb());
    const result = await withDbWrite((db) => ingestContactFile(db, { filename: file.name, sha256, userId: actor.userId, file: parsed, facilities }));
    let searchStarted = false;
    let searchError: string | null = null;
    if (result.searchNeeded && isFacilityQualityQueueEnabled()) {
      try {
        await enqueueAwsJob({ type: "contact-import-search" });
        searchStarted = true;
      } catch (err) {
        console.error("[contact-import] 검색 작업 전달 실패", err);
        searchError = "사업자번호 검색을 시작하지 못했습니다. 관리자 화면의 ‘검색 재개’로 다시 시작하세요.";
      }
    }
    return NextResponse.json({ ...result, skippedRows: parsed.skippedRows, searchStarted, searchError });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 잘못 올린 파일 취소 — 아직 분류되지 않은 담당자를 명단에서 지운다. 이미 옮겨진 담당자는 그대로 둔다. */
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("contact.edit", { fallbackRoles: ["editor"] });
    const batchId = req.nextUrl.searchParams.get("batchId");
    if (!batchId) return NextResponse.json({ error: "batchId 가 필요합니다." }, { status: 400 });
    const canReview = await hasPermission(actor.userId, "facility.edit");
    const removed = await withDbWrite(async (db) => {
      const batch = rowsToObjects(await db.exec(`SELECT uploaded_by FROM contact_import_batches WHERE batch_id = $1`, [batchId]))[0];
      if (!batch) return null;
      if (!canReview && String(batch.uploaded_by) !== actor.userId) return "forbidden" as const;
      const rows = rowsToObjects(await db.exec(`DELETE FROM contact_import_rows WHERE batch_id = $1 AND status = 'pending' RETURNING id`, [batchId]));
      // 담당자가 하나도 남지 않은 미분류 회사는 함께 지운다.
      await db.run(
        `DELETE FROM contact_import_companies c WHERE c.decision IS NULL
           AND NOT EXISTS (SELECT 1 FROM contact_import_rows r WHERE r.company_id = c.company_id)`
      );
      const left = rowsToObjects(await db.exec(`SELECT COUNT(*)::int AS n FROM contact_import_rows WHERE batch_id = $1`, [batchId]))[0];
      if (Number(left?.n ?? 0) === 0) await db.run(`DELETE FROM contact_import_batches WHERE batch_id = $1`, [batchId]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contact_import_batch_delete",
        targetTable: "contact_import_batches",
        targetId: batchId,
        after: { removedRows: rows.length },
      });
      return rows.length;
    });
    if (removed === null) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
    if (removed === "forbidden") return NextResponse.json({ error: "본인이 올린 파일만 취소할 수 있습니다." }, { status: 403 });
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
