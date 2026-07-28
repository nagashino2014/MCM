/**
 * 게시판 첨부 저장 — 공용 문서 저장 헬퍼(putContractDocument)를 감싸고 공개 경로만 게시판 라우트로 바꾼다.
 * (issue-attachment-storage 와 동일한 얇은 래퍼 패턴)
 */
import { putContractDocument, sanitizeFilename, sanitizePathSegment, type StoredContractDocument } from "@/lib/storage/contract-document-storage";

export function getBoardAttachmentStorageKey(params: { postId: string; fileName: string }): { storageKey: string; fileName: string } {
  const fileName = sanitizeFilename(params.fileName);
  const storageKey = ["board", sanitizePathSegment(params.postId), `${Date.now()}-${fileName}`].join("/");
  return { storageKey, fileName };
}

export async function putBoardAttachment(storageKey: string, body: Buffer, contentType: string): Promise<StoredContractDocument> {
  const stored = await putContractDocument(storageKey, body, contentType);
  return { ...stored, publicPath: `/api/board/attachments?key=${encodeURIComponent(stored.storageKey)}` };
}
