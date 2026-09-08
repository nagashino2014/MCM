import { fetch as request, ProxyAgent } from "undici";
import AdmZip from "adm-zip";
import { nameKey, searchNames, type Profile, type Snapshot } from "../facility-quality/rules";
import type { Outcome } from "./browser";

export class ProviderError extends Error {
  constructor(public status: Outcome["status"], message: string) { super(message); }
}
const s = (v: unknown) => typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
const FSC_URL = "https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2";
let dartCodes: { code: string; name: string }[] | undefined;
const proxyAgents = new Map<string, ProxyAgent>();
async function get(url: string, proxy?: string) {
  if (proxy && !proxyAgents.has(proxy)) proxyAgents.set(proxy, new ProxyAgent(proxy));
  const res = await request(url, { signal: AbortSignal.timeout(25000), ...(proxy ? { dispatcher: proxyAgents.get(proxy) } : {}) });
  if ([401,403,429].includes(res.status)) throw new ProviderError(res.status === 429 ? "quota" : "blocked", "정보원 인증·접근 제한");
  if (!res.ok) throw new ProviderError("error", `정보원 응답 오류 (${res.status})`);
  return res;
}
export async function fsc(snapshot: Snapshot, reserve = async () => {}): Promise<Outcome> {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) return { status: "not_configured", profiles: [] };
  const profiles: Profile[] = [];
  for (let page = 1; page <= 5; page++) {
    const query = new URLSearchParams({ serviceKey: key, resultType: "json", pageNo: String(page), numOfRows: "30", corpNm: searchNames(snapshot.company_name).at(-1)!.replace(/\(주\)|주식회사|㈜/g, "").trim() });
    await reserve();
    const data = await (await get(`${FSC_URL}?${query}`)).json() as any;
    const code = s(data.response?.header?.resultCode);
    if (code && !["00","0","0000"].includes(code)) throw new ProviderError("blocked", `금융위 응답 코드 ${code}`);
    const body = data.response?.body;
    if (!body) throw new ProviderError("parse_error", "금융위 응답 구조 확인 필요");
    const raw = body.items?.item ?? [];
    const items = Array.isArray(raw) ? raw : [raw];
    for (const it of items) profiles.push({ source: "fsc", name: s(it.corpNm), url: `${FSC_URL}?corpNm=${encodeURIComponent(s(it.corpNm))}`, retrievedAt: new Date().toISOString(),
      sourceDate: s(it.basDt) || null, firstPublishedAt:s(it.fstOpegDt)||null,lastPublishedAt:s(it.lastOpegDt)||null,externalId: s(it.crno), scope: "headquarters", values: {
        business_registration_no: s(it.bzno), corporate_registration_no: s(it.crno), representative_name: s(it.enpRprFnm), phone_number: s(it.enpTlno), site_address: [s(it.enpBsadr), s(it.enpDtadr)].filter(Boolean).join(" "),
      } });
    if (page * 30 >= Number(body.totalCount ?? items.length)) return { status: profiles.length ? "success" : "not_found", profiles };
  }
  return { status: "parse_error", profiles: [], note: "금융위 검색결과가 150건을 초과합니다. 업체 식별 필요" };
}
export async function dart(snapshot: Snapshot, reserve = async () => {}): Promise<Outcome> {
  const key = process.env.DART_API_KEY;
  if (!key) return { status: "not_configured", profiles: [] };
  const proxy = process.env.DART_HTTPS_PROXY;
  if (!dartCodes) {
    await reserve();
    const bytes = Buffer.from(await (await get(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(key)}`, proxy)).arrayBuffer());
    if (bytes.subarray(0,2).toString() !== "PK") throw new ProviderError("blocked", "DART 기업목록 인증·할당량 확인 필요");
    const zip = new AdmZip(bytes);
    const entry = zip.getEntries().find(e => /CORPCODE.xml/i.test(e.entryName));
    if (!entry) throw new ProviderError("parse_error", "DART 기업목록 구조 확인 필요");
    const xml = entry.getData().toString("utf8");
    dartCodes = [...xml.matchAll(/<list>([\s\S]*?)<\/list>/g)].map(m => ({ code: m[1].match(/<corp_code>(.*?)<\/corp_code>/)?.[1] ?? "", name: m[1].match(/<corp_name>(.*?)<\/corp_name>/)?.[1] ?? "" }));
  }
  const matches = dartCodes.filter(c => searchNames(snapshot.company_name).some(n => nameKey(c.name) === nameKey(n)));
  if (!matches.length) return { status: "not_found", profiles: [] };
  if (matches.length > 5) return { status: "parse_error", profiles: [], note: "DART 동명 업체가 많습니다" };
  const profiles: Profile[] = [];
  for (const c of matches) {
    await reserve();
    const q = new URLSearchParams({ crtfc_key: key, corp_code: c.code });
    const data = await (await get(`https://opendart.fss.or.kr/api/company.json?${q}`, proxy)).json() as any;
    if (data.status === "013") continue;
    if (data.status !== "000") throw new ProviderError("blocked", `DART 응답 코드 ${s(data.status)}`);
    profiles.push({ source: "dart", name: s(data.corp_name), url: `https://opendart.fss.or.kr/api/company.json?corp_code=${encodeURIComponent(c.code)}`, retrievedAt: new Date().toISOString(), externalId: c.code, scope: "headquarters", values: {
      business_registration_no: s(data.bizr_no), corporate_registration_no: s(data.jurir_no), representative_name: s(data.ceo_nm), phone_number: s(data.phn_no), site_address: s(data.adres),
    } });
  }
  return { status: profiles.length ? "success" : "not_found", profiles };
}
