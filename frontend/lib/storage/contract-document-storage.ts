import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/storage/logo-storage";

export interface StoredContractDocument {
  storageProvider: "local" | "s3";
  storageBucket: string | null;
  storageKey: string;
  publicPath: string;
}

export function getInvoiceStorageKey(issueDate: string, filename: string): string {
  const date = new Date(issueDate + "T00:00:00");
  if (Number.isNaN(date.getTime())) {
    throw new Error("계산서 발행일이 올바르지 않습니다.");
  }
  const year = String(date.getFullYear());
  const quarter = "Q" + (Math.floor(date.getMonth() / 3) + 1);
  return ["contracts", "invoices", year, quarter, sanitizeFilename(filename)].join("/");
}

export function sanitizeFilename(filename: string): string {
  const normalized = filename.normalize("NFKC").replace(/[\\/:*?"<>|]+/g, "_").trim();
  const compact = normalized.replace(/\s+/g, "_");
  if (!compact || compact === "." || compact === "..") {
    throw new Error("잘못된 파일명입니다.");
  }
  return compact.slice(0, 160);
}

export async function putContractDocument(
  storageKey: string,
  body: Buffer,
  contentType: string
): Promise<StoredContractDocument> {
  const localRoot = process.env.CONTRACT_DOCUMENT_STORAGE_ROOT?.trim();
  if (localRoot) {
    const target = path.resolve(localRoot, storageKey);
    const root = path.resolve(localRoot);
    if (!target.startsWith(root + path.sep)) {
      throw new Error("문서 저장 경로가 올바르지 않습니다.");
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    return {
      storageProvider: "local",
      storageBucket: null,
      storageKey,
      publicPath: "/api/contracts/documents?key=" + encodeURIComponent(storageKey),
    };
  }

  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket) {
    throw new Error("CONTRACT_DOCUMENT_STORAGE_ROOT 또는 MCM_STORAGE_BUCKET 환경변수가 필요합니다.");
  }
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: body,
      ContentType: contentType,
      CacheControl: "private, max-age=86400",
    })
  );
  return {
    storageProvider: "s3",
    storageBucket: bucket,
    storageKey,
    publicPath: "/api/contracts/documents?key=" + encodeURIComponent(storageKey),
  };
}
