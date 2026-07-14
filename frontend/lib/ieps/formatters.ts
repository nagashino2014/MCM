export interface IndustryDisplay {
  code: string | null;
  name: string | null;
  source?: string | null;
}

export interface ProductDisplay {
  productName: string | null;
  amount: number | null;
  unit: string | null;
}

export function formatCompanyName(value: string | null | undefined): string | null {
  if (!value) return null;
  let out = String(value).replace(/\s+/g, " ").trim();
  out = out.replace(/유\s*한\s*회\s*사/g, "(유)");
  out = out.replace(/\(\s*유\s*\)\s*|（\s*유\s*）\s*/g, "(유)");
  out = out.replace(/\s+\(유\)/g, "(유)");
  out = out.replace(/주\s*식\s*회\s*사/g, "㈜");
  out = out.replace(/\(\s*주\s*\)|（\s*주\s*）/g, "㈜");
  out = out.replace(/(^|\s)주(?=\s|$)/g, "$1㈜");
  out = out.replace(/\s+㈜/g, "㈜");
  out = out.replace(/^㈜\s+/g, "㈜");
  out = out.replace(/㈜(?=\S)/g, (_, offset: number) => (offset === 0 ? "㈜" : "㈜ "));
  out = out.replace(/\s+/g, " ").trim();
  return out || null;
}

export function normalizeCompanyName(value: string | null | undefined): string | null {
  return formatCompanyName(value);
}

export function formatBusinessRegistrationNo(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  }
  return String(value).trim() || null;
}

export function normalizeBusinessRegistrationNo(value: string | null | undefined): string | null {
  return formatBusinessRegistrationNo(value);
}

export function formatAddress(value: string | null | undefined): string | null {
  if (!value) return null;
  let out = String(value).replace(/\s+/g, " ").trim();
  out = out.replace(/\s*([()（）])\s*/g, " $1 ").replace(/\s+/g, " ").trim();
  out = out.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  out = spaceCompactKoreanAddress(out);
  return out || null;
}

export function normalizeAddress(value: string | null | undefined): string | null {
  return formatAddress(value);
}

function spaceCompactKoreanAddress(value: string): string {
  let out = value;
  out = out.replace(
    /(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전북특별자치도|전라북도|전라남도|경상북도|경상남도|제주특별자치도|제주도)(?=[가-힣0-9])/g,
    "$1 "
  );
  out = out.replace(/([가-힣]{1,12}(?:시|군|구))(?=[가-힣0-9])/g, "$1 ");
  out = out.replace(/([가-힣0-9]{1,12}(?:읍|면|동))(?=[가-힣0-9])/g, "$1 ");
  out = out.replace(/([가-힣0-9]+(?:대로|로|길))(?=\d)/g, "$1 ");
  out = out.replace(/([가-힣0-9]{1,12})\s+(시|군|구|읍|면|동)(?=\s|[가-힣0-9]|$)/g, "$1$2");
  return out.replace(/\s+/g, " ").trim();
}

export function cleanProductName(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = String(value)
    .replace(/^(?:주요\s*)?생산품\s*[·ㆍ\-:]?\s*/i, "")
    .replace(/^생산량\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

export function normalizeProduct(product: ProductDisplay): ProductDisplay {
  return {
    productName: cleanProductName(product.productName),
    amount: product.amount == null || Number.isNaN(Number(product.amount)) ? null : Number(product.amount),
    unit: product.unit?.trim() || null,
  };
}

export function formatNumber(value: number | string | null | undefined): string | null {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 3 }).format(n);
}

export function parseIndustriesFromValue(
  code: string | null | undefined,
  name: string | null | undefined
): IndustryDisplay[] {
  const codes = splitIndustryCodes(code);
  // 업종명 자체에 쉼표가 포함된 KSIC 명칭이 많다.
  // 따라서 복수 업종 분리는 코드가 여러 개 기록된 경우에만 수행한다.
  const names = codes.length > 1 ? splitIndustryNames(name) : compactSingle(name);
  const max = Math.max(codes.length, names.length);
  const items: IndustryDisplay[] = [];
  for (let i = 0; i < max; i += 1) {
    items.push({ code: codes[i] ?? null, name: names[i] ?? null, source: "facility" });
  }
  if (items.length === 0 && (code || name)) {
    items.push({ code: code?.trim() || null, name: name?.trim() || null, source: "facility" });
  }
  return dedupeIndustries(items);
}

export function normalizeIndustryDisplay(item: IndustryDisplay): IndustryDisplay {
  let code = normalizeIndustryCode(item.code);
  let name = normalizeIndustryName(item.name);
  const embeddedCode = name?.match(/^(\d{3,5})\s*[,，:：/\-]?\s*(.+)$/);
  if (embeddedCode) {
    code = code ?? embeddedCode[1];
    if (code === embeddedCode[1]) {
      name = normalizeIndustryName(embeddedCode[2]);
    }
  }
  return {
    code,
    name,
    source: item.source ?? null,
  };
}

export function dedupeIndustries(items: IndustryDisplay[]): IndustryDisplay[] {
  const seen = new Set<string>();
  const out: IndustryDisplay[] = [];
  for (const item of items) {
    const normalized = normalizeIndustryDisplay(item);
    const key = industryDedupeKey(normalized);
    if ((!normalized.code && !normalized.name) || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function industryDedupeKey(item: IndustryDisplay): string {
  const codeKey = normalizeIndustryCode(item.code) ?? "";
  const nameKey = (normalizeIndustryName(item.name) ?? "").replace(/\s+/g, "");
  return `${codeKey}|${nameKey}`;
}

function normalizeIndustryCode(value: string | null | undefined): string | null {
  const normalized = normalizeComparableText(value);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, "");
  return digits || normalized;
}

function normalizeIndustryName(value: string | null | undefined): string | null {
  return normalizeComparableText(value);
}

function normalizeComparableText(value: string | null | undefined): string | null {
  const normalized = value
    ?.normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function compactSingle(value: string | null | undefined): string[] {
  const trimmed = value?.trim();
  return trimmed ? [trimmed] : [];
}

function splitIndustryCodes(value: string | null | undefined): string[] {
  if (!value) return [];
  return String(value)
    .split(/\s*[,，/]\s*|\n+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function splitIndustryNames(value: string | null | undefined): string[] {
  if (!value) return [];
  return String(value)
    .split(/\n+|\s*\/\s*|\s*[,，]\s*(?=\d{3,5}\s|[가-힣A-Za-z]+(?:업|제조업)\s*[,，]|$)/)
    .map((v) => v.trim())
    .filter(Boolean);
}
