import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import {
  deleteContractDocument,
  getInvoiceStorageKey,
  putContractDocument,
  sanitizeFilename,
} from "@/lib/storage/contract-document-storage";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    const form = await req.formData();
    const file = form.get("file");
    const issueDate = String(form.get("issueDate") ?? "").trim();
    const milestoneId = String(form.get("milestoneId") ?? "").trim() || null;
    const invoiceAmount = toNullableNumber(form.get("invoiceAmount"));
    const supplyAmount = toNullableNumber(form.get("supplyAmount"));
    const vatAmount = toNullableNumber(form.get("vatAmount"));
    const paymentCollected = String(form.get("paymentCollected") ?? "0") === "1";
    const paymentCollectedAt = String(form.get("paymentCollectedAt") ?? "").trim() || null;
    const collectionRatio = toNullableNumber(form.get("collectionRatio"));
    const collectedAmount = toNullableNumber(form.get("collectedAmount"));
    const paymentTerms = String(form.get("paymentTerms") ?? "").trim() || null;
    const partialPaymentMemo = String(form.get("partialPaymentMemo") ?? "").trim() || null;
    const memo = String(form.get("memo") ?? "").trim() || null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "세금계산서 PDF 파일이 필요합니다." }, { status: 400 });
    }
    if (!issueDate || Number.isNaN(new Date(issueDate + "T00:00:00").getTime())) {
      return NextResponse.json({ error: "계산서 발행일이 필요합니다." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "세금계산서 PDF는 20MB 이하만 업로드할 수 있습니다." }, { status: 400 });
    }
    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const originalName = sanitizeFilename(file.name || "invoice.pdf");

    // Look up the contract title (and optional stage label) so the stored
    // filename mirrors the V:\계약\매출계산서 naming convention:
    //   (YYYY-MM-DD){contractTitle} {stageLabel} 세금계산서.pdf
    const db = await getDb();
    const contractRows = rowsToObjects(
      await db.exec("SELECT contract_title FROM contracts WHERE contract_id = $1", [contractId])
    );
    if (contractRows.length === 0) {
      return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    }
    const contractTitle = String(contractRows[0]?.contract_title ?? "").trim();
    let stageLabel: string | null = null;
    if (milestoneId) {
      const milestoneRows = rowsToObjects(
        await db.exec(
          "SELECT stage_label FROM contract_payment_milestones WHERE milestone_id = $1 AND contract_id = $2",
          [milestoneId, contractId]
        )
      );
      stageLabel = String(milestoneRows[0]?.stage_label ?? "").trim() || null;
    }

    // 같은 대금지급단위(milestone)의 기존 계산서는 교체 대상 — 기존 파일의 storage_key 수집(S3 정리용)
    const priorStorageKeys: string[] = [];
    if (milestoneId) {
      const priorDocs = rowsToObjects(
        await db.exec(
          `SELECT storage_key FROM contract_documents
            WHERE contract_id = $1 AND milestone_id = $2 AND document_type = 'tax_invoice'`,
          [contractId, milestoneId]
        )
      );
      for (const r of priorDocs) {
        const k = r.storage_key != null ? String(r.storage_key) : "";
        if (k) priorStorageKeys.push(k);
      }
    }

    const { storageKey, fileName: storedName } = getInvoiceStorageKey({
      issueDate,
      contractTitle,
      stageLabel,
    });
    const stored = await putContractDocument(storageKey, buffer, file.type || "application/pdf");
    const documentId = "doc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const invoiceId = "inv_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date().toISOString();
    const date = new Date(issueDate + "T00:00:00");
    const fiscalYear = date.getFullYear();
    const fiscalQuarter = Math.floor(date.getMonth() / 3) + 1;
    const partialPaymentJson =
      paymentCollected
        ? JSON.stringify([
            {
              id: "invoice_" + invoiceId.slice(-12),
              collectedAt: paymentCollectedAt,
              amount: collectedAmount ?? invoiceAmount ?? 0,
              ratio: collectionRatio ?? null,
              memo: partialPaymentMemo,
              recordedBy: actor.userId,
              recordedAt: now,
            },
          ])
        : null;

    await withDbWrite(async (db) => {
      // 같은 대금지급단위의 기존 계산서(인보이스+문서)는 삭제 후 새 파일로 교체
      if (milestoneId) {
        await db.run(
          "DELETE FROM contract_invoices WHERE contract_id = $1 AND milestone_id = $2",
          [contractId, milestoneId]
        );
        await db.run(
          "DELETE FROM contract_documents WHERE contract_id = $1 AND milestone_id = $2 AND document_type = 'tax_invoice'",
          [contractId, milestoneId]
        );
      }
      await db.run(
        `INSERT INTO contract_documents
          (document_id, contract_id, milestone_id, document_type, display_name,
           original_filename, content_type, byte_size, sha256,
           storage_provider, storage_bucket, storage_key, public_path, source,
           created_by, created_at, updated_at)
         VALUES
          ($1, $2, $3, 'tax_invoice', $4,
           $5, $6, $7, $8,
           $9, $10, $11, $12, 'manual_upload',
           $13, $14, $15)`,
        [
          documentId,
          contractId,
          milestoneId,
          storedName,
          originalName,
          file.type || "application/pdf",
          file.size,
          hash,
          stored.storageProvider,
          stored.storageBucket,
          stored.storageKey,
          stored.publicPath,
          actor.userId,
          now,
          now,
        ]
      );
      await db.run(
        `INSERT INTO contract_invoices
          (invoice_id, contract_id, milestone_id, document_id, issue_date,
           fiscal_year, fiscal_quarter, invoice_amount, supply_amount, vat_amount,
           payment_collected, payment_collected_at, issued_via, memo,
           created_by, created_at, updated_at)
         VALUES
          ($1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10,
           $11, $12, 'manual_pdf', $13,
           $14, $15, $16)`,
        [
          invoiceId,
          contractId,
          milestoneId,
          documentId,
          issueDate,
          fiscalYear,
          fiscalQuarter,
          invoiceAmount,
          supplyAmount,
          vatAmount,
          paymentCollected ? 1 : 0,
          paymentCollectedAt,
          memo,
          actor.userId,
          now,
          now,
        ]
      );
      if (milestoneId) {
        await db.run(
          `UPDATE contract_payment_milestones
           SET invoice_issued = 1,
               invoice_issued_at = $1,
               invoice_amount = COALESCE($2, invoice_amount, amount),
               payment_collected = $3,
               payment_collected_at = COALESCE($4, payment_collected_at),
               collection_ratio = CASE WHEN $3 = 1 THEN COALESCE($5, collection_ratio, 1.0) ELSE collection_ratio END,
               collected_amount = CASE WHEN $3 = 1 THEN COALESCE($6, $2, collected_amount, amount) ELSE collected_amount END,
              payment_terms = COALESCE($7, payment_terms),
              partial_payments_json = CASE
                WHEN $3 = 1 AND $8::jsonb IS NOT NULL
                  THEN COALESCE(partial_payments_json, '[]'::jsonb) || $8::jsonb
                ELSE partial_payments_json
              END,
              updated_at = $9
           WHERE milestone_id = $10
             AND contract_id = $11`,
          [
            issueDate,
            invoiceAmount,
            paymentCollected ? 1 : 0,
            paymentCollectedAt,
            collectionRatio,
            collectedAmount,
            paymentTerms,
            partialPaymentJson,
            now,
            milestoneId,
            contractId,
          ]
        );
      }
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_invoice_upload",
        targetTable: "contract_invoices",
        targetId: invoiceId,
        after: { contractId, milestoneId, issueDate, invoiceAmount, documentId, storageKey, partialPaymentMemo },
      });
    });

    // 교체된 기존 파일의 S3/로컬 객체 정리 (새 파일과 키가 같으면 건너뜀 — 방금 올린 파일 보호)
    for (const oldKey of priorStorageKeys) {
      if (oldKey !== stored.storageKey) await deleteContractDocument(oldKey);
    }

    return NextResponse.json({ invoiceId, documentId, publicPath: stored.publicPath });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function toNullableNumber(value: FormDataEntryValue | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
