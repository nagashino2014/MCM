import { createHash } from "node:crypto";
import type { KosisSeriesConfig, OfficialPermissions, OfficialProviderDefinition, OfficialProviderId, OfficialSourceConfig, OfficialSourceStoredState, OfficialSourceUpdate, OfficialSourceState } from "./official-sources-types";

export class OfficialSourceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const OFFICIAL_PROVIDERS: readonly OfficialProviderDefinition[] = [
  { id: "kosis", name: "KOSIS 산업통계", documentType: "statistic", homeUrl: "https://kosis.kr/openapi/index/index.jsp", referenceUrls: ["https://kosis.kr/openapi/devGuide/devGuide_0201List.do", "https://sso.kosis.kr/serviceInfo/applicationClause.do"], allowedHosts: ["kosis.kr", "sso.kosis.kr"], requiresSecret: true, referenceOnly: false, intervalHours: 168, industries: ["semiconductor", "electronics"], note: "인증키와 최대 2개 표·6개 시계열을 설정하고 실제 응답을 검증해야 합니다." },
  { id: "law", name: "국가법령정보", documentType: "policy", homeUrl: "https://open.law.go.kr/LSO/openApi/guideList.do", referenceUrls: ["https://open.law.go.kr/LSO/usrJoin.do"], allowedHosts: ["open.law.go.kr", "www.law.go.kr", "law.go.kr"], requiresSecret: true, referenceOnly: false, intervalHours: 24, industries: [], note: "OC 인증키와 대상 법령·행정규칙 ID가 필요합니다. 법적 적용 여부는 담당자가 확인합니다." },
  { id: "kdi", name: "KDI 경제동향", documentType: "trend", homeUrl: "https://www.kdi.re.kr/research/monTrends", referenceUrls: ["https://www.kdi.re.kr/research/monTrends"], allowedHosts: ["www.kdi.re.kr", "kdi.re.kr"], requiresSecret: false, referenceOnly: false, intervalHours: 168, industries: [], note: "개별 자료의 공공누리 조건과 제3자 자료·자동 접근 범위를 확인한 뒤 사용합니다." },
  { id: "samsung_semiconductor", name: "삼성전자 반도체 공식 발표", companyName: "삼성전자", documentType: "company_event", homeUrl: "https://news.samsungsemiconductor.com/kr/", referenceUrls: ["https://news.samsungsemiconductor.com/kr/"], allowedHosts: ["news.samsungsemiconductor.com"], requiresSecret: false, referenceOnly: false, intervalHours: 24, industries: ["semiconductor"], note: "기업별 수집·보관·AI 처리 허용 범위를 확인하기 전에는 수집하지 않습니다." },
  { id: "skhynix", name: "SK하이닉스 공식 발표", companyName: "SK하이닉스", documentType: "company_event", homeUrl: "https://news.skhynix.co.kr/", referenceUrls: ["https://news.skhynix.co.kr/"], allowedHosts: ["news.skhynix.co.kr"], requiresSecret: false, referenceOnly: false, intervalHours: 24, industries: ["semiconductor"], note: "기업별 수집·보관·AI 처리 허용 범위를 확인하기 전에는 수집하지 않습니다." },
  { id: "samsung_sem", name: "삼성전기 공식 발표", companyName: "삼성전기", documentType: "company_event", homeUrl: "https://samsungsem.com/kr/newsroom/news/overview.do", referenceUrls: ["https://samsungsem.com/kr/newsroom/news/overview.do"], allowedHosts: ["samsungsem.com", "www.samsungsem.com", "www.samsungsem.co.kr"], requiresSecret: false, referenceOnly: false, intervalHours: 24, industries: ["electronics"], note: "기업별 수집·보관·AI 처리 허용 범위를 확인하기 전에는 수집하지 않습니다." },
  { id: "kiet", name: "KIET 산업동향·경기서베이", documentType: "trend", homeUrl: "https://www.kiet.re.kr/trends/indbriefList", referenceUrls: ["https://www.kiet.re.kr/trends/indbriefList", "https://www.kiet.re.kr/trends/digbreifList", "https://www.kiet.re.kr/etc/copyright"], allowedHosts: ["www.kiet.re.kr"], requiresSecret: false, referenceOnly: true, intervalHours: 168, industries: [], note: "공공누리 제4유형을 확인했습니다. 1차는 참고 링크만 제공하며 자동 수집·AI 요약을 하지 않습니다." },
  { id: "kea", name: "KEA 전자산업 이슈리포트", documentType: "trend", homeUrl: "https://www.gokea.org/core/?cid=53", referenceUrls: ["https://www.gokea.org/core/?cid=53", "https://www.gokea.org/core/?cid=84"], allowedHosts: ["www.gokea.org"], requiresSecret: false, referenceOnly: true, intervalHours: 168, industries: ["electronics"], note: "사전 승낙 조건이 있습니다. 1차는 참고 링크만 제공하며 자동 수집·AI 요약을 하지 않습니다." },
];

