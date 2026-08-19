/**
 * PII 앱 레벨 암호화 공용 모듈 — 개인정보보호 블루프린트 PR-P3.
 *
 * 배경(G3): 종전 employee-records.ts 는 전용 키 미설정 시 세션 시크릿(AUTH_SECRET)
 * 을 PII 암호키로 재사용하고, 그마저 없으면 소스에 하드코딩된 문자열로 폴백했다.
 * → 세션 시크릿 로테이션 = 주민번호 복호 불가 사고, 하드코딩 = 키 유출과 동일.
 *
 * 원칙:
 * - 암호화는 항상 전용 키(EMPLOYEE_PII_ENCRYPTION_KEY, Secrets Manager 주입)로만 한다.
 *   production 에서 전용 키가 없으면 즉시 실패(폴백 금지). 개발 환경만 legacy 체인 허용(경고 1회).
 * - 복호는 전용 키 → legacy 키(구 암호문 호환) 순으로 시도한다 — 재암호화 이전 데이터 안전.
 * - 포맷은 기존과 동일: "iv.tag.ciphertext" (각 base64, AES-256-GCM).
 */

import crypto from "node:crypto";

let devFallbackWarned = false;

function deriveKey(source: string): Buffer {
  return crypto.createHash("sha256").update(source).digest();
}

/** 암호화용 키 — 전용 키 강제(production). */
function primaryKey(): Buffer {
  const dedicated = process.env.EMPLOYEE_PII_ENCRYPTION_KEY;
  if (dedicated) return deriveKey(dedicated);
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "EMPLOYEE_PII_ENCRYPTION_KEY 가 설정되지 않았습니다 — PII 암호화 전용 키 없이는 저장할 수 없습니다(PR-P3)."
    );
  }
  if (!devFallbackWarned) {
    devFallbackWarned = true;
    console.warn("[pii-crypto] ⚠ 개발 환경 — 전용 키 미설정으로 legacy 키 체인을 사용합니다.");
  }
  return deriveKey(process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "mcm-local-development-key");
}

/** 복호 후보 키 — 전용 키 + 구 암호문 호환용 legacy 체인. */
function candidateKeys(): Buffer[] {
  const sources = [
    process.env.EMPLOYEE_PII_ENCRYPTION_KEY,
    process.env.NEXTAUTH_SECRET,
    process.env.AUTH_SECRET,
    "mcm-local-development-key",
  ].filter((s): s is string => Boolean(s));
  return [...new Set(sources)].map(deriveKey);
}

export function encryptPii(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", primaryKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

/** 복호 — 전용 키 → legacy 키 순 시도. 어떤 키로도 안 풀리면 null(예외 아님 — 호출측 판단). */
export function decryptPii(payload: string): string | null {
  const parts = payload.split(".");
  if (parts.length !== 3) return null;
  const [ivB64, tagB64, ctB64] = parts;
  for (const key of candidateKeys()) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
      decipher.setAuthTag(Buffer.from(tagB64, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
    } catch {
      // 다음 후보 키로.
    }
  }
  return null;
}

/**
 * 주민번호 앞자리(생년월일 6자리) 데이터 최소화 — 저장 시 생년 2자리만 남기고 마스킹.
 * 자녀 나이 계산(rules.ts, slice(0,2))·EDI 참고 표시는 이 형태로 충분하다(PR-P3 §G3).
 */
export function maskRrnPrefix(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `${digits.slice(0, 2)}****`;
}
