// 바로빌(Barobill) SOAP 커넥터 코어 — 서버 전용
// - 바로빌은 .asmx SOAP 웹서비스. 인증 = CERTKEY + CorpNum + ID (매 호출 전달).
// - 실측 확정(2026-08-15, scripts/barobill-demo):
//   · SOAP 네임스페이스 = http://ws.baroservice.com/ (테스트베드 포함. tempuri.org 아님)
//   · 파라미터 삽입 순서 = 바로빌 문서의 파라미터 순서 그대로여야 함
//   · leaf 텍스트 값은 XML 엔티티 언이스케이프 필수 (&amp; 미복원 시 관리 URL 깨짐)
//   · 반환 음수(1~5자리) = 오류코드 → getErrString으로 메시지 조회
// - 요금이 실제 발생하는 운영(prod) 전환은 BAROBILL_ENV=prod + 운영 CERTKEY(ECS 태스크 정의 주입)로만.

const HOSTS = {
  test: "https://testws.baroservice.com",
  prod: "https://ws.baroservice.com",
} as const;

const NS = "http://ws.baroservice.com/";

export type BarobillEnv = keyof typeof HOSTS;
export type BarobillService = "BANKACCOUNT" | "CARD" | "TI";

export interface BarobillConfig {
  env: BarobillEnv;
  certKey: string;
  corpNum: string; // 하이픈 제외 10자리
  id: string; // 바로빌 회원 아이디
}

let cachedConfig: BarobillConfig | null = null;

export function getBarobillConfig(): BarobillConfig {
  if (cachedConfig) return cachedConfig;
  const certKey = process.env.BAROBILL_CERTKEY || "";
  const corpNum = (process.env.BAROBILL_CORPNUM || "").replace(/[^0-9]/g, "");
  const id = process.env.BAROBILL_ID || "";
  const env: BarobillEnv = process.env.BAROBILL_ENV === "prod" ? "prod" : "test";
  if (!certKey || !corpNum || !id) {
    throw new Error("바로빌 환경변수 미설정: BAROBILL_CERTKEY / BAROBILL_CORPNUM / BAROBILL_ID");
  }
  cachedConfig = { env, certKey, corpNum, id };
  return cachedConfig;
}

export const escXml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// XML 엔티티 복원 — leaf 텍스트(URL·상호·입금자명 등)에 반드시 적용
export function unescXml(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 중첩 구조체 파라미터(TaxInvoice 등) — 이미 만들어 둔 XML 조각을 이스케이프 없이 그대로 넣는다. */
export interface RawXml {
  __rawXml: string;
}
export const rawXml = (xml: string): RawXml => ({ __rawXml: xml });
const isRawXml = (v: unknown): v is RawXml => typeof v === "object" && v !== null && "__rawXml" in v;

// params 삽입 순서 = 바로빌 파라미터 순서 그대로 (Object 삽입 순서 유지 특성 사용)
function soapEnvelope(method: string, params: Record<string, unknown>): string {
  const inner = Object.entries(params)
    .map(([key, value]) => `<${key}>${isRawXml(value) ? value.__rawXml : escXml(value)}</${key}>`)
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="${NS}">${inner}</${method}>
  </soap:Body>
</soap:Envelope>`;
}

export class BarobillError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly method?: string,
  ) {
    super(message);
    this.name = "BarobillError";
  }
}

export async function soapCall(
  service: BarobillService,
  method: string,
  params: Record<string, unknown>,
  options?: { env?: BarobillEnv; timeoutMs?: number },
): Promise<string> {
  const env = options?.env ?? getBarobillConfig().env;
  const url = `${HOSTS[env]}/${service}.asmx`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 30000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: NS + method },
      body: soapEnvelope(method, params),
      signal: controller.signal,
      cache: "no-store",
    });
    const xml = await res.text();
    if (!res.ok) {
      const fault = pick(xml, "faultstring");
      throw new BarobillError(
        `바로빌 SOAP ${method} HTTP ${res.status}${fault ? `: ${fault.slice(0, 200)}` : ""}`,
        undefined,
        method,
      );
    }
    return xml;
  } finally {
    clearTimeout(timer);
  }
}

// ── 간단 XML 추출 (의존성 없이 — 바로빌 응답은 네임스페이스 접두사 없는 평탄한 구조) ──
export function pick(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

export function pickText(xml: string, tag: string): string {
  return unescXml(pick(xml, tag) ?? "");
}

export function pickAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

export function methodResult(xml: string, method: string): string | null {
  return pick(xml, `${method}Result`);
}

// 반환값이 음수 오류코드(1~5자리)인지
export function isErrCode(value: string | null | undefined): boolean {
  return typeof value === "string" && /^-\d{1,5}$/.test(value.trim());
}

export async function getErrString(code: string): Promise<string> {
  try {
    const { certKey } = getBarobillConfig();
    const xml = await soapCall("BANKACCOUNT", "GetErrString", { CERTKEY: certKey, ErrCode: code });
    return pickText(xml, "GetErrStringResult") || `오류코드 ${code}`;
  } catch {
    return `오류코드 ${code}`;
  }
}

// int 반환 메서드 공통 처리: 1=성공, 음수=오류코드(메시지 조회 후 throw)
export async function expectOk(xml: string, method: string): Promise<void> {
  const result = methodResult(xml, method);
  if (result === "1") return;
  if (isErrCode(result)) {
    const msg = await getErrString(result!);
    throw new BarobillError(`${method} 실패(${result}): ${msg}`, result!, method);
  }
  throw new BarobillError(`${method} 예상 밖 반환값: ${result}`, undefined, method);
}

// 문자열(URL 등) 반환 메서드 공통 처리
export async function expectString(xml: string, method: string): Promise<string> {
  const result = methodResult(xml, method);
  const text = unescXml(result ?? "");
  if (!text || isErrCode(text)) {
    const code = isErrCode(text) ? text : undefined;
    const msg = code ? await getErrString(code) : "빈 응답";
    throw new BarobillError(`${method} 실패${code ? `(${code})` : ""}: ${msg}`, code, method);
  }
  return text;
}

// 조회 API 는 최대 200일/호출 — 초과 기간은 190일 청크로 분할해 순차 조회한다.
export function splitDateRange(startYmd: string, endYmd: string, chunkDays = 190): Array<{ start: string; end: string }> {
  const toDate = (ymd: string) => new Date(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}T00:00:00Z`);
  const toYmd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const out: Array<{ start: string; end: string }> = [];
  let cursor = toDate(startYmd);
  const end = toDate(endYmd);
  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + (chunkDays - 1) * 86400000, end.getTime()));
    out.push({ start: toYmd(cursor), end: toYmd(chunkEnd) });
    cursor = new Date(chunkEnd.getTime() + 86400000);
  }
  return out;
}

// "YYYYMMDDHHMMSS" | "YYYYMMDD" → "YYYY-MM-DD HH:MI:SS" | "YYYY-MM-DD"
export function formatBarobillDT(dt: string | null | undefined): string | null {
  const digits = String(dt ?? "").replace(/[^0-9]/g, "");
  if (digits.length >= 14) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)} ${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}`;
  }
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return null;
}
