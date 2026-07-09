// 금융위원회 기업기본정보 OpenAPI(공공데이터포털) 래퍼.
// 사업장 자동 보완의 2차 소스 — DART(외감·상장 위주)보다 법인 커버리지가 넓다.
// 키: 환경변수 DATA_GO_KR_API_KEY (디코딩 원본 키). IP 제한 없음 — 프록시 불필요.
import { fetch as undiciFetch } from "undici";

const EP =
  "https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2";

export interface FscCorpOutline {
  corpName: string;
  crno: string; // 법인등록번호
  bizrNo: string; // 사업자등록번호 숫자 10자리
  ceoName: string | null;
  phoneNo: string | null;
  address: string | null; // 본사 기본주소 + 상세주소
}

function apiKey(): string | null {
  return process.env.DATA_GO_KR_API_KEY || null;
}

/** 자동 보완에서 금융위 소스 사용 가능 여부(키 유무). */
export function fscAvailable(): boolean {
  return !!apiKey();
}

/** 법인명으로 기업개요 검색. 키 미설정·오류 시 빈 배열. */
export async function searchCorpOutline(corpNm: string): Promise<FscCorpOutline[]> {
  const key = apiKey();
  if (!key) return [];
  const q = new URLSearchParams({
    serviceKey: key,
    resultType: "json",
    pageNo: "1",
    numOfRows: "30",
    corpNm,
  });
  try {
    const res = await undiciFetch(`${EP}?${q.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const data = (await res.json()) as {
      response?: { body?: { items?: { item?: Record<string, unknown>[] } } };
    };
    const items = data.response?.body?.items?.item ?? [];
    const seen = new Set<string>();
    const out: FscCorpOutline[] = [];
    for (const it of items) {
      const crno = String(it.crno ?? "").trim();
      const bizrNo = String(it.bzno ?? "").replace(/\D/g, "");
      const dedupKey = crno || bizrNo;
      if (!dedupKey || seen.has(dedupKey) || bizrNo.length !== 10) continue;
      seen.add(dedupKey);
      const s = (v: unknown) => {
        const t = String(v ?? "").trim();
        return t || null;
      };
      const addr = [s(it.enpBsadr), s(it.enpDtadr)].filter(Boolean).join(" ");
      out.push({
        corpName: String(it.corpNm ?? "").trim(),
        crno,
        bizrNo,
        ceoName: s(it.enpRprFnm),
        phoneNo: s(String(it.enpTlno ?? "").replace(/\s+/g, "")),
        address: addr || null,
      });
    }
    return out;
  } catch {
    return [];
  }
}
