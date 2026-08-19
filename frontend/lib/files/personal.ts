/**
 * 개인문서함(/files/personal) — 사용자별 할당 용량 내 자유 업로드·삭제·전송.
 * 본인 스코프 전용: 모든 함수가 userId 로 좁힌다(관리자 열람 경로 없음 — 개인 공간).
 * 할당 용량은 user_storage_quotas(인원별 용량 배분 모달에서 관리자 설정, 기본 5GB).
 * 저장 키: personal-docs/{userId}/{ts}-{파일명} (공용 버킷, put/delete 는 공용 유틸 재사용).
 */

import { randomUUID } from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import {
  deleteContractDocument,
  putContractDocument,
  sanitizeFilename,
} from "@/lib/storage/contract-document-storage";

export const DEFAULT_PERSONAL_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5GB
/** 개별 파일 상한 — 전자결재 첨부와 동일 200MB. */
export const PERSONAL_DOC_MAX_FILE_BYTES = 200 * 1024 * 1024;

export interface PersonalDocRow {
  documentId: string;
  fileName: string;
  contentType: string | null;
  byteSize: number;
  createdAt: string;
}

export async function getPersonalQuotaBytes(userId: string): Promise<number> {
  const db = await getDb();
  try {
    const rows = rowsToObjects(
      await db.exec(`SELECT personal_doc_quota_bytes FROM user_storage_quotas WHERE user_id = $1`, [userId])
    );
    if (rows.length && rows[0].personal_doc_quota_bytes != null) {
      return Number(rows[0].personal_doc_quota_bytes);
    }
  } catch {
    // 마이그 191 미적용 환경 — 기본값.
  }
  return DEFAULT_PERSONAL_QUOTA_BYTES;
}

export async function listPersonalDocs(
  userId: string
): Promise<{ docs: PersonalDocRow[]; usedBytes: number; quotaBytes: number }> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT document_id, file_name, content_type, byte_size, created_at
         FROM personal_documents WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    )
  );
  const docs: PersonalDocRow[] = rows.map((r) => ({
    documentId: String(r.document_id),
    fileName: String(r.file_name),
    contentType: r.content_type != null ? String(r.content_type) : null,
    byteSize: Number(r.byte_size ?? 0),
    createdAt: String(r.created_at),
  }));
  const usedBytes = docs.reduce((s, d) => s + d.byteSize, 0);
  return { docs, usedBytes, quotaBytes: await getPersonalQuotaBytes(userId) };
}

export async function uploadPersonalDoc(
  userId: string,
  file: { fileName: string; contentType: string; buffer: Buffer }
): Promise<PersonalDocRow> {
  if (file.buffer.length > PERSONAL_DOC_MAX_FILE_BYTES) {
    throw Object.assign(new Error("파일당 최대 200MB 까지 업로드할 수 있습니다."), { status: 400 });
  }
  const { usedBytes, quotaBytes } = await listPersonalDocs(userId);
  if (usedBytes + file.buffer.length > quotaBytes) {
    throw Object.assign(
      new Error(`할당 용량(${(quotaBytes / 1024 / 1024 / 1024).toFixed(1)}GB)을 초과합니다. 기존 파일을 정리해 주세요.`),
      { status: 400 }
    );
  }
  const safeName = sanitizeFilename(file.fileName);
  const storageKey = `personal-docs/${userId}/${Date.now()}-${safeName}`;
  const stored = await putContractDocument(storageKey, file.buffer, file.contentType || "application/octet-stream");
  const documentId = `pdoc-${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO personal_documents
         (document_id, user_id, file_name, content_type, byte_size, storage_provider, storage_bucket, storage_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        documentId,
        userId,
        safeName,
        file.contentType || null,
        file.buffer.length,
        stored.storageProvider,
        stored.storageBucket,
        stored.storageKey,
        now,
      ]
    );
  });
  return { documentId, fileName: safeName, contentType: file.contentType || null, byteSize: file.buffer.length, createdAt: now };
}

export async function deletePersonalDocs(userId: string, documentIds: string[]): Promise<number> {
  if (!documentIds.length) return 0;
  const keys: string[] = [];
  let deleted = 0;
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(
        `DELETE FROM personal_documents WHERE user_id = $1 AND document_id = ANY($2::text[]) RETURNING storage_key`,
        [userId, documentIds]
      )
    );
    deleted = rows.length;
    for (const r of rows) if (r.storage_key) keys.push(String(r.storage_key));
  });
  for (const key of keys) await deleteContractDocument(key);
  return deleted;
}

export interface PersonalDocFile {
  documentId: string;
  fileName: string;
  contentType: string | null;
  byteSize: number;
  storageKey: string;
}

/** 본인 소유 문서 1건 해석(열기·전송용). 없거나 남의 것이면 null. */
export async function getPersonalDoc(userId: string, documentId: string): Promise<PersonalDocFile | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT document_id, file_name, content_type, byte_size, storage_key
         FROM personal_documents WHERE user_id = $1 AND document_id = $2`,
      [userId, documentId]
    )
  );
  if (!rows.length || !rows[0].storage_key) return null;
  return {
    documentId: String(rows[0].document_id),
    fileName: String(rows[0].file_name),
    contentType: rows[0].content_type != null ? String(rows[0].content_type) : null,
    byteSize: Number(rows[0].byte_size ?? 0),
    storageKey: String(rows[0].storage_key),
  };
}
