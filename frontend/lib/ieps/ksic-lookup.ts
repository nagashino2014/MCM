/**
 * 표준산업분류(KSIC-11) 코드 → 업종명 조회.
 * public/ksic11.json 을 최초 1회만 받아 Map으로 캐시한다(클라이언트 전용, 편집 폼에서 지연 로드).
 */
export interface KsicEntry {
  code: string;
  name: string;
  name_eng?: string;
}

let cache: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;

export async function loadKsicMap(): Promise<Map<string, string>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch("/ksic11.json", { cache: "force-cache" })
    .then((res) => {
      if (!res.ok) throw new Error("KSIC 코드표를 불러오지 못했습니다.");
      return res.json() as Promise<KsicEntry[]>;
    })
    .then((arr) => {
      const map = new Map<string, string>();
      for (const item of arr) {
        const code = String(item?.code ?? "").trim();
        if (code) map.set(code, String(item?.name ?? "").trim());
      }
      cache = map;
      inflight = null;
      return map;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

/** 코드 정규화(숫자만) 후 조회. 미일치 시 undefined. */
export function lookupKsicName(map: Map<string, string> | null, rawCode: string): string | undefined {
  if (!map) return undefined;
  const code = rawCode.trim();
  if (!code) return undefined;
  return map.get(code);
}
