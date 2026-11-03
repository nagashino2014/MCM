// 계약서·변경계약서 파일명(display_name)을 현재 계약일·계약명에 맞춘다(2026-11-03 사용자 리포트).
// 파일명은 업로드 시점의 `(문서일)계약명 [N차 ]계약서|변경계약서[(n)].pdf` 로 굳어져, 변경계약으로
// 계약일·계약명을 정정해도 [계약서 보기]의 다운로드 이름이 옛 날짜·옛 이름으로 남았다.
// S3 저장 키(storage_key)는 그대로 두고 표시·다운로드 이름만 다시 만든다.

import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { sanitizeFilename, sanitizePathSegment } from "@/lib/storage/contract-document-storage";

const CANONICAL_NAME_RE = /^\((\d{4}-\d{2}-\d{2})\)(.+?) (\d+차 )?(변경계약서|계약서)(\(\d+\))?\.pdf$/;

/**
 * 표준 형식 파일명을 현재 계약 정보로 다시 만든다. 계약서는 계약일을, 변경계약서는 자기 문서일을 쓴다.
 * 표준 형식이 아닌 이름(옛 이관본·200자 절단)이나 고칠 것이 없으면 null.
 */
export function rebuildContractDocumentName(
  displayName: string,
  documentType: string,
  contractDate: string | null,
  contractTitle: string | null
): string | null {
  const match = CANONICAL_NAME_RE.exec(displayName);
  if (!match) return null;
  const [, docDate, , round = "", kind, seq = ""] = match;
  const date = documentType === "contract" && /^\d{4}-\d{2}-\d{2}$/.test(contractDate ?? "") ? contractDate! : docDate;
  const title = sanitizePathSegment(contractTitle ?? "");
  if (!title) return null;
  try {
    const next = sanitizeFilename(`(${date})${title} ${round}${kind}${seq}.pdf`);
    return next === displayName ? null : next;
  } catch {
    return null;
  }
}

/** 조회 결과의 문서 행에 현재 계약일·계약명 기준 이름을 입힌다(저장값이 옛 이름인 기존 계약 대비). */
export function withCurrentContractDocumentNames<T extends Record<string, unknown>>(
  documents: T[],
  contractDate: string | null,
  contractTitle: string | null
): T[] {
  return documents.map((doc) => {
    const next = rebuildContractDocumentName(
      String(doc.display_name ?? ""),
      String(doc.document_type ?? ""),
      contractDate,
      contractTitle
    );
    return next ? { ...doc, display_name: next } : doc;
  });
}

/** 계약일·계약명을 바꾼 트랜잭션 안에서 불러 저장된 계약서·변경계약서 이름을 함께 갱신한다. */
export async function syncContractDocumentNames(
  db: PgDatabase,
  contractId: string,
  now: string = new Date().toISOString()
): Promise<number> {
  const contract = rowsToObjects(
    await db.exec("SELECT contract_title, COALESCE(NULLIF(contract_date, ''), started_at) AS contract_date FROM contracts WHERE contract_id = $1", [
      contractId,
    ])
  )[0];
  if (!contract) return 0;
  const docs = rowsToObjects(
    await db.exec(
      `SELECT document_id, document_type, display_name FROM contract_documents
        WHERE contract_id = $1 AND document_type IN ('contract', 'amendment')`,
      [contractId]
    )
  );
  let renamed = 0;
  for (const doc of docs) {
    const next = rebuildContractDocumentName(
      String(doc.display_name ?? ""),
      String(doc.document_type ?? ""),
      contract.contract_date != null ? String(contract.contract_date) : null,
      contract.contract_title != null ? String(contract.contract_title) : null
    );
    if (!next) continue;
    await db.run("UPDATE contract_documents SET display_name = $1, updated_at = $2 WHERE document_id = $3", [
      next,
      now,
      doc.document_id,
    ]);
    renamed += 1;
  }
  return renamed;
}
