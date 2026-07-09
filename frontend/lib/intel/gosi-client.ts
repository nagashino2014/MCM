// 고시공고 크롤링 클라이언트. 발주 신호(gosi) 수집용 — 2채널.
// ① 토지이음(eum.go.kr): 산업입지법상 산단 지정·개발계획·실시계획 승인 고시는 토지이용규제
//    고시로서 전국 시군구 것이 한 곳에 통합 게재된다(지자체 개별 크롤링 대체, 2026-07-08 실사).
//    EUC-KR 사이트라 한글 검색어는 사전 인코딩된 바이트를 쓴다(UTF-8 은 0건 — 실측).
// ② 유역·지방환경청 8곳 RSS(me.go.kr): 환경영향평가 공람·협의 공고가 EIASS 리스트보다 빠른
//    경우가 있어 보완 채널로 구독. boardMasterId 는 기관별 실측값(2026-07-09, 8곳 전부 활성 확인).

import { fetch as undiciFetch } from "undici";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

export interface GosiItem {
  channel: "eum" | "me";
  externalId: string; // eum:{seq} | me:{orgCd}:{boardId}
  title: string; // 고시명/공고 제목
  url: string; // 상세 딥링크
  agency: string | null; // 담당기관(토지이음) / 환경청명(RSS)
  region: string | null; // 담당기관 앞 2토큰(광역+시군) — 토지이음만
  publishedAt: string | null; // ISO(날짜만)
}

/** HTML 태그·엔티티 제거 + 공백 정리. */
function clean(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const textOrNull = (s: string): string | null => (s ? s : null);

// --- ① 토지이음 (eum.go.kr) ---
// POST gvGosiList.jsp — 행: 게재일·고시번호(title)·고시명(a title, seq)·담당기관(title).
// 상세 gvGosiDet.jsp?seq=N 단독 GET 정상(실측). 검색어는 EUC-KR 바이트(아래 표는 실측 검증값).

const EUM_LIST = "https://www.eum.go.kr/web/gs/gv/gvGosiList.jsp";
const EUM_DET = "https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp?seq=";

// 검색 키워드 → EUC-KR 퍼센트 인코딩(iconv 미도입 — 두 키워드 모두 실호출로 검증됨)
export const EUM_KEYWORDS: Record<string, string> = {
  산업단지: "%BB%EA%BE%F7%B4%DC%C1%F6",
  농공단지: "%B3%F3%B0%F8%B4%DC%C1%F6",
};

export async function fetchEumGosiList(keyword: keyof typeof EUM_KEYWORDS, page = 1): Promise<GosiItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await undiciFetch(EUM_LIST, {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body: `pageNo=${page}&zonenm=${EUM_KEYWORDS[keyword]}`,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`토지이음 응답 오류: ${res.status}`);
    const html = new TextDecoder("euc-kr").decode(Buffer.from(await res.arrayBuffer()));
    const items: GosiItem[] = [];
    for (const tr of html.split(/<tr class="center">/).slice(1)) {
      const link = tr.match(/gvGosiDet\.jsp\?seq=(\d+)[^']*'\s+title='([^']*)'/);
      if (!link) continue;
      const date = tr.match(/<td class="mb">\s*([\d-]{10})/);
      // title 속성 셀: [고시번호, (고시명 a), 담당기관] — 담당기관은 마지막 title
      const titles = [...tr.matchAll(/title="([^"]*)"/g)].map((m) => clean(m[1]));
      const agency = titles.length ? titles[titles.length - 1] : null;
      const region = agency ? agency.split(/\s+/).slice(0, 2).join(" ") : null;
      items.push({
        channel: "eum",
        externalId: `eum:${link[1]}`,
        title: clean(link[2]),
        url: `${EUM_DET}${link[1]}`,
        agency: textOrNull(agency ?? ""),
        region: textOrNull(region ?? ""),
        publishedAt: date ? date[1] : null,
      });
    }
    return items;
  } finally {
    clearTimeout(timer);
  }
}

// --- ② 유역·지방환경청 RSS (me.go.kr) ---
// 공지공고 boardMasterId 실측표(2026-07-09, 전 기관 활성). 주의: 금강=gg·영산강=ysg·전북=smg
// (구 새만금 orgCd 유지) — geumgang/yeongsan/jeonbuk 은 404. 본부(mcee) 개편에도 유역청은
// me.go.kr 유지 — 장기 이관 가능성은 수집 0건 알람으로 감지.

export const ME_OFFICES: { orgCd: string; boardMasterId: number; name: string }[] = [
  { orgCd: "hg", boardMasterId: 342, name: "한강유역환경청" },
  { orgCd: "ndg", boardMasterId: 156, name: "낙동강유역환경청" },
  { orgCd: "gg", boardMasterId: 235, name: "금강유역환경청" },
  { orgCd: "ysg", boardMasterId: 295, name: "영산강유역환경청" },
  { orgCd: "wonju", boardMasterId: 255, name: "원주지방환경청" },
  { orgCd: "daegu", boardMasterId: 167, name: "대구지방환경청" },
  { orgCd: "smg", boardMasterId: 290, name: "전북지방환경청" },
  { orgCd: "mamo", boardMasterId: 195, name: "수도권대기환경청" },
];

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// "Wed Jul 08 15:00:00 KST 2026" → "2026-07-08" (mcee RSS 와 동일 CMS 포맷)
function parseRssDate(s: string): string | null {
  const m = (s ?? "").match(/([A-Z][a-z]{2})\s+(\d{2})\s+[\d:]+\s+\S+\s+(\d{4})/);
  return m && MONTHS[m[1]] ? `${m[3]}-${MONTHS[m[1]]}-${m[2]}` : null;
}

export async function fetchMeOfficeRss(office: (typeof ME_OFFICES)[number]): Promise<GosiItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await undiciFetch(
      `https://www.me.go.kr/${office.orgCd}/web/board/rss.do?boardMasterId=${office.boardMasterId}`,
      { headers: { "user-agent": UA }, signal: controller.signal }
    );
    if (!res.ok) throw new Error(`환경청 RSS 응답 오류: ${res.status} ${office.orgCd}`);
    const xml = await res.text();
    const items: GosiItem[] = [];
    for (const chunk of xml.split("<item>").slice(1)) {
      const title = chunk.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/);
      const boardId = chunk.match(/boardId=(\d+)/);
      const menuId = chunk.match(/menuId=(\d+)/);
      const pub = chunk.match(/<pubDate>([^<]*)<\/pubDate>/);
      if (!title || !boardId) continue;
      items.push({
        channel: "me",
        externalId: `me:${office.orgCd}:${boardId[1]}`,
        title: clean(title[1]),
        url:
          `https://www.me.go.kr/${office.orgCd}/web/board/read.do?boardMasterId=${office.boardMasterId}` +
          `&boardId=${boardId[1]}${menuId ? `&menuId=${menuId[1]}` : ""}`,
        agency: office.name,
        region: null,
        publishedAt: pub ? parseRssDate(pub[1]) : null,
      });
    }
    return items;
  } finally {
    clearTimeout(timer);
  }
}
