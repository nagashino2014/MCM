// 정부·지자체 투자유치 보도자료 크롤링 클라이언트. 발주 신호(press) 수집용.
// 투자협약(MOU)의 원천은 지자체 투자유치과 명의 보도자료라 뉴스보다 같거나 빠르고,
// 담당부서 필드·정형 문장 덕에 기업명·투자액·입지 추출 정확도가 높다(2026-07-08 실사).
// 어댑터: 울산·전남(게시판 크롤링, 정부 표준 아님 → 개별 파서) + 기후에너지환경부(RSS, 본문 포함).
// 경북(gb.go.kr)은 리퍼러/세션 체크로 직접 접근 차단 — 추후 어댑터 추가 검토.
// 주의: 2026 부처개편으로 구 환경부(me.go.kr) RSS 는 3월에 갱신 정지된 좀비 — mcee 신규 피드만 사용.

import { fetch as undiciFetch } from "undici";

export type PressSourceKey = "ulsan" | "jeonnam" | "gyeongbuk" | "chungnam" | "mcee";

export const PRESS_SOURCE_LABELS: Record<PressSourceKey, string> = {
  ulsan: "울산광역시",
  jeonnam: "전라남도",
  gyeongbuk: "경상북도",
  chungnam: "충청남도",
  mcee: "기후에너지환경부",
};

