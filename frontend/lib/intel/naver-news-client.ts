// 네이버 뉴스 검색 API 래퍼. 발주 신호(뉴스) 수집용.
// 키: NAVER_CLIENT_ID / NAVER_CLIENT_SECRET (서버사이드 헤더 인증, 프록시 불필요 — 네이버는 IP 제한 없음).
// 네이버는 https 전용. undici(node/OpenSSL) 로 호출한다(Windows curl schannel 은 핸드셰이크 실패).
import { fetch as undiciFetch } from "undici";

const ENDPOINT = "https://openapi.naver.com/v1/search/news.json";

export interface NewsItem {
  title: string; // HTML 태그·엔티티 제거
  link: string; // 네이버/원문 링크 — external_id(중복방지 키)
  originalLink: string;
  description: string; // 본문 발췌(태그 제거)
  pubDate: string; // ISO8601
  press: string | null; // originallink 도메인 기반
}

/** 네이버가 주는 <b> 태그·HTML 엔티티 제거. */
function clean(s: string): string {
  return (s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pressFromLink(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function creds(): { id: string; secret: string } {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) throw new Error("NAVER_CLIENT_ID/NAVER_CLIENT_SECRET가 설정되지 않았습니다.");
  return { id, secret };
}

export interface SearchOptions {
  display?: number; // 1~200 (기본 20). API 상한(100) 초과분은 start 페이지 분할로 이어받는다
  start?: number; // 1~1000
  sort?: "date" | "sim"; // date=최신순(발주 신호는 date)
}

/** 단일 페이지 호출(네이버 API display 상한 100). */
async function fetchNewsPage(
  query: string,
  display: number,
  start: number,
  sort: "date" | "sim"
): Promise<{ items: NewsItem[]; total: number }> {
  const { id, secret } = creds();
  const q = new URLSearchParams({
    query,
    display: String(Math.min(Math.max(display, 1), 100)),
    start: String(Math.min(Math.max(start, 1), 1000)),
    sort,
  });
  const res = await undiciFetch(`${ENDPOINT}?${q.toString()}`, {
    headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
  });
  if (!res.ok) throw new Error(`네이버 뉴스 API 오류: ${res.status} ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { total?: number; items?: Record<string, unknown>[] };
  const items: NewsItem[] = (data.items ?? []).map((r) => {
    const link = String(r.link ?? r.originallink ?? "");
    const orig = String(r.originallink ?? "");
    let pubDate = "";
    try {
      if (r.pubDate) pubDate = new Date(String(r.pubDate)).toISOString();
    } catch {
      pubDate = "";
    }
    return {
      title: clean(String(r.title ?? "")),
      link,
      originalLink: orig,
      description: clean(String(r.description ?? "")),
      pubDate,
      press: pressFromLink(orig || link),
    };
  });
  return { items, total: Number(data.total ?? items.length) };
}

/** 뉴스 검색. 최신순(date) 기본. display 100 초과는 start 페이지 분할 호출로 병합(최대 200). 실패 시 예외. */
export async function searchNews(query: string, opts: SearchOptions = {}): Promise<{ items: NewsItem[]; total: number }> {
  const want = Math.min(Math.max(opts.display ?? 20, 1), 200);
  const sort = opts.sort ?? "date";
  let start = Math.min(Math.max(opts.start ?? 1, 1), 1000);
  const items: NewsItem[] = [];
  let total = 0;
  while (items.length < want) {
    const batch = Math.min(100, want - items.length);
    const page = await fetchNewsPage(query, batch, start, sort);
    items.push(...page.items);
    total = page.total;
    if (page.items.length < batch || start + batch > 1000) break; // 결과 소진 또는 API start 상한
    start += batch;
  }
  return { items, total };
}
