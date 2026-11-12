import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { isPcWidgetActive, markPcWidgetSeen, pcFeed, type PcNotifyKind } from "@/lib/notify/pc-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PC 알림 피드(메일·전자결재·메신저) — ?mail=<ISO>&approval=<ISO>&chat=<ISO>, 준 종류만 조회한다.
 * 응답: { serverNow, pcWidgetActive, mail?, approval?, chat? } (각 { total, items }).
 * - 웹: 네비 뱃지 신호가 기준선보다 커졌을 때만 부른다(lib/notify/pc-notify-client.ts).
 * - 데스크탑 위젯 브리지(public/pc-notify-bridge.html): 15초마다 부르고 `X-MCM-Client: pc-widget` 을 붙인다 →
 *   위젯 접속 표시를 남겨 웹 알림이 양보할 수 있게 한다.
 * 종류를 하나도 안 주면 serverNow 만(켜기 시 기준선 잡기).
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    if (req.headers.get("x-mcm-client") === "pc-widget") markPcWidgetSeen(ctx.userId);
    const serverNow = new Date().toISOString();
    const sp = req.nextUrl.searchParams;
    const since: Partial<Record<PcNotifyKind, string>> = {};
    for (const k of ["mail", "approval", "chat"] as const) {
      const v = sp.get(k);
      if (v) since[k] = v;
    }
    const feed = await pcFeed(ctx.userId, since);
    return NextResponse.json({ serverNow, pcWidgetActive: isPcWidgetActive(ctx.userId), ...feed });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
