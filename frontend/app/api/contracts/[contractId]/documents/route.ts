import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
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
 *
 * 변경계약 차수(278): 변경계약서를 올리면 새 차수가 생긴다(amendmentId 생략 또는 "new").
 * 기존 차수 id 를 주면 그 차수의 추가 문서가 된다. changeEventId 를 주면 그 변경 이벤트를 차수에 묶는다.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    const form = await req.formData();
    const file = form.get("file");
    const documentType = String(form.get("documentType") ?? "contract").trim();
    const documentDate = String(form.get("documentDate") ?? "").trim();
    const memo = String(form.get("memo") ?? "").trim() || null;
    const linkedChangeId = String(form.get("changeEventId") ?? "").trim() || null;
    const requestedAmendmentId = String(form.get("amendmentId") ?? "").trim();

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

    // 변경계약 차수 결정 — 새 차수 번호는 업로드 전에 정해 파일명에 넣고, 동시에 같은 번호가
    // 잡히면 UNIQUE(contract_id, round_no) 위반으로 409 를 돌려 다시 시도하게 한다.
    let amendment: { amendmentId: string; roundNo: number; seq: number; isNew: boolean } | null = null;
    if (documentType === "amendment") {
      if (requestedAmendmentId && requestedAmendmentId !== "new") {
        const rows = rowsToObjects(
          await db.exec(
            `SELECT a.round_no,
                    (SELECT COUNT(*) FROM contract_documents d WHERE d.amendment_id = a.amendment_id) AS doc_count
               FROM contract_amendments a
              WHERE a.amendment_id = $1 AND a.contract_id = $2`,
            [requestedAmendmentId, contractId]
          )
        );
        if (rows.length === 0) {
          return NextResponse.json({ error: "선택한 변경 차수를 찾을 수 없습니다." }, { status: 404 });
        }
        amendment = {
          amendmentId: requestedAmendmentId,
          roundNo: Number(rows[0].round_no),
          seq: Number(rows[0].doc_count ?? 0) + 1,
          isNew: false,
        };
      } else {
        const rows = rowsToObjects(
          await db.exec("SELECT COALESCE(MAX(round_no), 0) AS max_round FROM contract_amendments WHERE contract_id = $1", [
            contractId,
          ])
        );
        amendment = {
          amendmentId: "amd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16),
          roundNo: Number(rows[0]?.max_round ?? 0) + 1,
          seq: 1,
          isNew: true,
        };
      }
    }

    const { storageKey, fileName } = getContractDocumentStorageKey({
      contractDate,
      documentDate,
      contractTitle,
      docType: documentType as "contract" | "amendment",
      amendment: amendment ? { roundNo: amendment.roundNo, seq: amendment.seq } : undefined,
    });

    // Idempotency: if a document with the same hash already exists for this
    // contract we just return it instead of double-uploading. The migration
    // script relies on this so it can be re-run safely.
    const existing = rowsToObjects(
      await db.exec(
        "SELECT document_id, public_path, amendment_id FROM contract_documents WHERE contract_id = $1 AND sha256 = $2",
        [contractId, hash]
      )
    );
    if (existing.length > 0) {
      const existingAmendmentId = existing[0].amendment_id != null ? String(existing[0].amendment_id) : null;
      // 같은 변경계약서를 다시 올린 경우 — 새 차수를 만들지 않고, 요청한 변경 이벤트만 그 차수에 묶는다.
      if (linkedChangeId && existingAmendmentId) {
        await db.run(
          `UPDATE contract_change_events
              SET document_id = COALESCE(document_id, $1), amendment_id = $2, updated_at = $3
            WHERE change_id = $4 AND contract_id = $5`,
          [existing[0].document_id, existingAmendmentId, new Date().toISOString(), linkedChangeId, contractId]
        );
      }
      return NextResponse.json({
        documentId: existing[0].document_id,
        publicPath: existing[0].public_path,
        amendmentId: existingAmendmentId,
        deduplicated: true,
      });
    }

    const stored = await putContractDocument(storageKey, buffer, file.type || "application/pdf");
    const documentId = "doc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date().toISOString();
    const displayName = buildContractDocumentFileName(
      documentDate,
      contractTitle,
      documentType as "contract" | "amendment",
      amendment ? { roundNo: amendment.roundNo, seq: amendment.seq } : undefined
    );

    try {
    await withDbWrite(async (txn) => {
      if (amendment?.isNew) {
        await txn.run(
          `INSERT INTO contract_amendments
            (amendment_id, contract_id, round_no, amended_at, created_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)`,
          [amendment.amendmentId, contractId, amendment.roundNo, documentDate, actor.userId, now]
        );
      }
      await txn.run(
        `INSERT INTO contract_documents
          (document_id, contract_id, milestone_id, document_type, display_name,
           original_filename, content_type, byte_size, sha256,
           storage_provider, storage_bucket, storage_key, public_path, source,
           memo, created_by, created_at, updated_at, amendment_id)
         VALUES
          ($1, $2, NULL, $3, $4,
           $5, $6, $7, $8,
           $9, $10, $11, $12, 'manual_upload',
           $13, $14, $15, $16, $17)`,
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
          amendment?.amendmentId ?? null,
        ]
      );

      // If the upload is associated with a previously-recorded change event,
      // backfill its document_id so the change history page can link to the
      // amendment PDF directly. 차수(278)에도 함께 묶는다.
      if (linkedChangeId && amendment) {
        await txn.run(
          `UPDATE contract_change_events
              SET document_id = COALESCE(document_id, $1), amendment_id = $5, updated_at = $2
              WHERE change_id = $3 AND contract_id = $4`,
          [documentId, now, linkedChangeId, contractId, amendment.amendmentId]
        );
      }

      await recordAuditLogInline(txn, {
        actorUserId: actor.userId,
        action: "contract_document_upload",
        targetTable: "contract_documents",
        targetId: documentId,
        after: {
          contractId,
          documentType,
          documentDate,
          storageKey,
          fileName,
          amendmentId: amendment?.amendmentId ?? null,
          roundNo: amendment?.roundNo ?? null,
        },
      });
    });
    } catch (err) {
      if ((err as { code?: string })?.code === "23505" && amendment?.isNew) {
        return NextResponse.json(
          { error: "같은 계약에 다른 변경계약서가 방금 올라와 차수 번호가 겹쳤습니다. 다시 저장해 주세요." },
          { status: 409 }
        );
      }
      throw err;
    }

    return NextResponse.json({
      documentId,
      publicPath: stored.publicPath,
      storageKey: stored.storageKey,
      displayName,
      amendmentId: amendment?.amendmentId ?? null,
      roundNo: amendment?.roundNo ?? null,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
