/** 사업장 원본 진단. 표시용 포맷터와 달리 가림값·복수번호를 추정 복원하지 않는다. */
export const RULE_VERSION = "2026-09-08.1";
export const FIELDS = ["business_registration_no", "phone_number", "representative_name", "corporate_registration_no", "site_address"] as const;
export type Field = typeof FIELDS[number];
export const LABELS: Record<Field, string> = {
  business_registration_no: "사업자번호", phone_number: "전화번호", representative_name: "대표자명",
  corporate_registration_no: "법인등록번호", site_address: "주소",
};
export type Quality = "valid" | "missing" | "format" | "review" | "conflict" | "not_applicable";
export type Diagnosis = { status: Quality; value: string | null; reason: string; normalized?: string; kind?: string };
export type Snapshot = Record<string, unknown> & {
  facility_id: string; company_name: string; business_registration_no: string | null;
  site_business_registration_no: string | null; phone_number: string | null; representative_name: string | null;
  corporate_registration_no: string | null; business_certificate_corporate_registration_no: string | null;
  site_address: string | null;
};
export const cleanSpace = (s: string) => s.replace(/\s+/g, " ").trim();
export const identifier = (s: unknown) => typeof s === "string" && /^[\d\s-]+$/.test(s) ? s.replace(/[\s-]/g, "") : "";
export function validBrn(d: string): boolean {
  if (!/^\d{10}$/.test(d) || /^0+$/.test(d)) return false;
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const sum = weights.reduce((n, w, i) => n + Number(d[i]) * w, 0) + Math.floor(Number(d[8]) * 5 / 10);
  return (10 - sum % 10) % 10 === Number(d[9]);
}
export function diagnose(field: Field, raw: unknown): Diagnosis {
  const value = typeof raw === "string" ? raw : raw == null ? null : String(raw);
  const s = cleanSpace(value ?? "");
  const result = (status: Quality, reason: string, normalized?: string, kind?: string): Diagnosis => ({ status, value, reason, normalized, kind });
  if (!s || /^(?:미상|없음|미입력|미확인|알수없음|unknown|null|n\/?a|-+)$/i.test(s)) return result("missing", "값 확인 필요");
  const maskInput = field === "site_address" ? s.replace(/개[＊*](?=\s*필지)/g, "개") : s;
  if (/[＊*●]|비공개/.test(maskInput) || /[xX]{3,}|[○ㅇ]{3,}/.test(s)) return result("review", "가림값은 복원하지 않습니다");
  const normalized = (v: string, kind?: string) => result(value === v ? "valid" : "format", value === v ? "정상" : "문자·숫자 변화 없는 표기 정리", v, kind);
  if (field === "business_registration_no" || field === "corporate_registration_no") {
    const d = identifier(s);
    if (field === "business_registration_no") {
      if (!validBrn(d)) return result("review", d.length === 10 ? "사업자번호 검증자리 확인 필요" : "사업자번호는 숫자 10자리여야 합니다");
      return normalized(`${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`);
    }
    if (!/^\d{13}$/.test(d) || /^0+$/.test(d)) return result("review", "법인번호는 숫자 13자리여야 합니다");
    return normalized(`${d.slice(0, 6)}-${d.slice(6)}`);
  }
  if (field === "phone_number") {
    if (/[;,/\n]|내선|ext\.?|~|∼|\b(?:fax)\b/i.test((value ?? "").trim())) return result("review", "복수번호·내선은 원문을 유지하고 검토합니다", undefined, "multiple_or_extension");
    if (/^\+/.test(s)) return /^\+[1-9][\d ()-]{6,24}$/.test(s) ? result("valid", "국제번호 원문 유지", undefined, "international") : result("review", "국제번호 확인 필요");
    if (!/^[\d\s().\-‐‑–—]+$/.test(s)) return result("review", "전화번호에 설명·알 수 없는 문자가 있습니다");
    const d = s.replace(/[\s().\-‐‑–—]/g, "");
    if (/^1[568]\d{6}$/.test(d)) return normalized(`${d.slice(0, 4)}-${d.slice(4)}`, "national");
    if (/^02\d{7,8}$/.test(d)) return normalized(`02-${d.slice(2, -4)}-${d.slice(-4)}`);
    if (/^(?:0(?:3[1-3]|4[1-4]|5[1-5]|6[1-4]|70|80)|01[016789])\d{7,8}$/.test(d)) return normalized(`${d.slice(0, 3)}-${d.slice(3, -4)}-${d.slice(-4)}`);
    if (/^050\d{8,9}$/.test(d)) return result("valid", "안심번호 원문 유지", undefined, "virtual");
    return result("review", "전화 접두부·자리수 확인 필요");
  }
  if (field === "site_address" && (s.length < 8 || !/\d/.test(s))) return result("review", "상세 소재지가 부족합니다");
  return normalized(s);
}
export function audit(s: Snapshot): Record<Field, Diagnosis> & { secondary: Record<string, Diagnosis> } {
  const out = Object.fromEntries(FIELDS.map(f => [f, diagnose(f, s[f])])) as Record<Field, Diagnosis>;
  const secondary = {
    site_business_registration_no: diagnose("business_registration_no", s.site_business_registration_no),
    business_certificate_corporate_registration_no: diagnose("corporate_registration_no", s.business_certificate_corporate_registration_no),
  };
  for (const [a, b] of [["business_registration_no", "site_business_registration_no"], ["corporate_registration_no", "business_certificate_corporate_registration_no"]] as const) {
    if (s[a]?.trim() && s[b]?.trim() && (!identifier(s[a]) || identifier(s[a]) !== identifier(s[b]))) {
      out[a] = { ...out[a], status: "conflict", normalized: undefined, reason: `${b === "site_business_registration_no" ? "사업장용 사업자번호" : "등록증 법인번호"}와 원본 불일치` };
    }
  }
  return { ...out, secondary };
}
export function normalizeInput(field: Field, value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw Object.assign(new Error(`${LABELS[field]}는 문자로 입력하세요`), { status: 400 });
  const d = diagnose(field, value);
  if (d.status === "missing") return null;
  if (d.status === "review" && d.kind !== "multiple_or_extension") throw Object.assign(new Error(`${LABELS[field]}: ${d.reason}`), { status: 400 });
  return d.normalized ?? value.trim();
}

