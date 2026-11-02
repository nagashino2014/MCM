import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import {
  deleteContractDocument,
  getPurchaseContractDocumentStorageKey,
  putContractDocument,
  sanitizeFilename,
} from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ purchaseContractId: string }>;
}

const MAX_BYTES = 30 * 1024 * 1024;
const PUBLIC_PATH_PREFIX = "/api/purchase-contracts/documents?key=";

/**
 * 매입 계약서·변경계약서 PDF 업로드(331) — 매출 documents POST 와 같은 흐름.
 * 저장 키는 purchase-contracts/documents/{YYYY}/(계약일) 계약명/… 이고, 공개 경로는 매입 전용 다운로드 라우트다
 * (매출 다운로드 라우트는 contract_documents 만 검사하므로 재사용하지 않는다).
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    const actor = await requirePermission("purchase.edit");
    const form = await req.formData();
    const file = form.get("file");
    const documentType = String(form.get("documentType") ?? "contract").trim();
    const documentDateInput = String(form.get("documentDate") ?? "").trim();
    if (!(file instanceof File)) return NextResponse.json({ error: "PDF 파일이 필요합니다." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "PDF 파일은 30MB 이하만 업로드할 수 있습니다." }, { status: 400 });
    if (file.type && file.type !== "application/pdf") return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
    if (documentType !== "contract" && documentType !== "amendment") {
      return NextResponse.json({ error: "documentType은 contract 또는 amendment여야 합니다." }, { status: 400 });
    }

    const db = await getDb();
    const head = rowsToObjects(
      await db.exec(
        "SELECT contract_title, contract_date, created_at FROM purchase_contracts WHERE purchase_contract_id = $1 AND deleted_at IS NULL",
        [purchaseContractId]
      )
    )[0];
    if (!head) return NextResponse.json({ error: "매입 계약을 찾을 수 없습니다." }, { status: 404 });
    const contractTitle = String(head.contract_title ?? "").trim();
    const contractDate = String(head.contract_date ?? "").trim() || String(head.created_at ?? "").slice(0, 10);
    const documentDate = documentDateInput || contractDate;
    if (!documentDate || Number.isNaN(new Date(documentDate + "T00:00:00").getTime())) {
      return NextResponse.json({ error: "문서 일자가 필요합니다." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const originalName = sanitizeFilename(file.name || "contract.pdf");

    const existing = rowsToObjects(
      await db.exec(
        "SELECT document_id, public_path, storage_key, display_name FROM purchase_contract_documents WHERE purchase_contract_id = $1 AND sha256 = $2",
        [purchaseContractId, hash]
      )
    );
    if (existing.length > 0) {
      return NextResponse.json({
        documentId: String(existing[0].document_id),
        publicPath: String(existing[0].public_path ?? ""),
        storageKey: String(existing[0].storage_key ?? ""),
        displayName: String(existing[0].display_name ?? ""),
        duplicate: true,
      });
    }
    const countRow = rowsToObjects(
      await db.exec(
        "SELECT COUNT(*) AS n FROM purchase_contract_documents WHERE purchase_contract_id = $1 AND document_type = $2",
        [purchaseContractId, documentType]
      )
    )[0];
    const { storageKey, fileName } = getPurchaseContractDocumentStorageKey({
      contractDate,
      documentDate,
      contractTitle,
      docType: documentType,
      seq: Number(countRow?.n ?? 0) + 1,
    });
    const stored = await putContractDocument(storageKey, buffer, file.type || "application/pdf");
    const publicPath = PUBLIC_PATH_PREFIX + encodeURIComponent(storageKey);
    const documentId = "pcd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date().toISOString();

    await withDbWrite(async (txn) => {
      await txn.run(
        `INSERT INTO purchase_contract_documents
          (document_id, purchase_contract_id, milestone_id, document_type, display_name, original_filename, content_type,
           byte_size, sha256, storage_provider, storage_bucket, storage_key, public_path, created_by, created_at, updated_at)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
        [
          documentId,
          purchaseContractId,
          documentType,
          fileName,
          originalName,
          file.type || "application/pdf",
          file.size,
          hash,
          stored.storageProvider,
          stored.storageBucket,
          stored.storageKey,
          publicPath,
          actor.userId,
          now,
        ]
      );
      await recordAuditLogInline(txn, {
        actorUserId: actor.userId,
        action: "purchase_contract_document_upload",
        targetTable: "purchase_contract_documents",
        targetId: documentId,
        after: { purchaseContractId, documentType, documentDate, storageKey, fileName },
      });
    });
    return NextResponse.json({ documentId, publicPath, storageKey, displayName: fileName });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 문서 삭제(?documentId=) — 저장 객체와 행을 함께 지운다(휴지통 없음). */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    const actor = await requirePermission("purchase.edit");
    const documentId = req.nextUrl.searchParams.get("documentId")?.trim();
    if (!documentId) return NextResponse.json({ error: "documentId 가 필요합니다." }, { status: 400 });
    let storageKey: string | null = null;
    await withDbWrite(async (db) => {
      const row = rowsToObjects(
        await db.exec("SELECT * FROM purchase_contract_documents WHERE document_id = $1 AND purchase_contract_id = $2", [
          documentId,
          purchaseContractId,
        ])
      )[0];
      if (!row) throw Object.assign(new Error("문서를 찾을 수 없습니다."), { status: 404 });
      storageKey = String(row.storage_key ?? "");
      await db.run("DELETE FROM purchase_contract_documents WHERE document_id = $1", [documentId]);
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "purchase_contract_document_upload",
        targetTable: "purchase_contract_documents",
        targetId: documentId,
        before: row,
        after: { deleted: true },
      });
    });
    if (storageKey) await deleteContractDocument(storageKey).catch(() => undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
