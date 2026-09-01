/**
 * S3 기반 채용공고 템플릿 원본(핸드오프 패키지) 저장소.
 *
 * 파싱된 노드트리는 DB(recruit_templates.design_tree)에 있으므로 원본 파일은
 * 감사·재파싱 대비용 보관이다. logo-storage 와 동일한 운영 모델(비공개 객체, 같은 버킷).
 */
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client, getLogoBucket } from "./logo-storage";

export const RECRUIT_TEMPLATE_KEY_PREFIX = "uploads/recruit-templates/";

function sanitizeKeySegment(filename: string): string {
  // 원문 파일명은 한글 등 비ASCII 가 흔하므로 key 는 확장자만 살리고 UUID 로 만든다.
  const ext = /\.(html?|zip)$/i.exec(filename)?.[0]?.toLowerCase() ?? ".bin";
  return crypto.randomUUID() + ext;
}

export async function putRecruitTemplateSource(
  filename: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const key = RECRUIT_TEMPLATE_KEY_PREFIX + sanitizeKeySegment(filename);
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getLogoBucket(),
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
      Metadata: { "original-name": encodeURIComponent(filename).slice(0, 512) },
    })
  );
  return key;
}

export async function getRecruitTemplateSource(key: string) {
  if (!key.startsWith(RECRUIT_TEMPLATE_KEY_PREFIX) || key.includes("..")) {
    throw new Error("잘못된 템플릿 원본 키입니다.");
  }
  return getS3Client().send(new GetObjectCommand({ Bucket: getLogoBucket(), Key: key }));
}
