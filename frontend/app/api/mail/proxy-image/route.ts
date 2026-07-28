import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 붙여넣기 이미지 수집 프록시 — 다른 웹메일(네이버 등)에서 서명을 복사하면 이미지가
// 그쪽 서버의 외부 URL(세션·Referer 검증)로 들어와 우리 화면에서 깨진다. 이를 서버가 한 번
// 받아 data URL 로 돌려주면 본문/서명이 자기완결(self-contained) 상태가 된다.
// ⚠ 사용자가 URL 을 지정하는 서버 요청이므로 SSRF 방어 필수: https(s) 만·사설망 차단·크기 상한.

const MAX_BYTES = 3 * 1024 * 1024; // 3MB — 서명 이미지(명함) 기준 충분
const FETCH_TIMEOUT_MS = 8000;

/** 사설·루프백·링크로컬 대역 차단(SSRF). 호스트명이 IP 가 아니면 DNS 결과로 재검사한다. */
function isBlockedAddress(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  // IPv6 루프백·유니크로컬
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // 링크로컬(클라우드 메타데이터)
  return false;
}

export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const body = (await req.json().catch(() => ({}))) as { url?: string };
    const raw = String(body.url ?? "").trim();
    if (!raw) return NextResponse.json({ error: "url 이 필요합니다." }, { status: 400 });

    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return NextResponse.json({ error: "URL 형식이 아닙니다." }, { status: 400 });
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return NextResponse.json({ error: "http(s) 주소만 가져올 수 있습니다." }, { status: 400 });
    }
    if (isBlockedAddress(target.hostname)) {
      return NextResponse.json({ error: "내부 주소는 가져올 수 없습니다." }, { status: 400 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(target.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          // 원본 페이지를 Referer 로 보내야 핫링크 차단(네이버 등)을 통과하는 경우가 많다.
          Referer: target.origin,
          "User-Agent": "Mozilla/5.0 (compatible; KoensainMail/1.0)",
          Accept: "image/*",
        },
      });
    } catch {
      return NextResponse.json({ error: "이미지를 가져오지 못했습니다." }, { status: 502 });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return NextResponse.json({ error: `이미지를 가져오지 못했습니다(HTTP ${res.status}).` }, { status: 502 });

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "이미지가 아닙니다." }, { status: 415 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "이미지가 너무 큽니다(3MB 초과)." }, { status: 413 });
    }
    return NextResponse.json({ dataUrl: `data:${contentType};base64,${buf.toString("base64")}` });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
