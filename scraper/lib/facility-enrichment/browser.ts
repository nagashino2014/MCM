import type { Browser, Page } from "playwright";
import { FIELDS, nameKey, searchNames, type Field, type Profile, type Snapshot } from "../facility-quality/rules";

export type Outcome = { status: "success" | "not_found" | "not_exposed" | "parse_error" | "blocked" | "not_configured" | "quota" | "timeout" | "error"; profiles: Profile[]; missing?: Field[]; note?: string };
export type Navigate = (page: Page, url: string, source: string) => Promise<void>;
export const BIZNO_LABELS: Record<string, Field> = { "사업자등록번호": "business_registration_no", "법인등록번호": "corporate_registration_no", "전화번호": "phone_number", "회사주소": "site_address" };
export const NAVER_LABELS: Record<string, Field> = { ...BIZNO_LABELS, "대표자": "representative_name", "대표자명": "representative_name", "본사": "site_address", "주소": "site_address", "전화": "phone_number" };

/** 같은 함수를 브라우저 DOM과 fixture 검증에서 사용한다. 숨겨진 스크립트·응답은 읽지 않는다. */
export function readNaverCard() {
  const visible = (e: Element) => !!(e as HTMLElement).getClientRects().length;
  const sections = Array.from(document.querySelectorAll("section")).filter(e => visible(e) && e.querySelector("h2") &&
    Array.from(e.querySelectorAll("a,button")).some(a => a.textContent?.includes("기업정보 안내")));
  // 여러 기업 카드가 있으면 임의로 첫 번째 업체를 선택하지 않는다.
  if (sections.length !== 1) return { status: sections.length ? "ambiguous" : "not_found", name: "", values: {}, links: [] };
  const root = sections[0];
  if (!root.querySelector("dt")) return { status: "parse_error", name: "", values: {}, links: [] };
  const name = (root.querySelector("h2 a")?.textContent ?? root.querySelector("h2")?.textContent ?? "").replace(/채용중\s*$/, "").trim();
  const labels: Record<string, string> = { "대표자": "representative_name", "대표자명": "representative_name", "본사": "site_address", "주소": "site_address", "전화": "phone_number", "전화번호": "phone_number", "사업자등록번호": "business_registration_no", "법인등록번호": "corporate_registration_no" };
  const values: Record<string, string> = {};
  for (const dt of Array.from(root.querySelectorAll("dt"))) {
    const field = labels[(dt.textContent ?? "").trim()];
    const dd = dt.nextElementSibling;
    if (!field || dd?.tagName !== "DD" || !visible(dd)) continue;
    const value = (dd as HTMLElement).innerText.replace(/\s+/g, " ").trim();
    if (value) values[field] = value;
  }
  const links = Array.from(root.querySelectorAll("a")).filter(visible).map(a => ({ text: (a.innerText ?? "").replace(/\s+/g, " ").trim(), url: a.href }));
  return { status: "success", name, values, links };
}

export async function naver(browser: Browser, snapshot: Snapshot, navigate: Navigate): Promise<Outcome> {
  const page = await browser.newPage();
  try {
    await navigate(page, `https://search.naver.com/search.naver?query=${encodeURIComponent(snapshot.company_name)}`, "naver");
    let card = await page.evaluate(readNaverCard);
    if (card.status === "not_found" && searchNames(snapshot.company_name).length > 1) {
      await navigate(page, `https://search.naver.com/search.naver?query=${encodeURIComponent(searchNames(snapshot.company_name)[1])}`, "naver");
      card = await page.evaluate(readNaverCard);
    }
    if (card.status !== "success") return { status: card.status === "not_found" ? "not_found" : "parse_error", profiles: [] };
    for (const label of ["더보기", "기본정보"]) {
      const link = card.links.find(a => label === "더보기" ? a.text.endsWith(" 더보기") : a.text === label);
      if (!link) continue;
      const url = new URL(link.url);
      if (url.hostname !== "search.naver.com" || url.searchParams.get("pkid") !== "594") continue;
      const priorName = card.name;
      await navigate(page, url.href, "naver");
      const next = await page.evaluate(readNaverCard);
      if (next.status !== "success" || nameKey(next.name) !== nameKey(priorName)) return { status: "parse_error", profiles: [], note: "상세 카드의 업체명이 변경되었습니다" };
      card = { ...next, values: { ...card.values, ...next.values } };
    }
    const nice = card.links.find(a => { try { return new URL(a.url).hostname === "www.nicebizinfo.com"; } catch { return false; } });
    const p: Profile = { source: "naver", name: card.name, url: page.url(), retrievedAt: new Date().toISOString(), values: card.values, scope: "headquarters",
      externalId: nice ? `nice:${new URL(nice.url).searchParams.get("kiscode")}` : new URL(page.url()).searchParams.get("os") ?? undefined };
    return { status: Object.keys(p.values).length ? "success" : "not_exposed", profiles: [p], missing: FIELDS.filter(f => !p.values[f]) };
  } finally { await page.close(); }
}

export async function bizno(browser: Browser, snapshot: Snapshot, navigate: Navigate): Promise<Outcome> {
  const page = await browser.newPage();
  try {
    await navigate(page, `https://bizno.net/?query=${encodeURIComponent(snapshot.company_name)}`, "bizno");
    // 대표자가 있는 결과 블록 전체를 가져오지 않는다. 링크의 회사명·URL만 읽는다.
    const links = await page.locator('a[href*="/article/"]').evaluateAll(els => els.map(a => ({ name: (a as HTMLElement).innerText.trim(), url: (a as HTMLAnchorElement).href })));
    const matching = links.filter(a => searchNames(snapshot.company_name).some(n => nameKey(a.name) === nameKey(n)));
    const unique = [...new Map(matching.map(a => [a.url, a])).values()];
    if (!unique.length) return { status: "not_found", profiles: [] };
    if (unique.length > 3) return { status: "parse_error", profiles: [], note: "동명 업체가 많아 수동 확인 필요" };
    const profiles: Profile[] = [];
    for (const link of unique) {
      const u = new URL(link.url);
      if (u.hostname !== "bizno.net" || !/^\/article\/\d{10}$/.test(u.pathname)) continue;
      await navigate(page, u.href, "bizno");
      const detail = await page.evaluate((labels) => {
        const values: Record<string, string> = {};
        for (const th of Array.from(document.querySelectorAll("th"))) {
          const field = labels[(th.textContent ?? "").trim()];
          // allowlist 검사 전에 td 값에 접근하지 않는다. 대표자 추출·로그·캐시 금지.
          if (!field) continue;
          const td = th.nextElementSibling as HTMLElement | null;
          if (td?.tagName !== "TD" || !td.getClientRects().length) continue;
          let value = td.innerText.trim();
          if (field === "site_address") value = value.split(/\n+/)[0].trim(); // 도로명/지번을 합치지 않는다.
          if (value) values[field] = value;
        }
        return { name: document.querySelector("h1")?.textContent?.trim() ?? "", values };
      }, BIZNO_LABELS);
      if (nameKey(detail.name) !== nameKey(link.name) || !detail.values.business_registration_no) continue;
      profiles.push({ source: "bizno", name: detail.name, url: page.url(), retrievedAt: new Date().toISOString(), values: detail.values, scope: "unknown", externalId: u.pathname.slice(9) });
    }
    return { status: profiles.length ? "success" : "parse_error", profiles };
  } finally { await page.close(); }
}
