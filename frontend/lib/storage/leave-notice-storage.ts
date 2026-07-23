import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/storage/logo-storage";
import { sanitizeFilename, sanitizePathSegment } from "@/lib/storage/contract-document-storage";

/*
 * 연차촉진 고지 첨부(서면 사용계획서 스캔본) 저장.
 * employee-document-storage 와 동일한 규약: 로컬 루트(EMPLOYEE_DOCUMENT_STORAGE_ROOT) 우선,
 * 없으면 S3(MCM_STORAGE_BUCKET). 다운로드는 leave_notices.attachments 참조 검증 후 스트리밍.
 */

export interface StoredNoticeAttachment {
  storageProvider: "local" | "s3";
  storageBucket: string | null;
  storageKey: string;
}

export function buildNoticeAttachmentKey(params: {
  employeeId: string;
  year: string;
  round: number;
  originalFilename: string;
}): { storageKey: string; fileName: string } {
  const ext = path.extname(params.originalFilename).slice(0, 16);
  const base = sanitizePathSegment(path.basename(params.originalFilename, ext));
  const safeName = sanitizeFilename(`${base || "사용계획서"}${ext}`);
  const storageKey = [
    "leave-notices",
    params.year,
    `${params.round}차`,
    sanitizePathSegment(params.employeeId),
    `${Date.now()}-${safeName}`,
  ].join("/");
  return { storageKey, fileName: safeName };
}

export async function putNoticeAttachment(
  storageKey: string,
  body: Buffer,
  contentType: string
): Promise<StoredNoticeAttachment> {
  const localRoot = process.env.EMPLOYEE_DOCUMENT_STORAGE_ROOT?.trim();
  if (localRoot) {
    const target = path.resolve(localRoot, storageKey);
    const root = path.resolve(localRoot);
    if (!target.startsWith(root + path.sep)) {
      throw new Error("문서 저장 경로가 올바르지 않습니다.");
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    return { storageProvider: "local", storageBucket: null, storageKey };
  }

  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket) {
    throw new Error("EMPLOYEE_DOCUMENT_STORAGE_ROOT 또는 MCM_STORAGE_BUCKET 환경변수가 필요합니다.");
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
  return { storageProvider: "s3", storageBucket: bucket, storageKey };
}

export interface NoticeAttachmentObject {
  body: ReadableStream<Uint8Array> | null;
  contentType: string;
  contentLength: number | null;
  etag: string | null;
  lastModified: Date | null;
}

export async function getNoticeAttachment(storageKey: string): Promise<NoticeAttachmentObject> {
  if (storageKey.includes("..") || storageKey.startsWith("/") || storageKey.startsWith("\\")) {
    throw new Error("잘못된 문서 경로입니다.");
  }
  const localRoot = process.env.EMPLOYEE_DOCUMENT_STORAGE_ROOT?.trim();
  if (localRoot) {
    const { createReadStream } = await import("node:fs");
    const { stat } = await import("node:fs/promises");
    const target = path.resolve(localRoot, storageKey);
    const root = path.resolve(localRoot);
    if (!target.startsWith(root + path.sep)) throw new Error("잘못된 문서 경로입니다.");
    const st = await stat(target);
    const nodeStream = createReadStream(target);
    return {
      body: nodeStream as unknown as ReadableStream<Uint8Array>,
      contentType: "application/octet-stream",
      contentLength: st.size,
      etag: null,
      lastModified: st.mtime,
    };
  }
  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket) throw new Error("MCM_STORAGE_BUCKET 환경변수가 필요합니다.");
  const out: GetObjectCommandOutput = await getS3Client().send(
    new GetObjectCommand({ Bucket: bucket, Key: storageKey })
  );
  return {
    body: (out.Body as unknown as ReadableStream<Uint8Array> | undefined) ?? null,
    contentType: out.ContentType ?? "application/octet-stream",
    contentLength: typeof out.ContentLength === "number" ? out.ContentLength : null,
    etag: out.ETag ?? null,
    lastModified: out.LastModified ?? null,
  };
}
