/**
 * S3 기반 사업장 로고 저장소.
 *
 * 운영 모델 메모:
 * - ECS Fargate 의 컨테이너는 ephemeral 이라 로컬 fs 기반 업로드는 컨테이너 재시작 시 사라진다.
 *   그래서 사업장 로고는 S3 (`s3://$MCM_STORAGE_BUCKET/uploads/logos/<key>`) 에 저장한다.
 * - DB 의 `*.logo_path` 값은 기존 형식(`/uploads/logos/<key>`) 을 그대로 보존한다.
 *   외부에서 보면 URL 형식이 동일하지만 실제 바이너리는 S3 가 들고 있다.
 * - 객체는 비공개. 클라이언트는 같은 origin 의 인증된 프록시 GET 라우트를 통해서만 받는다.
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";

export const LOGO_KEY_PREFIX = "uploads/logos/";

let cachedClient: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region:
        process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-northeast-2",
    });
  }
  return cachedClient;
}

export function getLogoBucket(): string {
  const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
  if (!bucket) {
    throw new Error(
      "MCM_STORAGE_BUCKET 환경변수가 설정되지 않았습니다. ECS task definition / 로컬 .env 를 확인하세요."
    );
  }
  return bucket;
}

/**
 * 외부 URL 인 `/uploads/logos/<key>` 형식에서 S3 key 부분(`uploads/logos/<key>`) 만 안전하게 추출.
 * path traversal 또는 다중 세그먼트 키를 방지한다 (현재 키는 UUID + 확장자 단일 세그먼트).
 */
export function sanitizeLogoFilename(filename: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
    throw new Error("잘못된 로고 파일명입니다.");
  }
  return filename;
}

export async function putLogoObject(
  filename: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  const safe = sanitizeLogoFilename(filename);
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getLogoBucket(),
      Key: LOGO_KEY_PREFIX + safe,
      Body: body,
      ContentType: contentType,
      CacheControl: "private, max-age=86400",
    })
  );
}

export interface LogoObject {
  body: ReadableStream<Uint8Array> | null;
  contentType: string;
  contentLength: number | null;
  cacheControl: string | null;
  etag: string | null;
  lastModified: Date | null;
}

export async function getLogoObject(filename: string): Promise<LogoObject> {
  const safe = sanitizeLogoFilename(filename);
  const out: GetObjectCommandOutput = await getS3Client().send(
    new GetObjectCommand({
      Bucket: getLogoBucket(),
      Key: LOGO_KEY_PREFIX + safe,
    })
  );
  // SDK 반환 Body 는 Node Readable + AWS SDK Stream union 이지만, Web ReadableStream 으로 변환해
  // NextResponse 가 그대로 스트리밍하도록 한다.
  const body = out.Body as unknown as ReadableStream<Uint8Array> | undefined;
  return {
    body: body ?? null,
    contentType: out.ContentType ?? "application/octet-stream",
    contentLength:
      typeof out.ContentLength === "number" ? out.ContentLength : null,
    cacheControl: out.CacheControl ?? null,
    etag: out.ETag ?? null,
    lastModified: out.LastModified ?? null,
  };
}
