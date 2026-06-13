import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import {
  getOutsourcingDocumentStorageKey,
  putContractDocument,
  sanitizeFilename,
} from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

const MAX_BYTES = 30 * 1024 * 1024;
const newOutsourcingId = () => "out_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const newDocumentId = () => "doc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireEditor();
    const { contractId } = await ctx.params;
    const form = await req.formData();
    const outsourcingTitle = String(form.get("outsourcingTitle") ?? "").trim();
    const counterpartyFacilityId = String(form.get("counterpartyFacilityId") ?? "").trim() || null;
    const counterpartyName = String(form.get("counterpartyName") ?? "").trim() || null;
    const serviceType = String(form.get("serviceType") ?? "").trim() || null;
    const contractDate = String(form.get("contractDate") ?? "").trim() || null;
    const endedAt = String(form.get("endedAt") ?? "").trim() || null;
    const amount = toNullableNumber(form.get("amount"));
    const memo = String(form.get("memo") ?? "").trim() || null;
    const file = form.get("file");

    if (!outsourcingTitle) {
      return NextResponse.json({ error: "외주 계약명이 필요합니다." }, { status: 400 });
    }
    if (!counterpartyFacilityId && !counterpartyName) {
      return NextResponse.json({ error: "외주 계약상대 업체를 입력하세요." }, { status: 400 });
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
    const parentTitle = String(contractRows[0].contract_title ?? "").trim();
    const parentDate =
      String(contractRows[0].contract_date ?? "").trim() ||
      String(contractRows[0].started_at ?? "").trim() ||
      contractDate;
    if (!parentDate) {
      return NextResponse.json({ error: "원 계약일 또는 외주 계약일이 필요합니다." }, { status: 400 });
    }

    let documentId: string | null = null;
    let storageKey: string | null = null;
    let displayName: string | null = null;
    let documentPayload: {
      originalName: string;
      contentType: string;
      byteSize: number;
      sha256: string;
      storageProvider: "local" | "s3";
      storageBucket: string | null;
      publicPath: string;
    } | null = null;

    if (file instanceof File) {
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "외주 계약서 PDF는 30MB 이하만 업로드할 수 있습니다." }, { status: 400 });
      }
      if (file.type && file.type !== "application/pdf") {
        return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
      }
      const documentDate = contractDate || parentDate;
      const buffer = Buffer.from(await file.arrayBuffer());
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");
      const originalName = sanitizeFilename(file.name || "outsourcing.pdf");
      const key = getOutsourcingDocumentStorageKey({
        contractDate: parentDate,
        documentDate,
        contractTitle: parentTitle,
        outsourcingTitle,
      });
      const stored = await putContractDocument(key.storageKey, buffer, file.type || "application/pdf");
      documentId = newDocumentId();
      storageKey = stored.storageKey;
      displayName = key.fileName;
      documentPayload = {
        originalName,
        contentType: file.type || "application/pdf",
        byteSize: file.size,
        sha256: hash,
        storageProvider: stored.storageProvider,
        storageBucket: stored.storageBucket,
        publicPath: stored.publicPath,
      };
    }

    const outsourcingId = newOutsourcingId();
    const now = new Date().toISOString();
    await withDbWrite(async (txn) => {
      if (documentId && documentPayload && displayName && storageKey) {
        await txn.run(
          `INSERT INTO contract_documents
            (document_id, contract_id, milestone_id, document_type, display_name,
             original_filename, content_type, byte_size, sha256,
             storage_provider, storage_bucket, storage_key, public_path, source,
             memo, created_by, created_at, updated_at)
           VALUES
            ($1, $2, NULL, 'outsourcing', $3,
             $4, $5, $6, $7,
             $8, $9, $10, $11, 'manual_upload',
             $12, $13, $14, $15)`,
          [
            documentId,
            contractId,
            displayName,
            documentPayload.originalName,
            documentPayload.contentType,
            documentPayload.byteSize,
            documentPayload.sha256,
            documentPayload.storageProvider,
            documentPayload.storageBucket,
            storageKey,
            documentPayload.publicPath,
            memo,
            actor.userId,
            now,
            now,
          ]
        );
      }

      await txn.run(
        `INSERT INTO contract_outsourcing
          (outsourcing_id, contract_id, outsourcing_title, counterparty_facility_id,
           counterparty_name, service_type, contract_date, ended_at, amount, memo, document_id,
           created_by, created_at, updated_at)
         VALUES
          ($1, $2, $3, $4,
           $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14)`,
        [
          outsourcingId,
          contractId,
          outsourcingTitle,
          counterpartyFacilityId,
          counterpartyName,
          serviceType,
          contractDate,
          endedAt,
          amount,
          memo,
          documentId,
          actor.userId,
          now,
          now,
        ]
      );

      await recordAuditLogInline(txn, {
        actorUserId: actor.userId,
        action: "contract_outsourcing_update",
        targetTable: "contract_outsourcing",
        targetId: outsourcingId,
        after: { contractId, outsourcingTitle, counterpartyFacilityId, counterpartyName, serviceType, contractDate, amount, documentId },
      });
    });

    return NextResponse.json({ outsourcingId, documentId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

function toNullableNumber(value: FormDataEntryValue | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
