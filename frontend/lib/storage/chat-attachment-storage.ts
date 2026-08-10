/**
 * 메신저 첨부 저장(MSG-P1) — 공용 문서 저장 헬퍼의 얇은 래퍼(board-attachment-storage 패턴).
 * 다운로드는 attachment_id 기준 인증 프록시(/api/chat/attachments?id=)라서
 * public_path 는 저장 시점이 아니라 chat_attachments insert 후에 채운다(queries.ts).
 */
import { putContractDocument, sanitizeFilename, sanitizePathSegment, type StoredContractDocument } from "@/lib/storage/contract-document-storage";

export function getChatAttachmentStorageKey(params: { roomId: number; fileName: string }): { storageKey: string; fileName: string } {
  const fileName = sanitizeFilename(params.fileName);
  const storageKey = ["chat", sanitizePathSegment(String(params.roomId)), `${Date.now()}-${fileName}`].join("/");
  return { storageKey, fileName };
}

export function chatAttachmentPublicPath(attachmentId: number): string {
  return `/api/chat/attachments?id=${attachmentId}`;
}

export async function putChatAttachment(storageKey: string, body: Buffer, contentType: string): Promise<StoredContractDocument> {
  return putContractDocument(storageKey, body, contentType);
}
