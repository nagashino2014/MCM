import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/storage/logo-storage";
import { sanitizeFilename, sanitizePathSegment } from "@/lib/storage/contract-document-storage";

/*
 * 면접 일정 이력서(PDF) 저장 — leave-notice-storage 와 동일 규약.
 * 로컬 루트(EMPLOYEE_DOCUMENT_STORAGE_ROOT) 우선, 없으면 S3(MCM_STORAGE_BUCKET).
 * 열람은 calendar_entries.extra.resume 참조 + 참석자/면접 관리자 판정 뒤 스트리밍.
 */

export function buildResumeStorageKey(params: { entryId: string; originalFilename: string }): {
  storageKey: string;
  fileName: string;
} {
  const ext = path.extname(params.originalFilename).slice(0, 16) || ".pdf";
  const base = sanitizePathSegment(path.basename(params.originalFilename, ext));
  const safeName = sanitizeFilename(`${base || "이력서"}${ext}`);
  const storageKey = ["calendar-resumes", sanitizePathSegment(params.entryId), `${Date.now()}-${safeName}`].join("/");
  return { storageKey, fileName: safeName };
}

function assertSafeKey(storageKey: string): void {
  if (!storageKey.startsWith("calendar-resumes/") || storageKey.includes("..") || storageKey.includes("\\")) {
    throw new Error("잘못된 문서 경로입니다.");
  }
}

export async function putResume(storageKey: string, body: Buffer, contentType: string): Promise<void> {
  assertSafeKey(storageKey);
  const localRoot = process.env.EMPLOYEE_DOCUMENT_STORAGE_ROOT?.trim();
  if (localRoot) {
    const target = path.resolve(localRoot, storageKey);
    const root = path.resolve(localRoot);
    if (!target.startsWith(root + path.sep)) throw new Error("문서 저장 경로가 올바르지 않습니다.");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    return;
  }
  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket) throw new Error("EMPLOYEE_DOCUMENT_STORAGE_ROOT 또는 MCM_STORAGE_BUCKET 환경변수가 필요합니다.");
  await getS3Client().send(
    new PutObjectCommand({ Bucket: bucket, Key: storageKey, Body: body, ContentType: contentType, CacheControl: "private, max-age=86400" })
  );
}

export interface ResumeObject {
  body: ReadableStream<Uint8Array> | null;
  contentType: string;
  contentLength: number | null;
}

export async function getResume(storageKey: string): Promise<ResumeObject> {
  assertSafeKey(storageKey);
  const localRoot = process.env.EMPLOYEE_DOCUMENT_STORAGE_ROOT?.trim();
  if (localRoot) {
    const { createReadStream } = await import("node:fs");
    const { stat } = await import("node:fs/promises");
    const target = path.resolve(localRoot, storageKey);
    const root = path.resolve(localRoot);
    if (!target.startsWith(root + path.sep)) throw new Error("잘못된 문서 경로입니다.");
    const st = await stat(target);
    return {
      body: createReadStream(target) as unknown as ReadableStream<Uint8Array>,
      contentType: "application/pdf",
      contentLength: st.size,
    };
  }
  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket) throw new Error("MCM_STORAGE_BUCKET 환경변수가 필요합니다.");
  const out: GetObjectCommandOutput = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
  return {
    body: (out.Body as unknown as ReadableStream<Uint8Array> | undefined) ?? null,
    contentType: out.ContentType ?? "application/pdf",
    contentLength: typeof out.ContentLength === "number" ? out.ContentLength : null,
  };
}

/** 교체·삭제 시 옛 파일 정리 — 실패해도 호출부를 막지 않는다. */
export async function deleteResume(storageKey: string): Promise<void> {
  try {
    assertSafeKey(storageKey);
    const localRoot = process.env.EMPLOYEE_DOCUMENT_STORAGE_ROOT?.trim();
    if (localRoot) {
      await unlink(path.resolve(localRoot, storageKey));
      return;
    }
    const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
    if (!bucket) return;
    await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
  } catch {
    /* 정리 실패는 무시 */
  }
}
