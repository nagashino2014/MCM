import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import {
  buildContractDocumentFileName,
  getContractDocumentStorageKey,
  putContractDocument,
  sanitizeFilename,
} from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

const MAX_BYTES = 30 * 1024 * 1024;

/**
 * Upload a contract or amendment PDF for a contract. The stored object lands
 * under contracts/documents/{YYYY}/(YYYY-MM-DD) {계약명}/(YYYY-MM-DD){계약명} {계약서|변경계약서}.pdf
 * so that S3 mirrors the legacy V:\계약\매출계약서 layout, and amendments
 * always live in the original contract folder regardless of when they were
 * filed.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
    const form = await req.formData();
    const file = form.get("file");
    const documentType = String(form.get("documentType") ?? "contract").trim();
    const documentDate = String(form.get("documentDate") ?? "").trim();
    const memo = String(form.get("memo") ?? "").trim() || null;
    const linkedChangeId = String(form.get("changeEventId") ?? "").trim() || null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "PDF 파일이 필요합니다." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "PDF 파일은 30MB 이하만 업로드할 수 있습니다." }, { status: 400 });
    }
    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
    }
    if (!documentDate || Number.isNaN(new Date(documentDate + "T00:00:00").getTime())) {
      return NextResponse.json({ error: "문서 일자가 필요합니다." }, { status: 400 });
    }
    if (documentType !== "contract" && documentType !== "amendment") {
      return NextResponse.json({ error: "documentType은 contract 또는 amendment여야 합니다." }, { status: 400 });
    }

    const db = await getDb();
    const contractRows = rowsToObjects(
      await db.exec(
        "SELECT contract_title, contract_date, started_at FROM contracts WHERE contract_id = $1",
        [contractId]
      )
    );
    if (contractRows.length === 0) {
      return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    }
    const contractTitle = String(contractRows[0]?.contract_title ?? "").trim();
    if (!contractTitle) {
      return NextResponse.json({ error: "계약명이 비어 있어 파일명을 생성할 수 없습니다." }, { status: 400 });
    }
    const contractDate =
      String(contractRows[0]?.contract_date ?? "").trim() ||
      String(contractRows[0]?.started_at ?? "").trim();
    if (!contractDate) {
      return NextResponse.json({ error: "계약 일자가 비어 있어 폴더를 결정할 수 없습니다." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const originalName = sanitizeFilename(file.name || "contract.pdf");
    const { storageKey, fileName } = getContractDocumentStorageKey({
      contractDate,
      documentDate,
      contractTitle,
      docType: documentType as "contract" | "amendment",
    });

    // Idempotency: if a document with the same hash already exists for this
    // contract we just return it instead of double-uploading. The migration
    // script relies on this so it can be re-run safely.
    const existing = rowsToObjects(
      await db.exec(
        "SELECT document_id, public_path FROM contract_documents WHERE contract_id = $1 AND sha256 = $2",
        [contractId, hash]
      )
    );
    if (existing.length > 0) {
      return NextResponse.json({
        documentId: existing[0].document_id,
        publicPath: existing[0].public_path,
        deduplicated: true,
      });
    }

    const stored = await putContractDocument(storageKey, buffer, file.type || "application/pdf");
    const documentId = "doc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date().toISOString();
    const displayName = buildContractDocumentFileName(
      documentDate,
      contractTitle,
      documentType as "contract" | "amendment"
    );

    await withDbWrite(async (txn) => {
      await txn.run(
        `INSERT INTO contract_documents
          (document_id, contract_id, milestone_id, document_type, display_name,
           original_filename, content_type, byte_size, sha256,
           storage_provider, storage_bucket, storage_key, public_path, source,
           memo, created_by, created_at, updated_at)
         VALUES
          ($1, $2, NULL, $3, $4,
           $5, $6, $7, $8,
           $9, $10, $11, $12, 'manual_upload',
           $13, $14, $15, $16)`,
        [
          documentId,
          contractId,
          documentType,
          displayName,
          originalName,
          file.type || "application/pdf",
          file.size,
          hash,
          stored.storageProvider,
          stored.storageBucket,
          stored.storageKey,
          stored.publicPath,
          memo,
          actor.userId,
          now,
          now,
        ]
      );

      // If the upload is associated with a previously-recorded change event,
      // backfill its document_id so the change history page can link to the
      // amendment PDF directly.
      if (linkedChangeId && documentType === "amendment") {
        await txn.run(
          `UPDATE contract_change_events
              SET document_id = $1, updated_at = $2
              WHERE change_id = $3 AND contract_id = $4`,
          [documentId, now, linkedChangeId, contractId]
        );
      }

      await recordAuditLogInline(txn, {
        actorUserId: actor.userId,
        action: "contract_document_upload",
        targetTable: "contract_documents",
        targetId: documentId,
        after: { contractId, documentType, documentDate, storageKey, fileName },
      });
    });

    return NextResponse.json({
      documentId,
      publicPath: stored.publicPath,
      storageKey: stored.storageKey,
      displayName,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
