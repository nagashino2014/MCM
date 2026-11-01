import { createHash } from "node:crypto";
import type { KosisSeriesConfig, OfficialDocumentInput, OfficialProviderDefinition, OfficialSourceConfig } from "./official-sources-types";
import { allowedOfficialUrl, officialHtmlToText, OfficialSourceError } from "./official-sources-policy";
import { fetchOfficialText, type OfficialFetcher } from "./official-sources-fetch";

const MAX_TEXT = 60_000;
const asRecord = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const asText = (v: unknown): string => typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
function json(text: string): unknown { try { return JSON.parse(text); } catch { throw new OfficialSourceError("공식 API가 유효한 JSON 자료를 반환하지 않았습니다.", 502); } }

export function officialDate(value: string): string | null {
  const match = value.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})(?:T|\s|$)/);
  if (!match) return null;
  const [, y, m, d] = match, date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(`${y}-${m}-${d}`) ? `${y}-${m}-${d}T00:00:00.000Z` : null;
}

export function parseKosisResponse(value: unknown, series: KosisSeriesConfig): OfficialDocumentInput[] {
  if (!Array.isArray(value)) throw new OfficialSourceError("KOSIS 응답을 확인하지 못했습니다. 인증키와 통계표 설정을 확인하세요.", 502);
  if (value.length > 150) throw new OfficialSourceError("설정한 단일 시계열 범위를 초과한 통계 응답입니다.", 502);
  const seriesKey = [series.orgId, series.tblId, series.itmId, series.objL1, series.objL2 ?? "", series.prdSe].join(":");
  return value.map((item) => {
    const row = asRecord(item), period = asText(row.PRD_DE), rawValue = asText(row.DT), unit = asText(row.UNIT_NM);
    if ((row.ORG_ID != null && asText(row.ORG_ID) !== series.orgId) || asText(row.TBL_ID) !== series.tblId || asText(row.ITM_ID) !== series.itmId || asText(row.C1) !== series.objL1 || (series.objL2 && asText(row.C2) !== series.objL2) || asText(row.PRD_SE) !== series.prdSe || !/^\d{4,8}$/.test(period)) {
      throw new OfficialSourceError("통계 응답의 표·항목·분류·시점이 설정과 일치하지 않습니다.", 502);
    }
    const numeric = rawValue.replace(/,/g, "");
    const numberValue = /^[+-]?\d+(?:\.\d+)?$/.test(numeric) && Number.isFinite(Number(numeric)) ? Number(numeric) : null;
    const title = [series.label || asText(row.TBL_NM), asText(row.C1_NM), asText(row.ITM_NM), period].filter(Boolean).join(" · ");
    const url = new URL("https://kosis.kr/statHtml/statHtml.do"); url.searchParams.set("orgId", series.orgId); url.searchParams.set("tblId", series.tblId);
    return { externalId: `kosis:${seriesKey}:${period}`, documentType: "statistic", title, url: url.href, publishedAt: null,
      normalizedText: `${title}\n값: ${rawValue || "자료 없음"}${unit ? ` ${unit}` : ""}\n수록시점: ${period}\n통계 최종수정일: ${asText(row.LST_CHN_DE) || "미확인"}\n통계부호·결측값은 0으로 대체하지 않습니다.`,
      structuredData: { seriesKey, orgId: series.orgId, tableId: series.tblId, itemId: series.itmId, classification: series.objL1, period, frequency: series.prdSe, unit, value: numberValue, rawValue, lastChangedAt: asText(row.LST_CHN_DE), provisional: null }, industries: ["semiconductor", "electronics"] };
  });
}

