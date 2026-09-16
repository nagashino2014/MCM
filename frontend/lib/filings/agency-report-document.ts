/**
 * 대행 실적 보고서 PDF 보관 — contract_documents(document_type='agency_report')에 넣고 document_id 를 돌려준다.
 * 계약서·변경계약서와 같은 (계약일) 계약명 폴더에 쌓이므로 S3 레이아웃이 V:\계약\매출계약서 와 계속 일치한다.
 */
import crypto from "node:crypto";
import { rowsToObjects, type PgDatabase } from "@/lib/db";
import {
  buildAgencyReportFileName,
  deleteContractDocument,
  getAgencyReportStorageKey,
  putContractDocument,
  sanitizeFilename,
} from "@/lib/storage/contract-document-storage";
import type { AgencyReportKind } from "./types";

export const AGENCY_REPORT_DOC_TYPE = "agency_report";
export const AGENCY_REPORT_MAX_BYTES = 30 * 1024 * 1024;

/**
 * 신고서 PDF 업로드. 같은 계약에 같은 내용(sha256)이 이미 있으면 그 문서를 재사용한다(재업로드 무해).
 * 호출부는 쓰기 트랜잭션 안에서 실행한다 — S3 업로드는 트랜잭션 밖 부수효과지만, 실패 시 예외로 롤백된다.
 */
export async function storeAgencyReportPdf(
  db: PgDatabase,
  params: {
    contractId: string;
    contractTitle: string;
    contractDate: string;
    reportedOn: string;
    reportKind: AgencyReportKind;
    file: File;
    actorUserId: string | null;
  }
): Promise<string> {
  const buffer = Buffer.from(await params.file.arrayBuffer());
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const existing = rowsToObjects(
    await db.exec(`SELECT document_id FROM contract_documents WHERE contract_id = $1 AND sha256 = $2 LIMIT 1`, [
      params.contractId,
      hash,
    ])
  );
  if (existing[0]) return String(existing[0].document_id);

  const { storageKey } = getAgencyReportStorageKey({
    contractDate: params.contractDate,
    reportedOn: params.reportedOn,
    contractTitle: params.contractTitle,
    reportKind: params.reportKind,
  });
  const stored = await putContractDocument(storageKey, buffer, params.file.type || "application/pdf");
  const documentId = "doc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO contract_documents
       (document_id, contract_id, milestone_id, document_type, display_name,
        original_filename, content_type, byte_size, sha256,
        storage_provider, storage_bucket, storage_key, public_path, source,
        memo, created_by, created_at, updated_at)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'manual_upload', NULL, $13, $14, $14)`,
    [
      documentId,
      params.contractId,
      AGENCY_REPORT_DOC_TYPE,
      buildAgencyReportFileName(params.reportedOn, params.contractTitle, params.reportKind),
      sanitizeFilename(params.file.name || "agency-report.pdf"),
      params.file.type || "application/pdf",
      params.file.size,
      hash,
      stored.storageProvider,
      stored.storageBucket,
      stored.storageKey,
      stored.publicPath,
      params.actorUserId,
      now,
    ]
  );
  return documentId;
}

/** 이력에서 떼어낸 신고서 PDF 정리 — 다른 이력이 같은 문서를 쓰고 있으면 두고, 아니면 S3·행까지 지운다. */
export async function removeAgencyReportPdf(db: PgDatabase, documentId: string): Promise<void> {
  const used = rowsToObjects(
    await db.exec(`SELECT count(*)::int AS n FROM contract_agency_reports WHERE document_id = $1`, [documentId])
  );
  if (Number(used[0]?.n ?? 0) > 0) return;
  const rows = rowsToObjects(
    await db.exec(`SELECT storage_key, document_type FROM contract_documents WHERE document_id = $1`, [documentId])
  );
  const row = rows[0];
  if (!row || String(row.document_type) !== AGENCY_REPORT_DOC_TYPE) return; // 계약서 등 다른 문서는 건드리지 않는다
  await db.run(`DELETE FROM contract_documents WHERE document_id = $1`, [documentId]);
  await deleteContractDocument(String(row.storage_key));
}
