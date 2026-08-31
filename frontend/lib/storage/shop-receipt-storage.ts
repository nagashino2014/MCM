/**
 * 쇼핑몰 전표 PDF 저장 — 공용 문서 저장 헬퍼를 감싸고 공개 경로만 전표 라우트로 바꾼다.
 * (board-attachment-storage 와 동일한 얇은 래퍼 패턴)
 */
import {
  putContractDocument,
  readContractDocument,
  sanitizePathSegment,
  type StoredContractDocument,
} from "@/lib/storage/contract-document-storage";

const PREFIX = "shop-receipts";

/**
 * 개인 PC 의 상대경로(`receipts/2026-07/foo.pdf`)를 그대로 스토리지 키로 옮긴다.
 * 폴더 구조가 같아 어느 파일이 어디서 온 것인지 눈으로 대조하기 쉽다.
 */
export function shopReceiptStorageKey(site: string, relativePath: string): string {
  const parts = relativePath
    .split(/[\\/]+/)
    .filter((p) => p && p !== "." && p !== "..")
    .map((p) => sanitizePathSegment(p));

  return [PREFIX, sanitizePathSegment(site), ...parts].join("/");
}

export function isShopReceiptKey(key: string): boolean {
  return key.startsWith(`${PREFIX}/`) && !key.includes("..");
}

export async function putShopReceipt(storageKey: string, body: Buffer): Promise<StoredContractDocument> {
  const stored = await putContractDocument(storageKey, body, "application/pdf");
  return { ...stored, publicPath: `/api/receipts/shop/file?key=${encodeURIComponent(stored.storageKey)}` };
}

export async function readShopReceipt(storageKey: string): Promise<Buffer | null> {
  return readContractDocument(storageKey);
}