function findProperty(value: unknown, names: string[], depth = 0): string {
  if (depth > 8) return "";
  if (Array.isArray(value)) { for (const v of value.slice(0, 100)) { const found = findProperty(v, names, depth + 1); if (found) return found; } return ""; }
  const object = asRecord(value);
  for (const name of names) { const result = asText(object[name]); if (result) return result; }
  for (const v of Object.values(object)) { const found = findProperty(v, names, depth + 1); if (found) return found; }
  return "";
}
function jsonText(value: unknown, depth = 0): string {
  if (depth > 10) return "";
  if (Array.isArray(value)) return value.slice(0, 300).map((v) => jsonText(v, depth + 1)).join("\n").slice(0, MAX_TEXT);
  if (value && typeof value === "object") return Object.entries(value).slice(0, 300).map(([k, v]) => `${k}: ${jsonText(v, depth + 1)}`).join("\n").slice(0, MAX_TEXT);
  return officialHtmlToText(asText(value));
}
export function parseLawResponse(value: unknown, law: { id: string; target: "law" | "admrul" }): OfficialDocumentInput {
  const title = findProperty(value, ["법령명_한글", "법령명한글", "행정규칙명", "법령명"]);
  if (!title) throw new OfficialSourceError("법령 응답에서 문서명을 확인하지 못했습니다. OC와 문서 ID를 확인하세요.", 502);
  const promulgatedAt = officialDate(findProperty(value, ["공포일자", "발령일자"]));
  const effectiveAt = officialDate(findProperty(value, ["시행일자", "시행일"]));
  const text = jsonText(value);
  if (text.length < 30) throw new OfficialSourceError("법령 본문을 확인하지 못했습니다.", 502);
  const url = new URL(law.target === "law" ? "https://www.law.go.kr/법령/" : "https://www.law.go.kr/행정규칙/");
  url.pathname += title;
  return { externalId: `${law.target}:${law.id}`, documentType: "policy", title, url: url.href, publishedAt: promulgatedAt, normalizedText: text,
    structuredData: { lawId: law.id, target: law.target, promulgatedAt, effectiveAt, applicationStatus: "담당자 검토 필요", truncated: text.length >= MAX_TEXT }, industries: [] };
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[match[1].toLowerCase()] = officialHtmlToText(match[2] ?? match[3]);
  return result;
}
function meta(html: string, names: string[]): string {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) { const attrs = attributes(match[0]); if (names.includes((attrs.property || attrs.name || "").toLowerCase())) return attrs.content || ""; }
  return "";
}
/** KDI가 제공하는 정적 편집 본문만 선택한다. 중첩 div를 보존하고 팝업·차트·메뉴는 포함하지 않는다. */
function divContentsByClass(html: string, className: string): string[] {
  const safe = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const tags = /<\/?div\b[^>]*>/gi, result: string[] = [];
  let depth = 0, start = -1, match: RegExpExecArray | null;
  while ((match = tags.exec(safe))) {
    if (/^<\/div/i.test(match[0])) {
      if (depth && --depth === 0) { result.push(safe.slice(start, match.index)); start = -1; }
    } else if (depth) depth++;
    else if ((attributes(match[0]).class || "").split(/\s+/).includes(className)) { start = tags.lastIndex; depth = 1; }
  }
  return result;
}
function kdiPublishedContent(main: string): { content: string; title: string; date: string; license: string } {
  const post = divContentsByClass(main, "m_v-post")[0] ?? "";
  const top = divContentsByClass(post, "post-top")[0] ?? "";
  const title = officialHtmlToText(divContentsByClass(top, "tit")[0] ?? "");
  const date = officialHtmlToText(divContentsByClass(top, "date")[0] ?? "");
  const sections = divContentsByClass(divContentsByClass(post, "post-box")[0] ?? "", "editor-template");
  const license = divContentsByClass(main, "nuri_top")[0] ?? "";
  if (!/KDI\s*경제동향/.test(title) || !sections.length) throw new OfficialSourceError("KDI 자료의 제목·공개 요약 영역을 확인하지 못했습니다. 페이지 형식을 확인하세요.", 502);
  return { title, date, license, content: [title, date, ...sections, license].join("\n") };
}
export function parseOfficialHtml(provider: OfficialProviderDefinition, html: string, urlValue: string): OfficialDocumentInput {
  const url = allowedOfficialUrl(provider, urlValue);
  if (/challenge-platform|cf-chl-|captcha|로그인 후 이용/i.test(html.slice(0, 15_000))) throw new OfficialSourceError("접근 제한 또는 확인 화면입니다. 자동 수집을 중지했습니다.", 502);
  let title = meta(html, ["og:title", "twitter:title"]) || officialHtmlToText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const main = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  const kdi = provider.id === "kdi" ? kdiPublishedContent(main) : null;
  if (kdi) title = kdi.title;
  const text = officialHtmlToText(kdi?.content ?? main).slice(0, MAX_TEXT);
  let date = meta(html, ["article:published_time", "date", "datepublished", "pubdate"])
    || html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] || html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1] || "";
  if (kdi) date = kdi.date;
  if (!title || text.length < 80 || (provider.id === "kdi" && !/KDI\s*경제동향/.test(`${title}\n${text.slice(0, 500)}`))) throw new OfficialSourceError("문서 제목·본문을 확인하지 못했습니다. 페이지 형식을 확인하세요.", 502);
  if (kdi && !/(?:공공누리[^<\n]{0,80}(?:제?\s*1\s*유형|제?\s*1\s*형)|(?:kogl|open)[^"'\s<>]{0,80}(?:type0?1|by\.))/i.test(kdi.license)) throw new OfficialSourceError("개별 KDI 자료의 공공누리 제1유형 표시를 확인하지 못했습니다. 이용 조건을 검토하세요.", 502);
  const publishedAt = officialDate(date);
  const kdiPeriod = provider.id === "kdi" ? `${title} ${text.slice(0, 1000)}`.match(/KDI\s*경제동향\s*(20\d{2})[.\s-]+(\d{1,2})/) : null;
  const externalId = kdiPeriod ? `kdi:${kdiPeriod[1]}-${kdiPeriod[2].padStart(2, "0")}` : url.href;
  return { externalId, documentType: provider.documentType, title: title.slice(0, 500), url: url.href, publishedAt, normalizedText: text,
    structuredData: { dateUnknown: !publishedAt, period: kdiPeriod ? `${kdiPeriod[1]}-${kdiPeriod[2].padStart(2, "0")}` : null, truncated: text.length >= MAX_TEXT, ...(kdi ? { licenseMarker: "KOGL-1", licenseEvidenceUrl: url.href, contentScope: "공개 HTML 요약·목차; PDF·그림·차트·직원정보 제외", attribution: `한국개발연구원(KDI), ${title}, ${url.href}, 공공누리 제1유형` } : {}) }, companyName: provider.companyName, industries: [...provider.industries] };
}

export function officialArticleLinks(provider: OfficialProviderDefinition, html: string, base: string): string[] {
  const result = new Set<string>();
  if (provider.id === "kdi") {
    // 공식 페이지의 월 선택은 정적 location.href 버튼이다. 코드를 실행하지 않고 이 주소 형태만 읽는다.
    const buttonUrls = [...html.matchAll(/<button\b[^>]*\bonclick="\s*location\.href\s*=\s*'(\/research\/monTrends\?pub_no=\d+)'\s*"[^>]*>/gi)].map(m => m[1]).reverse();
    for (const path of buttonUrls) { const url = allowedOfficialUrl(provider, new URL(path, base).href); if (url.href !== base) result.add(url.href); }
  }
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attributes(match[0]).href;
    if (!href || /^(?:javascript:|mailto:|#)/i.test(href)) continue;
    try {
      const url = allowedOfficialUrl(provider, new URL(href, base).href), path = decodeURIComponent(url.pathname);
      const accept = provider.id === "kdi" ? path === "/research/monTrends" && /^\d+$/.test(url.searchParams.get("pub_no") ?? "")
        : provider.id === "samsung_sem" ? /\/kr\/newsroom\/news\/view\.do$/.test(path) && /^\d+$/.test(url.searchParams.get("id") ?? "")
          : provider.id === "samsung_semiconductor" ? /^\/kr\/.+/.test(path) && !/\/(?:category|tag|page|author|search)\//i.test(path)
            : provider.id === "skhynix" ? /^\/[^/]+\/?$/.test(path) && !/\/(?:category|tag|page|author|search|privacy|terms|about)\/?$/i.test(path) : false;
      if (accept && url.href !== base) result.add(url.href);
    } catch { /* 외부 링크·잘못된 주소는 수집 대상이 아니다. */ }
    if (result.size >= 12) break;
  }
  return [...result].slice(0, 12);
}

/** 제한된 범위를 순차 조회한다. 전체 자료를 스크래핑하거나 로그인을 시도하지 않는다. */
export async function collectOfficialDocuments(provider: OfficialProviderDefinition, config: OfficialSourceConfig, secret: string | null, fetcher: OfficialFetcher = fetchOfficialText, now = new Date()): Promise<OfficialDocumentInput[]> {
  if (provider.referenceOnly) throw new OfficialSourceError("참고 링크 정보원은 수집할 수 없습니다.");
  if (provider.requiresSecret && !secret) throw new OfficialSourceError("인증키가 설정되지 않았습니다.");
  const started = Date.now(); let lastRequest = 0;
  const fetchPage = async (url: string) => {
    if (Date.now() - started > 120_000) throw new OfficialSourceError("정보원 수집 시간 제한에 도달했습니다. 다음 실행에서 다시 확인합니다.", 504);
    // fixture는 대기하지 않으며 실제 기관 요청은 최소 1초 간격으로 순차 전송한다.
    if (fetcher === fetchOfficialText && lastRequest) await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1000 - (Date.now() - lastRequest))));
    lastRequest = Date.now();
    return fetcher(provider, url);
  };
  const fetch = async (url: URL): Promise<string> => {
    allowedOfficialUrl(provider, url.href);
    return (await fetchPage(url.href)).text;
  };
  const documents: OfficialDocumentInput[] = [];
  if (provider.id === "kosis") {
    for (const series of config.series ?? []) {
      const url = new URL("https://kosis.kr/openapi/Param/statisticsParameterData.do");
      for (const [key, value] of Object.entries({ method: "getList", apiKey: secret!, orgId: series.orgId, tblId: series.tblId, itmId: series.itmId, objL1: series.objL1, ...(series.objL2 ? { objL2: series.objL2 } : {}), prdSe: series.prdSe, newEstPrdCnt: series.prdSe === "M" ? "24" : series.prdSe === "Q" ? "8" : "2", format: "json", jsonVD: "Y", smblChk: "Y" })) url.searchParams.set(key, value);
      documents.push(...parseKosisResponse(json(await fetch(url)), series));
    }
  } else if (provider.id === "law") {
    for (const law of config.laws ?? []) {
      const url = new URL("https://www.law.go.kr/DRF/lawService.do");
      // admrul ID는 특정 개정의 일련번호, LID는 개정 후에도 유지되는 행정규칙 식별자다.
      for (const [key, value] of Object.entries({ OC: secret!, target: law.target, ...(law.target === "law" ? { ID: law.id } : { LID: law.id }), type: "JSON" })) url.searchParams.set(key, value);
      documents.push(parseLawResponse(json(await fetch(url)), law));
    }
  } else {
    const channel = allowedOfficialUrl(provider, config.channelUrl || provider.homeUrl);
    const page = await fetchPage(channel.href);
    if (provider.id === "kdi") documents.push(parseOfficialHtml(provider, page.text, page.url));
    let links = officialArticleLinks(provider, page.text, page.url).slice(0, provider.id === "kdi" ? 3 : 10);
    // 연초에는 당해 월 버튼이 3개 미만이므로 페이지가 제공한 전년도 선택으로만 범위를 보강한다.
    if (provider.id === "kdi" && links.length < 3) {
      const select = page.text.match(/<select\b[^>]*id="allSelectYear"[^>]*>([\s\S]*?)<\/select>/i)?.[1] ?? "";
      const years = [...select.matchAll(/<option\b[^>]*value="(20\d{2})"([^>]*)>/gi)];
      const selectedYear = years.find(m => /\bselected\b/i.test(m[2]))?.[1];
      const previous = selectedYear ? years.find(m => Number(m[1]) === Number(selectedYear) - 1)?.[1] : undefined;
      if (previous && /location\.href\s*=\s*'\/research\/monTrends\?year='\s*\+\s*year/.test(page.text)) {
        const previousUrl = new URL("/research/monTrends", page.url); previousUrl.searchParams.set("year", previous);
        const previousPage = await fetchPage(previousUrl.href);
        links = [...new Set([...links, ...officialArticleLinks(provider, previousPage.text, previousPage.url)])].slice(0, 3);
      }
    }
    if (!links.length && provider.id !== "kdi") throw new OfficialSourceError("공식 발표 목록에서 문서 주소를 확인하지 못했습니다.", 502);
    for (const link of links) {
      const article = await fetchPage(link);
      const document = parseOfficialHtml(provider, article.text, article.url);
      if (provider.id !== "kdi" && document.publishedAt && Date.parse(document.publishedAt) < now.valueOf() - 90 * 86400_000) continue;
      documents.push(document);
    }
  }
  const unique = [...new Map(documents.map((doc) => [doc.externalId, doc])).values()];
  return provider.id === "kdi" ? unique.sort((a, b) => String(b.structuredData.period).localeCompare(String(a.structuredData.period))).slice(0, 3) : unique;
}
export function officialDocumentHash(doc: OfficialDocumentInput): string {
  return createHash("sha256").update(JSON.stringify({ title: doc.title, url: doc.url, publishedAt: doc.publishedAt, text: doc.normalizedText, data: doc.structuredData, industries: doc.industries })).digest("hex");
}