export type Source = "format" | "naver" | "nice" | "dart" | "fsc" | "bizno" | "ingestion";
export interface Profile {
  source: Exclude<Source, "format" | "ingestion">;
  name: string; url: string; retrievedAt: string; sourceDate?: string | null; externalId?: string;
  firstPublishedAt?: string | null; lastPublishedAt?: string | null;
  values: Partial<Record<Field, string>>; scope: "headquarters" | "site" | "unknown";
}
export type Proposal = { field: Field; value: string; source: Source; url: string | null; evidence: Record<string, unknown>; match: "format" | "entity" | "site" | "review" | "blocked"; recommended: boolean };
export const nameKey = (s: string) => s.normalize("NFKC").replace(/주식회사|유한회사|\(주\)|\(유\)|㈜/g, "").replace(/[\s.,·()]/g, "").toLowerCase();
/** 검색만 위한 제한적 본사명 후보. 공장명을 지웠다는 사실은 동일 업체 검증이 아니다. */
export function searchNames(s: string): string[] {
  const normalized = s.normalize("NFKC");
  const base = normalized.replace(/(?:\s+|\()[^\s()]{0,12}(?:공장|사업소|사업장|지점|본점)\)?\s*$/, "").trim();
  return [...new Set([s, ...(base.length >= 2 && base !== normalized ? [base] : [])])];
}
export function proposals(s: Snapshot, p: Profile): Proposal[] {
  const local = audit(s);
  const localBrn = identifier(s.business_registration_no || s.site_business_registration_no);
  const brn = identifier(p.values.business_registration_no);
  const crn = identifier(p.values.corporate_registration_no);
  const ownCrn = identifier(s.corporate_registration_no || s.business_certificate_corporate_registration_no);
  const conflict = (!!localBrn && !!brn && localBrn !== brn) || (!!ownCrn && !!crn && ownCrn !== crn) || local.business_registration_no.status === "conflict" || local.corporate_registration_no.status === "conflict";
  const sameEntity = (validBrn(localBrn) && localBrn === brn) || (ownCrn.length === 13 && ownCrn === crn);
  const sameName = nameKey(s.company_name) === nameKey(p.name);
  const sameCorporateName = searchNames(s.company_name).slice(1).some(n => nameKey(n) === nameKey(p.name));
  const sameAddress = !!s.site_address && !!p.values.site_address && cleanSpace(s.site_address) === cleanSpace(p.values.site_address);
  const sameSite = sameAddress && (sameEntity || sameName);
  // 이름만 같은 후보는 표시 가능하지만 절대로 추천하지 않는다. 번호 불일치는 반영 자체를 금지한다.
  if (!sameEntity && !sameName && !sameCorporateName) return [];
  const out: Proposal[] = [];
  for (const field of FIELDS) {
    if (p.source === "bizno" && field === "representative_name") continue;
    const raw = p.values[field];
    if (!raw) continue;
    const d = diagnose(field, raw);
    if (!["valid", "format"].includes(d.status)) continue;
    const value = d.normalized ?? raw;
    if (value === s[field]) continue;
    const siteField = field === "site_address" || field === "phone_number" || field === "business_registration_no";
    const match = conflict ? "blocked" : sameSite ? "site" : sameEntity && !siteField ? "entity" : "review";
    out.push({ field, value, source: p.source, url: p.url, match, recommended: false, evidence: {
      name: p.name, retrievedAt: p.retrievedAt, sourceDate: p.sourceDate ?? null, externalId: p.externalId ?? null,
      firstPublishedAt:p.firstPublishedAt??null,lastPublishedAt:p.lastPublishedAt??null,
      scope: p.scope, sameEntity, sameName, sameCorporateName, sameAddress, reason: conflict ? "등록번호·원본 컬럼 충돌" : siteField && !sameSite ? "본사와 해당 사업장 일치 여부를 확인하세요" : p.source === "naver" && field === "representative_name" ? "대표자 우선 출처 · 동일 법인 및 최신성 검토 후 선택 반영" : "외부 후보는 검토 후 선택 반영",
      // 비즈노 대표자명은 이 근거에도 들어갈 수 없다.
      identifiers: { brn: brn || null, crn: crn || null },
    } });
  }
  return out;
}
export function formatProposals(s: Snapshot): Proposal[] {
  const d = audit(s);
  return FIELDS.flatMap(field => d[field].status === "format" && d[field].normalized ? [{ field, value: d[field].normalized!, source: "format" as const, url: null, evidence: { reason: d[field].reason }, match: "format" as const, recommended: true }] : []);
}
