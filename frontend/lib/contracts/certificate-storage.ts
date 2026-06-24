import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { putContractDocument, sanitizePathSegment } from "@/lib/storage/contract-document-storage";

/*
 * 증명서/명단 생성물 및 서명 증명서 업로드본을 계약별로 S3(또는 로컬)에 저장하고
 * contract_documents 에 기록한다. 계약 폴더로 카테고리화한다.
 *   contracts/certificates/{YYYY}/(YYYY-MM-DD) {계약명}/{파일명}
 */

export type GeneratedDocType =
  | "certificate_hwpx" // 생성된 증명서 hwpx
  | "roster_hwpx" // 생성된 수행인력 명단 hwpx
  | "roster_pdf" // 생성된 수행인력 명단 pdf (통합묶음용)
  | "certificate_signed"; // 직인 후 회신된 서명 증명서 pdf (업로드)

async function loadContractMeta(
  contractId: string
): Promise<{ title: string; date: string } | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT contract_title, COALESCE(NULLIF(contract_date,''), started_at, created_at) AS contract_date
         FROM contracts WHERE contract_id = $1 LIMIT 1`,
      [contractId]
    )
  );
  const r = rows[0];
  if (!r) return null;
  return { title: String(r.contract_title ?? "").trim(), date: String(r.contract_date ?? "").trim() };
}

function buildKey(title: string, date: string, fileName: string): string {
  const year = /^(\d{4})/.exec(date)?.[1] ?? new Date().getFullYear().toString();
  const folder = sanitizePathSegment(`(${date}) ${title}`);
  return ["contracts", "certificates", year, folder, sanitizePathSegment(fileName)].join("/");
}

/** 생성/업로드 문서를 저장하고 contract_documents 에 upsert(같은 (contract_id, document_type) 교체). */
export async function saveCertificateDoc(params: {
  contractId: string;
  actorUserId: string | null;
  documentType: GeneratedDocType;
  fileName: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<{ storageKey: string; displayName: string }> {
  const meta = await loadContractMeta(params.contractId);
  if (!meta || !meta.title || !meta.date) {
    throw new Error("계약명/계약일자가 비어 저장 경로를 만들 수 없습니다.");
  }
  const storageKey = buildKey(meta.title, meta.date, params.fileName);
  const buffer = Buffer.from(params.bytes);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const stored = await putContractDocument(storageKey, buffer, params.contentType);

  const documentId = "doc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    // 같은 계약·타입의 기존 행 교체(재생성/재업로드)
    await txn.run(
      "DELETE FROM contract_documents WHERE contract_id = $1 AND document_type = $2",
      [params.contractId, params.documentType]
    );
    await txn.run(
      `INSERT INTO contract_documents
         (document_id, contract_id, milestone_id, document_type, display_name,
          original_filename, content_type, byte_size, sha256,
          storage_provider, storage_bucket, storage_key, public_path, source,
          created_by, created_at, updated_at)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'generated', $13, $14, $14)`,
      [
        documentId,
        params.contractId,
        params.documentType,
        params.fileName,
        params.fileName,
        params.contentType,
        buffer.byteLength,
        hash,
        stored.storageProvider,
        stored.storageBucket,
        stored.storageKey,
        stored.publicPath,
        params.actorUserId,
        now,
      ]
    );
  });
  return { storageKey: stored.storageKey, displayName: params.fileName };
}

/** 계약의 특정 타입 저장 문서 조회(최근 1건). */
export async function getCertificateDoc(
  contractId: string,
  documentType: GeneratedDocType
): Promise<{ storageKey: string; displayName: string } | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT storage_key, display_name FROM contract_documents
        WHERE contract_id = $1 AND document_type = $2
        ORDER BY created_at DESC LIMIT 1`,
      [contractId, documentType]
    )
  );
  const r = rows[0];
  if (!r) return null;
  return { storageKey: String(r.storage_key ?? ""), displayName: String(r.display_name ?? "") };
}
