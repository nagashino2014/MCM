import crypto from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getS3Client } from "@/lib/storage/logo-storage";
import { sanitizeFilename, sanitizePathSegment } from "@/lib/storage/contract-document-storage";

/**
 * 메일 대용량 첨부(261, 2026-09-17) — 원문 첨부 한도(25MB)를 넘는 파일을 S3 에 올리고 본문에 다운로드 링크로 넣는다.
 * 흐름: 작성 화면이 발급(presigned PUT) → 브라우저가 S3 에 직접 업로드 → 발송 API 가 확인(HEAD)·링크 블록 삽입 → 발송 후 확정.
 * 링크(/api/mail/large/<token>)는 외부 수신자용 무인증 경로이며, 요청 시점에 짧은 presigned GET 으로 넘긴다
 * (본문에 presigned URL 을 직접 넣으면 태스크 역할 자격증명 만료와 함께 링크가 죽는다).
 */

/** 원문(MIME) 첨부 총량 — SES·수신 측 한도 기준(api/mail/send 와 동일). */
export const MAIL_MIME_ATTACH_LIMIT_BYTES = 25 * 1024 * 1024;
/** 대용량 첨부 파일당 상한 — 브라우저 단일 PUT 업로드 현실 한도. */
export const MAIL_LARGE_ATTACH_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** 다운로드 링크 보관기간(일). */
export const MAIL_LARGE_ATTACH_DAYS = 30;

const PUT_EXPIRES_SEC = 60 * 60; // 업로드 시작까지 1시간(큰 파일은 시작만 되면 끝까지 간다)
const GET_EXPIRES_SEC = 5 * 60;

export interface LargeAttachmentRow {
  uploadId: string;
  token: string;
  userId: string;
  fileName: string;
  contentType: string | null;
  byteSize: number;
  storageKey: string;
  status: "pending" | "sent";
  messageId: string | null;
  expiresAt: string | null;
  downloadCount: number;
}

function bucketOrThrow(): string {
  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket || process.env.CONTRACT_DOCUMENT_STORAGE_ROOT?.trim()) {
    throw Object.assign(new Error("대용량 첨부는 S3 스토리지에서만 사용할 수 있습니다."), { status: 500 });
  }
  return bucket;
}

function mapRow(r: Record<string, unknown>): LargeAttachmentRow {
  return {
    uploadId: String(r.upload_id),
    token: String(r.token),
    userId: String(r.user_id),
    fileName: String(r.file_name),
    contentType: r.content_type != null ? String(r.content_type) : null,
    byteSize: Number(r.byte_size ?? 0),
    storageKey: String(r.storage_key),
    status: String(r.status) === "sent" ? "sent" : "pending",
    messageId: r.message_id != null ? String(r.message_id) : null,
    expiresAt: r.expires_at != null ? String(r.expires_at) : null,
    downloadCount: Number(r.download_count ?? 0),
  };
}

