/**
 * 네이버 CLOVA OCR(General, VPC) 호출 헬퍼.
 * - Invoke URL/Secret 은 Secrets Manager(mcm-ieps-staging/app) → 태스크 env: CLOVA_OCR_URL, CLOVA_OCR_SECRET.
 * - PDF/이미지를 base64 로 실어 보내고, 필드 inferText 를 lineBreak 기준으로 이어붙여 원문 텍스트를 만든다.
 * - 후단의 parseBusinessCertificateText 가 이 텍스트를 필드로 파싱한다.
 */

import { randomUUID } from "node:crypto";

interface ClovaField {
  inferText?: string;
  lineBreak?: boolean;
}
interface ClovaImage {
  inferResult?: string;
  message?: string;
  fields?: ClovaField[];
}
interface ClovaResponse {
  images?: ClovaImage[];
}

const IMAGE_FORMATS = ["jpg", "jpeg", "png", "pdf", "tiff", "tif"];

export function isClovaConfigured(): boolean {
  return Boolean(process.env.CLOVA_OCR_URL && process.env.CLOVA_OCR_SECRET);
}

/** CLOVA OCR 로 파일을 인식해 원문 텍스트를 반환. 실패 시 throw. */
export async function clovaOcr(file: File): Promise<string> {
  const url = process.env.CLOVA_OCR_URL;
  const secret = process.env.CLOVA_OCR_SECRET;
  if (!url || !secret) throw new Error("CLOVA_OCR_URL/CLOVA_OCR_SECRET 미설정");

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
  const format = IMAGE_FORMATS.includes(ext) ? ext : "pdf";

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-OCR-SECRET": secret },
    body: JSON.stringify({
      version: "V2",
      requestId: randomUUID(),
      timestamp: Date.now(),
      images: [{ format, name: "business-certificate", data: buf.toString("base64") }],
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`CLOVA OCR HTTP ${res.status} ${t.slice(0, 300)}`);
  }

  const json = (await res.json()) as ClovaResponse;
  const images = json.images ?? [];
  const failed = images.find((img) => img.inferResult && img.inferResult !== "SUCCESS");
  if (failed) throw new Error(`CLOVA OCR inferResult=${failed.inferResult} ${failed.message ?? ""}`);

  let text = "";
  for (const img of images) {
    for (const f of img.fields ?? []) {
      text += f.inferText ?? "";
      text += f.lineBreak ? "\n" : " ";
    }
  }
  return text.trim();
}
