import { lookup } from "node:dns/promises";
import { request } from "node:https";
import type { OfficialProviderDefinition } from "./official-sources-types";
import { allowedOfficialUrl, OfficialSourceError } from "./official-sources-policy";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
export interface OfficialFetchResponse { text: string; url: string; contentType: string }
export type OfficialFetcher = (provider: OfficialProviderDefinition, url: string) => Promise<OfficialFetchResponse>;

export function isPublicOfficialAddress(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip.includes(":")) {
    // IPv4-mapped/NAT64/로컬 범위는 거부. 공개 IPv6 global unicast만 허용한다.
    if (!/^[23][0-9a-f]{0,3}:/.test(ip) || /^2001:db8(?::|$)/.test(ip) || /^2001:0(?::|$)/.test(ip) || ip.startsWith("2002:")) return false;
    return true;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2))))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}

/** URL·DNS·각 redirect를 검증하고 검증한 IP에 고정 연결한다. 쿠키/사용자 헤더는 전달하지 않는다. */
export const fetchOfficialText: OfficialFetcher = async (provider, value) => {
  let url = allowedOfficialUrl(provider, value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const addresses = await lookup(url.hostname, { all: true }).catch(() => []);
    if (!addresses.length || addresses.some((a) => !isPublicOfficialAddress(a.address))) throw new OfficialSourceError("공식 정보원의 공개 네트워크 주소를 확인하지 못했습니다.", 502);
    const address = addresses[0];
    const response = await new Promise<{ status: number; location?: string; type: string; body: string }>((resolve, reject) => {
      const req = request(url, {
        method: "GET", family: address.family, servername: url.hostname,
        lookup: (_host, _options, callback) => callback(null, address.address, address.family),
        headers: { "User-Agent": "MCM-OfficialIntelligence/1.0", Accept: "application/json,text/html;q=0.9", "Accept-Encoding": "identity" },
      }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) { res.resume(); resolve({ status, location: res.headers.location, type: "", body: "" }); return; }
        if (status < 200 || status >= 300) { res.resume(); reject(new OfficialSourceError(`공식 정보원 응답 오류(HTTP ${status}).`, 502)); return; }
        const type = String(res.headers["content-type"] ?? "");
        if (!/application\/(?:[\w.+-]*\+)?json|text\/html/i.test(type) || (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")) {
          res.resume(); reject(new OfficialSourceError("지원하지 않는 응답 형식입니다. JSON 또는 HTML 자료만 수집합니다.", 502)); return;
        }
        if (Number(res.headers["content-length"] ?? 0) > MAX_BYTES) { res.destroy(); reject(new OfficialSourceError("소량 수집 응답 크기 제한을 초과했습니다.", 502)); return; }
        const chunks: Buffer[] = []; let bytes = 0;
        res.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_BYTES) { res.destroy(); reject(new OfficialSourceError("소량 수집 응답 크기 제한을 초과했습니다.", 502)); } else chunks.push(chunk); });
        res.on("end", () => resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", () => reject(new OfficialSourceError("공식 정보원 응답을 끝까지 받지 못했습니다.", 502)));
      });
      const timer = setTimeout(() => req.destroy(new Error("timeout")), TIMEOUT_MS);
      req.on("close", () => clearTimeout(timer));
      req.on("error", () => reject(new OfficialSourceError("공식 정보원에 연결하지 못했습니다. 인증·네트워크 상태를 확인하세요.", 502)));
      req.end();
    });
    if (response.status >= 300 && response.status < 400) {
      if (!response.location || redirects === 3) throw new OfficialSourceError("공식 정보원 이동 주소를 확인하지 못했습니다.", 502);
      const next = allowedOfficialUrl(provider, new URL(response.location, url).href);
      // 인증키가 붙은 API 호출은 redirect에 인증정보를 넘기지 않는다.
      if (provider.requiresSecret) throw new OfficialSourceError("API 주소가 이동했습니다. 공식 안내를 확인한 뒤 설정을 갱신하세요.", 502);
      url = next;
      continue;
    }
    return { text: response.body, url: url.href, contentType: response.type };
  }
  throw new OfficialSourceError("공식 정보원 응답을 확인하지 못했습니다.", 502);
};
