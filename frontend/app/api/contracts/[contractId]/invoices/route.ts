import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { getInvoiceStorageKey, putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
    const form = await req.formData();
    const file = form.get("file");
    const issueDate = String(form.get("issueDate") ?? "").trim();
    const milestoneId = String(form.get("milestoneId") ?? "").trim() || null;
    const invoiceAmount = toNullableNumber(form.get("invoiceAmount"));
    const supplyAmount = toNullableNumber(form.get("supplyAmount"));
    const vatAmount = toNullableNumber(form.get("vatAmount"));
    const paymentCollected = String(form.get("paymentCollected") ?? "0") === "1";
    const paymentCollectedAt = String(form.get("paymentCollectedAt") ?? "").trim() || null;
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
    const storedName = `${issueDate}_${crypto.randomUUID().slice(0, 8)}_${originalName.endsWith(".pdf") ? originalName : originalName + ".pdf"}`;
    const storageKey = getInvoiceStorageKey(issueDate, storedName);
    const stored = await putContractDocument(storageKey, buffer, file.type || "application/pdf");
    const documentId = "doc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const invoiceId = "inv_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date().toISOString();
    const date = new Date(issueDate + "T00:00:00");
    const fiscalYear = date.getFullYear();
    const fiscalQuarter = Math.floor(date.getMonth() / 3) + 1;

    await withDbWrite(async (db) => {
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
               collected_amount = CASE WHEN $3 = 1 THEN COALESCE($2, collected_amount, amount) ELSE collected_amount END,
               updated_at = $5
           WHERE milestone_id = $6
             AND contract_id = $7`,
          [issueDate, invoiceAmount, paymentCollected ? 1 : 0, paymentCollectedAt, now, milestoneId, contractId]
        );
      }
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "contract_invoice_upload",
        targetTable: "contract_invoices",
        targetId: invoiceId,
        after: { contractId, milestoneId, issueDate, invoiceAmount, documentId, storageKey },
      });
    });

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