export interface PressItem {
  sourceKey: PressSourceKey;
  title: string;
  url: string; // 정규화 상세 URL — external_id(중복방지 키)
  dept: string | null; // 담당부서(투자유치과 등 — 사전 필터 신호)
  publishedAt: string | null; // ISO(날짜만)
  body: string | null; // mcee 는 RSS description 포함, 울산·전남은 fetchPressBody 로 별도
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

/** HTML 태그·엔티티 제거 + 공백 정리. */
function clean(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

const textOrNull = (s: string): string | null => (s ? s : null);

// "2026.07.08" / "2026-07-01" → ISO. 실패 시 null.
function toIsoDate(s: string): string | null {
  const m = (s ?? "").match(/(\d{4})[.\-/]\s*(\d{2})[.\-/]\s*(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function get(url: string, timeoutMs = 20000, referer?: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await undiciFetch(url, {
      headers: { "user-agent": UA, ...(referer ? { referer } : {}) },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`보도자료 응답 오류: ${res.status} ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// --- 울산광역시 (ulsan.go.kr) ---
// 리스트: 콘텐츠 페이지(GET)에 1페이지(15행)가 서버렌더링. 행: 번호·제목(a dataId)·부서·날짜·조회.
// 상세: /u/rep/bbs/view.do?bbsId&mId&dataId (fn_view 는 POST 지만 GET 도 동작 — 실측).

const ULSAN_LIST = "https://www.ulsan.go.kr/u/rep/contents.ulsan?mId=001004003001000000";
const ULSAN_VIEW = "https://www.ulsan.go.kr/u/rep/bbs/view.do?bbsId=BBS_0000000000000027&mId=001004003001000000&dataId=";

export async function fetchUlsanList(): Promise<PressItem[]> {
  const html = await get(ULSAN_LIST);
  const items: PressItem[] = [];
  for (const tr of html.split(/<tr[ >]/).slice(1)) {
    const link = tr.match(/dataId=(\d+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    // 셀 순서: 번호(re_blind7)·제목·부서(re_blind7)·날짜·조회(re_blind7) — a 이후 첫 re_blind7 이 부서
    const after = tr.slice(tr.indexOf("</a>"));
    const dept = after.match(/class="re_blind7"[^>]*>([\s\S]*?)<\/td>/);
    const date = after.match(/<td>\s*([\d.]{10})/);
    items.push({
      sourceKey: "ulsan",
      title: clean(link[2]),
      url: `${ULSAN_VIEW}${link[1]}`,
      dept: dept ? textOrNull(clean(dept[1])) : null,
      publishedAt: date ? toIsoDate(date[1]) : null,
      body: null,
    });
  }
  return items;
}

// --- 전라남도 (jeonnam.go.kr) ---
// 리스트: GET boardList.do (페이지당 10행). 행: 번호·제목(a seq, title 속성)·부서·날짜.
// 상세: GET boardView.do?seq — 본문 div.bbs_view_contnet(사이트 오타 그대로).

const JEONNAM_LIST = "https://www.jeonnam.go.kr/M7116/boardList.do?boardId=M7116&menuId=jeonnam0202000000";
const JEONNAM_VIEW = "https://www.jeonnam.go.kr/M7116/boardView.do?boardId=M7116&menuId=jeonnam0202000000&seq=";

export async function fetchJeonnamList(): Promise<PressItem[]> {
  const html = await get(JEONNAM_LIST);
  const items: PressItem[] = [];
  for (const tr of html.split(/<tr[ >]/).slice(1)) {
    const link = tr.match(/boardView\.do\?seq=(\d+)[^"]*"\s+title="([^"]*)"/);
    if (!link) continue;
    const after = tr.slice(tr.indexOf("</a>"));
    const dept = after.match(/<td[^>]*>\s*([^<]+?)\s*<\/td>/); // 제목 다음 첫 td = 부서
    const date = after.match(/class="date"[^>]*>\s*([\d\-. ]+)</);
    items.push({
      sourceKey: "jeonnam",
      title: clean(link[2]),
      url: `${JEONNAM_VIEW}${link[1]}`,
      dept: dept ? textOrNull(clean(dept[1])) : null,
      publishedAt: date ? toIsoDate(date[1]) : null,
      body: null,
    });
  }
  return items;
}

// --- 경상북도 (gb.go.kr) ---
// 리스트: GET page.do?mnu_uid=6792(보도자료) — ul.report_list 카드형. 제목(a title)·부서·날짜에
// 더해 본문 발췌(div.cont)까지 리스트에 포함 → 상세 페치 불필요.
// 주의: mnu_uid 가 틀리면 "정상적인 메뉴접근이 아닙니다" 차단 페이지가 뜬다(리퍼러 유지).
// 상세 정규화 URL 은 B_NUM/B_STEP 기반(cmd=2) — 실측으로 열림 확인.

const GB_LIST =
  "https://gb.go.kr/Main/page.do?mnu_uid=6792&LARGE_CODE=720&MEDIUM_CODE=50&SMALL_CODE=10&SMALL_CODE2=60&";
const gbDetailUrl = (bNum: string, bStep: string): string =>
  `https://gb.go.kr/Main/page.do?mnu_uid=6792&BD_CODE=bbs_bodo&cmd=2&B_NUM=${bNum}&B_STEP=${bStep}&B_LEVEL=0`;

export async function fetchGyeongbukList(): Promise<PressItem[]> {
  const html = await get(GB_LIST, 20000, "https://gb.go.kr/");
  if (html.includes("정상적인 메뉴접근")) throw new Error("경북 보도자료 접근 차단(메뉴 검증)");
  const items: PressItem[] = [];
  for (const li of html.split(/<li data-aa=/).slice(1)) {
    const link = li.match(/B_NUM=(\d+)[^"]*B_STEP=(\d+)[^"]*"\s+title="([^"]*)"/);
    if (!link) continue;
    // classify: <span>부서</span> ｜ <span>전화</span> ｜ <span>26-07-08</span>
    const spans = [...li.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => clean(m[1]));
    const dateRaw = spans.find((s) => /^\d{2}-\d{2}-\d{2}$/.test(s));
    const cont = li.match(/class="cont"[^>]*>([\s\S]*?)<\/div>/);
    items.push({
      sourceKey: "gyeongbuk",
      title: clean(link[3]),
      url: gbDetailUrl(link[1], link[2]),
      dept: textOrNull(spans[0] ?? ""),
      publishedAt: dateRaw ? `20${dateRaw}` : null,
      body: cont ? textOrNull(clean(cont[1]).slice(0, 3000)) : null,
    });
  }
  return items;
}

// --- 충청남도 (chungnam.go.kr) ---
// 보도자료는 공통게시판 OpenAPI(15060266)에 없고 별도 cnapcPress 시스템 → 크롤링(2026-07 실사).
// 리스트: GET list.do?pageIndex — 테이블(번호·제목(a.tit, nttId)·바로가기·부서·제공일자·조회).
// 상세: GET view.do?nttId — 본문 div.content. 간헐적 500 관측 → 실패는 수집측이 스킵·재시도.

const CN_LIST = "https://www.chungnam.go.kr/cnportal/cnapcPressList/cnapcPress/list.do?menuNo=500498&pageIndex=1";
const CN_VIEW = "https://www.chungnam.go.kr/cnportal/cnapcPressList/cnapcPress/view.do?menuNo=500498&nttId=";

export async function fetchChungnamList(): Promise<PressItem[]> {
  const html = await get(CN_LIST);
  const items: PressItem[] = [];
  for (const tr of html.split(/<tr[ >]/).slice(1)) {
    const link = tr.match(/view\.do\?nttId=(\d+)[^"]*"[^>]*class="tit"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    // 텍스트 td 나열에서 날짜(YYYY-MM-DD) td 를 찾고 그 직전 td 가 부서
    const tds = [...tr.matchAll(/<td[^>]*>\s*([^<]*?)\s*<\/td>/g)].map((m) => clean(m[1]));
    const dateIdx = tds.findIndex((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    items.push({
      sourceKey: "chungnam",
      title: clean(link[2]),
      url: `${CN_VIEW}${link[1]}`,
      dept: dateIdx > 0 ? textOrNull(tds[dateIdx - 1]) : null,
      publishedAt: dateIdx >= 0 ? tds[dateIdx] : null,
      body: null,
    });
  }
  return items;
}

// --- 기후에너지환경부 (mcee.go.kr) — RSS, description 에 본문 전문 포함 ---
// 링크는 상대경로+jsessionid 라 boardId 만 뽑아 정규화한다.

const MCEE_RSS = "https://www.mcee.go.kr/home/web/board/rss.do?menuId=10598&boardMasterId=939";
const MCEE_VIEW = "https://www.mcee.go.kr/home/web/board/read.do?menuId=10598&boardMasterId=939&boardId=";

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// "Wed Jul 08 15:00:00 KST 2026" → "2026-07-08" (KST 약어는 Date 파서가 못 읽어 수동 파싱)
function parseRssDate(s: string): string | null {
  const m = (s ?? "").match(/([A-Z][a-z]{2})\s+(\d{2})\s+[\d:]+\s+\S+\s+(\d{4})/);
  return m && MONTHS[m[1]] ? `${m[3]}-${MONTHS[m[1]]}-${m[2]}` : null;
}

export async function fetchMceeRss(): Promise<PressItem[]> {
  const xml = await get(MCEE_RSS);
  const items: PressItem[] = [];
  for (const chunk of xml.split("<item>").slice(1)) {
    const title = chunk.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/);
    const boardId = chunk.match(/boardId=(\d+)/);
    const desc = chunk.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/);
    const pub = chunk.match(/<pubDate>([^<]*)<\/pubDate>/);
    if (!title || !boardId) continue;
    items.push({
      sourceKey: "mcee",
      title: clean(title[1]),
      url: `${MCEE_VIEW}${boardId[1]}`,
      dept: null, // RSS 에 부서 없음
      publishedAt: pub ? parseRssDate(pub[1]) : null,
      body: desc ? textOrNull(clean(desc[1]).slice(0, 3000)) : null,
    });
  }
  return items;
}

/**
 * 울산·전남 상세 본문 추출. 울산은 테이블 뷰(가장 긴 td = 본문 휴리스틱),
 * 전남은 div.bbs_view_contnet. 실패 시 null(수집측은 제목만으로 분류).
 */
export async function fetchPressBody(item: PressItem): Promise<string | null> {
  if (item.body) return item.body;
  const html = await get(item.url);
  if (item.sourceKey === "chungnam") {
    // 본문 div.content 안 중첩 태그 대응: 다음 고정 블록(content-ft)까지 슬라이스
    const start = html.indexOf('class="content">');
    if (start < 0) return null;
    const end = html.indexOf("content-ft", start);
    const chunk = html.slice(start, end > start ? end : start + 20000);
    return textOrNull(clean(chunk.slice(chunk.indexOf(">") + 1)).slice(0, 3000));
  }
  if (item.sourceKey === "jeonnam") {
    // 본문 div 안에 미리보기 iframe div 가 중첩돼 있어 </div> 매칭이 일찍 끊긴다 →
    // 다음 고정 블록(bbs_inventory)까지 슬라이스 후 평문화(공공누리 꼬리는 무해).
    const start = html.indexOf('class="bbs_view_contnet"');
    if (start < 0) return null;
    const end = html.indexOf("bbs_inventory", start);
    const chunk = html.slice(start, end > start ? end : start + 20000);
    return textOrNull(clean(chunk.slice(chunk.indexOf(">") + 1)).slice(0, 3000));
  }
  // ulsan: 본문이 별도 클래스 없는 td 에 들어있어 가장 긴 td 텍스트를 취한다
  let best = "";
  for (const td of html.split(/<td[ >]/).slice(1)) {
    const text = clean(td.slice(td.indexOf(">") + 1, td.indexOf("</td>")));
    if (text.length > best.length) best = text;
  }
  return best.length >= 50 ? best.slice(0, 3000) : null;
}
