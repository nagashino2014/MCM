import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { mailFeed, PC_FEED_ISO_RE } from "@/lib/notify/pc-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * (구) 새 메일 PC 알림 피드 — 2026-11-12 1차 웹 알림이 쓰던 주소. 새 코드는 /api/notify/pc-feed 를 쓴다.
 * 배포 직후 새로고침 전 탭이 부를 수 있어 같은 응답 모양으로 남겨 둔다(조회는 lib/notify/pc-feed.ts 의 mailFeed).
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const serverNow = new Date().toISOString();
    const since = String(req.nextUrl.searchParams.get("since") ?? "");
    if (!PC_FEED_ISO_RE.test(since)) return NextResponse.json({ serverNow, total: 0, items: [] });
    const feed = await mailFeed(ctx.userId, since);
    return NextResponse.json({
      serverNow,
      total: feed.total,
      items: feed.items.map((it) => ({
        messageId: it.target.kind === "mail" ? it.target.id : "",
        subject: it.body,
        from: it.title,
        arrivedAt: it.at,
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