/** 업로드 발급 — presigned PUT URL + 대기 행. */
export async function createLargeAttachmentUpload(
  userId: string,
  input: { fileName: string; contentType: string; byteSize: number }
): Promise<{ uploadId: string; url: string }> {
  if (!(input.byteSize > 0) || input.byteSize > MAIL_LARGE_ATTACH_MAX_BYTES) {
    throw Object.assign(new Error("대용량 첨부는 파일당 2GB 까지 보낼 수 있습니다."), { status: 413 });
  }
  const bucket = bucketOrThrow();
  const fileName = sanitizeFilename(input.fileName || "file");
  const uploadId = `mla-${crypto.randomBytes(8).toString("hex")}`;
  const token = crypto.randomBytes(32).toString("base64url");
  const storageKey = ["mail-large", sanitizePathSegment(userId), uploadId, fileName].join("/");
  const contentType = input.contentType || "application/octet-stream";
  const url = await getSignedUrl(getS3Client(), new PutObjectCommand({ Bucket: bucket, Key: storageKey, ContentType: contentType }), {
    expiresIn: PUT_EXPIRES_SEC,
  });
  await withDbWrite(async (db) => {
    await db.exec(
      `INSERT INTO mail_large_attachments (upload_id, token, user_id, file_name, content_type, byte_size, storage_key, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
      [uploadId, token, userId, fileName, contentType, input.byteSize, storageKey, new Date().toISOString()]
    );
  });
  return { uploadId, url };
}

/** 발송 직전 확인 — 본인 대기 행 + S3 실제 업로드 여부(크기는 S3 값으로 갱신). */
export async function prepareLargeAttachments(userId: string, uploadIds: string[]): Promise<LargeAttachmentRow[]> {
  const ids = [...new Set(uploadIds.map(String).filter(Boolean))];
  if (!ids.length) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT * FROM mail_large_attachments WHERE upload_id = ANY($1::text[]) AND user_id = $2`, [ids, userId])
  ).map(mapRow);
  if (rows.length !== ids.length) {
    throw Object.assign(new Error("대용량 첨부 정보를 찾을 수 없습니다. 파일을 다시 첨부해 주세요."), { status: 400 });
  }
  const bucket = bucketOrThrow();
  for (const r of rows) {
    try {
      const head = await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: r.storageKey }));
      if (typeof head.ContentLength === "number") r.byteSize = head.ContentLength;
    } catch {
      throw Object.assign(new Error(`'${r.fileName}' 업로드가 끝나지 않았습니다. 다시 시도해 주세요.`), { status: 400 });
    }
    // presigned PUT 은 크기를 묶지 않으므로 실제 올라간 크기로 상한을 다시 본다
    if (r.byteSize > MAIL_LARGE_ATTACH_MAX_BYTES) {
      throw Object.assign(new Error(`'${r.fileName}' — 대용량 첨부는 파일당 2GB 까지 보낼 수 있습니다.`), { status: 413 });
    }
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.uploadId) ?? 0) - (order.get(b.uploadId) ?? 0));
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** 본문 상단에 넣을 대용량 첨부 블록(HTML). 외부 메일 클라이언트용 인라인 스타일. */
export function buildLargeAttachmentBlock(rows: LargeAttachmentRow[]): string {
  if (!rows.length) return "";
  const base = (process.env.APP_PUBLIC_URL ?? "https://koensain.app").replace(/\/+$/, "");
  const until = new Date(Date.now() + 9 * 3600 * 1000 + MAIL_LARGE_ATTACH_DAYS * 86400 * 1000).toISOString().slice(0, 10);
  const items = rows
    .map(
      (r) =>
        `<li style="margin:3px 0"><a href="${base}/api/mail/large/${encodeURIComponent(r.token)}" style="color:#2f5fe0;text-decoration:none">${esc(r.fileName)}</a>` +
        ` <span style="color:#888">(${sizeLabel(r.byteSize)})</span></li>`
    )
    .join("");
  return (
    `<div style="border:1px solid #dfe3ea;border-radius:8px;padding:10px 14px;margin:0 0 14px;font-size:13px;background:#f8f9fb">` +
    `<div style="font-weight:700;margin-bottom:4px">대용량 첨부 ${rows.length}개 <span style="font-weight:400;color:#888">— ${until}까지 내려받을 수 있습니다</span></div>` +
    `<ul style="margin:0;padding-left:18px">${items}</ul></div>`
  );
}

/** 발송 성공 후 확정 — 링크 유효기간 시작. */
export async function markLargeAttachmentsSent(uploadIds: string[], messageId: string | null): Promise<void> {
  if (!uploadIds.length) return;
  const expiresAt = new Date(Date.now() + MAIL_LARGE_ATTACH_DAYS * 86400 * 1000).toISOString();
  await withDbWrite(async (db) => {
    await db.exec(
      `UPDATE mail_large_attachments SET status = 'sent', message_id = COALESCE($2, message_id), expires_at = COALESCE(expires_at, $3)
        WHERE upload_id = ANY($1::text[])`,
      [uploadIds, messageId, expiresAt]
    );
  });
}

/** 다운로드 — 토큰 확인 후 짧은 presigned GET URL. 만료·미발송·없음은 null. */
export async function resolveLargeAttachmentDownload(token: string): Promise<{ url: string } | { expired: true } | null> {
  if (!token || token.length < 20) return null;
  const db = await getDb();
  const row = rowsToObjects(await db.exec(`SELECT * FROM mail_large_attachments WHERE token = $1`, [token]))[0];
  if (!row) return null;
  const r = mapRow(row);
  if (r.status !== "sent") return null;
  if (r.expiresAt && r.expiresAt < new Date().toISOString()) return { expired: true };
  const bucket = bucketOrThrow();
  const url = await getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: r.storageKey,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(r.fileName)}`,
      ResponseContentType: r.contentType || "application/octet-stream",
    }),
    { expiresIn: GET_EXPIRES_SEC }
  );
  await withDbWrite(async (txn) => {
    await txn.exec(
      `UPDATE mail_large_attachments SET download_count = download_count + 1, last_downloaded_at = $2 WHERE upload_id = $1`,
      [r.uploadId, new Date().toISOString()]
    );
  }).catch(() => undefined);
  return { url };
}
