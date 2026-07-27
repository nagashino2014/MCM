import { NextRequest, NextResponse } from "next/server";
import { recordOpen } from "@/lib/mail/receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1x1 투명 PNG(추적 픽셀).
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * 수신 확인 픽셀(G2-10) — 발송 메일 본문에 삽입된 <img> 가 로드되면 열람 기록.
 * 무인증(외부 수신자가 호출) — messageId 는 무작위 id, 존재하는 발신 메시지만 기록.
 * 어떤 경우에도 픽셀은 반환한다(수신자 화면에 깨짐 없게).
 */
export async function GET(req: NextRequest) {
  const m = String(req.nextUrl.searchParams.get("m") ?? "");
  const r = String(req.nextUrl.searchParams.get("r") ?? "");
  if (m && r) {
    try {
      await recordOpen(m, r);
    } catch (err) {
      console.error("[mail-track] 기록 실패", err);
    }
  }
  return new NextResponse(PIXEL, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}
