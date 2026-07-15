/**
 * 스크래퍼 소스 인증키 암복호화 (AES-256-GCM).
 * 마스터키는 기존 AUTH_SECRET(없으면 SCRAPER_MASTER_KEY)에서 sha256 파생 — 추가 env·재배포 불필요.
 * 저장 형식: "iv:tag:ciphertext"(각 base64). 복호화는 서버 실행 시점에만.
 */
import crypto from "node:crypto";

function masterKey(): Buffer {
  const s = process.env.AUTH_SECRET || process.env.SCRAPER_MASTER_KEY;
  if (!s) throw new Error("secret_key_not_configured");
  return crypto.createHash("sha256").update(s).digest(); // 32 bytes
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

/** 복호화. 형식/키 불일치 시 null(실행측이 ENV 폴백/에러 처리). */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parts = stored.split(":");
  if (parts.length !== 3) return null;
  try {
    const [ivB, tagB, encB] = parts;
    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
