import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { fetchUrlMeta } from "@/lib/agreement/convert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/*
 * 상품 링크 → 품명·단가 수집(FRM-P1, 구매품의서 link 열).
 * 1차: converter 의 headless Chromium 렌더(/render/url-meta) — 쿠팡·네이버·G마켓 등 주요 쇼핑몰은
 *      서버 단순 fetch 를 차단(403/로그인 우회/차단 페이지, 2026-08-26 실측)하므로 브라우저 렌더가 주경로.
 *      JSON-LD(schema.org Product)·가격 메타에서 단가까지 추출한다.
 * 2차 폴백: 직접 fetch 로 og:title/<title> — converter 미가용 시. 실패는 정상 경로(수동 입력 폴백).
 * SSRF 방지: http(s) + 기본 포트만, 사설/루프백 대역 호스트 거부(converter 쪽도 자체 거부).
 */

const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[::1\]|\[?fc|\[?fd|172\.(1[6-9]|2\d|3[01])\.)/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function extractTitle(html: string): string | null {
  // og:title(속성 순서 양방향) → <title> 폴백
  const og =
    /<meta[^>]+property\s*=\s*["']og:title["'][^>]+content\s*=\s*["']([^"']+)["']/i.exec(html) ??
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:title["']/i.exec(html);
  if (og?.[1]) return decodeEntities(og[1]).trim();
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (t?.[1]) return decodeEntities(t[1]).replace(/\s+/g, " ").trim();
  return null;
}

// GET ?url= : {title, price} — 수집 실패 시 null 값(에러 아님, 수동 입력 폴백)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const raw = req.nextUrl.searchParams.get("url") ?? "";
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return NextResponse.json({ error: "올바른 URL이 아닙니다." }, { status: 400 });
    }
    if (!["http:", "https:"].includes(url.protocol) || (url.port && !["80", "443"].includes(url.port)) || PRIVATE_HOST_RE.test(url.hostname)) {
      return NextResponse.json({ error: "허용되지 않는 주소입니다." }, { status: 400 });
    }
    // 1차 — converter Chromium 렌더(쇼핑몰 봇 차단 우회 + 단가 추출)
    const meta = await fetchUrlMeta(url.toString());
    if (meta?.title) {
      const price = meta.price ? String(meta.price).replace(/[^\d.]/g, "") : null;
      return NextResponse.json({ title: meta.title, price: price && Number(price) > 0 ? String(Math.round(Number(price))) : null });
    }
    // 2차 폴백 — 직접 fetch(og:title/<title> 만, 단가 없음)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          // 일반 브라우저 UA — 봇 차단 사이트 일부 통과(쿠팡류는 그래도 403 — 실패 폴백)
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "ko,en;q=0.8",
        },
      });
      if (!res.ok) return NextResponse.json({ title: null, price: null });
      const type = res.headers.get("content-type") ?? "";
      if (!type.includes("html")) return NextResponse.json({ title: null, price: null });
      // 제목은 문서 앞부분에 있다 — 앞 256KB 만 읽어 대용량 페이지 방어
      const reader = res.body?.getReader();
      let html = "";
      if (reader) {
        const decoder = new TextDecoder("utf-8");
        while (html.length < 256 * 1024) {
          const { done, value } = await reader.read();
          if (done) break;
          html += decoder.decode(value, { stream: true });
          if (/<\/title>/i.test(html) && /og:title/.test(html) === false && html.length > 64 * 1024) break;
        }
        void reader.cancel().catch(() => {});
      } else {
        html = (await res.text()).slice(0, 256 * 1024);
      }
      return NextResponse.json({ title: extractTitle(html), price: null });
    } catch {
      return NextResponse.json({ title: null, price: null });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return authErrorToResponse(err);
  }
}