export function officialProvider(value: unknown): OfficialProviderDefinition {
  const provider = OFFICIAL_PROVIDERS.find((p) => p.id === value);
  if (!provider) throw new OfficialSourceError("등록되지 않은 공식 정보원입니다.");
  return provider;
}
export const EMPTY_OFFICIAL_PERMISSIONS: OfficialPermissions = { collectionAllowed: false, storageAllowed: false, aiAllowed: false, internalReportAllowed: false, evidenceUrl: "", note: "", reviewedAt: null, reviewedBy: null };
export function emptyOfficialState(): OfficialSourceStoredState {
  return { enabled: false, permissions: { ...EMPTY_OFFICIAL_PERMISSIONS }, verifiedAt: null, verifiedFingerprint: null, lastAttemptAt: null, lastSuccessAt: null, lastError: null, nextDueAt: null, configVersion: 0, leaseToken: null, leaseUntil: null };
}
export function defaultOfficialConfig(provider: OfficialProviderDefinition): OfficialSourceConfig {
  return provider.id === "kosis" ? { series: [] } : provider.id === "law" ? { laws: [] } : { channelUrl: provider.homeUrl };
}
export function allowedOfficialUrl(provider: OfficialProviderDefinition, value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new OfficialSourceError("올바른 공식 URL이 필요합니다."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !provider.allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new OfficialSourceError("허용된 공식 기관의 HTTPS 주소만 사용할 수 있습니다.");
  }
  url.hash = "";
  return url;
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function string(value: unknown, max = 300): string { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function code(value: unknown): string {
  const result = string(value, 100);
  if (!/^[A-Za-z0-9_.@-]+$/.test(result) || /^ALL@?$/i.test(result)) throw new OfficialSourceError("통계 식별자는 단일 코드로 입력하세요. 전체 조회·와일드카드는 지원하지 않습니다.");
  return result;
}
export function validateOfficialUpdate(raw: unknown): OfficialSourceUpdate {
  const body = record(raw), provider = officialProvider(body.providerId), config = record(body.config), rights = record(body.permissions);
  if (typeof body.enabled !== "boolean" || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) throw new OfficialSourceError("사용 여부와 현재 설정 버전이 필요합니다.");
  for (const name of ["collectionAllowed", "storageAllowed", "aiAllowed", "internalReportAllowed"] as const) {
    if (typeof rights[name] !== "boolean") throw new OfficialSourceError("자료 이용 범위를 각각 확인하세요.");
  }
  if (provider.referenceOnly && body.enabled) throw new OfficialSourceError("이 정보원은 1차에서 참고 링크만 지원합니다.");
  const permissions = { collectionAllowed: rights.collectionAllowed === true, storageAllowed: rights.storageAllowed === true, aiAllowed: rights.aiAllowed === true, internalReportAllowed: rights.internalReportAllowed === true, evidenceUrl: string(rights.evidenceUrl, 2000), note: string(rights.note, 2000) };
  if (Object.values(permissions).some((v) => v === true)) {
    allowedOfficialUrl(provider, permissions.evidenceUrl);
    if (!permissions.note) throw new OfficialSourceError("확인한 이용 조건과 허용 범위를 기록하세요.");
  }
  let parsed: OfficialSourceConfig;
  if (provider.id === "kosis") {
    if (!Array.isArray(config.series) || config.series.length > 6) throw new OfficialSourceError("통계 시계열은 최대 6개입니다.");
    const series: KosisSeriesConfig[] = config.series.map((entry): KosisSeriesConfig => {
      const row = record(entry), prdSe = row.prdSe;
      if (prdSe !== "M" && prdSe !== "Q" && prdSe !== "Y") throw new OfficialSourceError("통계 주기는 M, Q, Y 중 하나여야 합니다.");
      return { label: string(row.label, 150), orgId: code(row.orgId), tblId: code(row.tblId), itmId: code(row.itmId), objL1: code(row.objL1), ...(row.objL2 ? { objL2: code(row.objL2) } : {}), prdSe };
    });
    if (new Set(series.map((s) => `${s.orgId}/${s.tblId}`)).size > 2) throw new OfficialSourceError("통계표는 최대 2개입니다.");
    if (new Set(series.map((s) => JSON.stringify({ ...s, label: "" }))).size !== series.length) throw new OfficialSourceError("동일한 통계 시계열이 중복되었습니다.");
    parsed = { series };
  } else if (provider.id === "law") {
    if (!Array.isArray(config.laws) || config.laws.length > 25) throw new OfficialSourceError("법령·행정규칙은 최대 25개입니다.");
    const laws: NonNullable<OfficialSourceConfig["laws"]> = config.laws.map((entry): { id: string; target: "law" | "admrul" } => {
      const row = record(entry), target = row.target, id = string(row.id, 30);
      if ((target !== "law" && target !== "admrul") || !/^\d{1,30}$/.test(id)) throw new OfficialSourceError("법령 ID와 law/admrul 구분을 확인하세요.");
      return { id, target };
    });
    if (new Set(laws.map((l) => `${l.target}:${l.id}`)).size !== laws.length) throw new OfficialSourceError("같은 법령 ID가 중복되었습니다.");
    parsed = { laws };
  } else {
    const channelUrl = string(config.channelUrl, 2000) || provider.homeUrl;
    parsed = { channelUrl: allowedOfficialUrl(provider, channelUrl).href };
  }
  const authSecret = body.authSecret;
  if (authSecret !== undefined && authSecret !== null && (typeof authSecret !== "string" || authSecret.length > 1000 || /[\r\n]/.test(authSecret))) throw new OfficialSourceError("인증키 형식을 확인하세요.");
  return { providerId: provider.id, enabled: body.enabled, expectedVersion: Number(body.expectedVersion), permissions, config: parsed, ...(authSecret !== undefined ? { authSecret: authSecret as string | null } : {}) };
}
export function officialFingerprint(config: OfficialSourceConfig, permissions: OfficialPermissions, secretVersion = 0): string {
  return createHash("sha256").update(JSON.stringify({ config, permissions, secretVersion })).digest("hex");
}
export function officialSourceState(provider: OfficialProviderDefinition, stored: OfficialSourceStoredState, config: OfficialSourceConfig, hasSecret: boolean): OfficialSourceState {
  if (provider.referenceOnly) return "reference_only";
  if (!stored.permissions.collectionAllowed || !stored.permissions.storageAllowed) return "rights_pending";
  if (provider.requiresSecret && !hasSecret) return "credentials_pending";
  if ((provider.id === "kosis" && !config.series?.length) || (provider.id === "law" && !config.laws?.length)) return "configuration_pending";
  if (!stored.verifiedAt || !stored.verifiedFingerprint) return stored.lastError ? "error" : "verification_pending";
  if (stored.lastError) return "error";
  return stored.enabled ? "active" : "paused";
}
export const OFFICIAL_STATE_LABELS: Record<OfficialSourceState, string> = { verification_pending: "실제 응답 검증 대기", credentials_pending: "인증키 설정 대기", configuration_pending: "수집 범위 설정 대기", rights_pending: "이용 조건 확인 대기", active: "운영 중", paused: "일시중지", reference_only: "참고 링크", error: "수집 오류" };

/** 렌더링 가능한 HTML은 저장하지 않는다. 수집문은 신뢰되지 않는 자료다. */
export function officialHtmlToText(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|template|svg|nav|header|footer|form|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_m, n: string) => { const p = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n); return p > 31 && p <= 0x10ffff && !(p >= 0xd800 && p <= 0xdfff) ? String.fromCodePoint(p) : " "; })
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos);/gi, (m) => ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" }[m.toLowerCase()] ?? " "))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n/g, "\n\n").trim();
}

export function officialProviderId(value: unknown): OfficialProviderId { return officialProvider(value).id; }
