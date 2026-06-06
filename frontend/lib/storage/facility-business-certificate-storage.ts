import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/storage/logo-storage";
import { sanitizeFilename, sanitizePathSegment } from "@/lib/storage/contract-document-storage";

export interface StoredFacilityBusinessCertificate {
  storageProvider: "local" | "s3";
  storageBucket: string | null;
  storageKey: string;
  publicPath: string;
}

export function buildFacilityBusinessCertificateStorageKey(params: {
  facilityId: string;
  companyName: string;
  versionNo: number;
  originalFilename: string;
}): { storageKey: string; fileName: string } {
  const ext = path.extname(params.originalFilename || ".pdf").slice(0, 16) || ".pdf";
  const company = sanitizePathSegment(params.companyName || params.facilityId);
  const fileName = sanitizeFilename(`${company} 사업자등록증 v${params.versionNo}${ext}`);
  const storageKey = [
    "facilities",
    "business-certificates",
    sanitizePathSegment(params.facilityId),
    fileName,
  ].join("/");
  return { storageKey, fileName };
}

export async function putFacilityBusinessCertificate(
  storageKey: string,
  body: Buffer,
  contentType: string
): Promise<StoredFacilityBusinessCertificate> {
  const localRoot = process.env.FACILITY_DOCUMENT_STORAGE_ROOT?.trim();
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
      publicPath: "/api/facilities/business-certificates/download?key=" + encodeURIComponent(storageKey),
    };
  }

  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket) throw new Error("FACILITY_DOCUMENT_STORAGE_ROOT 또는 MCM_STORAGE_BUCKET 환경변수가 필요합니다.");
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
    publicPath: "/api/facilities/business-certificates/download?key=" + encodeURIComponent(storageKey),
  };
}

export async function getFacilityBusinessCertificate(storageKey: string) {
  if (storageKey.includes("..") || storageKey.startsWith("/") || storageKey.startsWith("\\")) {
    throw new Error("잘못된 문서 경로입니다.");
  }
  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket) throw new Error("MCM_STORAGE_BUCKET 환경변수가 필요합니다.");
  const out: GetObjectCommandOutput = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
  return {
    body: (out.Body as unknown as ReadableStream<Uint8Array> | undefined) ?? null,
    contentType: out.ContentType ?? "application/pdf",
    contentLength: typeof out.ContentLength === "number" ? out.ContentLength : null,
    etag: out.ETag ?? null,
    lastModified: out.LastModified ?? null,
  };
}
