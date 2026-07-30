import { NextRequest, NextResponse } from "next/server";
import { dispatchBidDeadlineReminders, dispatchDueBidNotices } from "@/lib/bid/notify-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 공공입찰 매칭 알림 발송 틱 — instrumentation.ts 의 주기 타이머가 자기호출(localhost)한다.
 * instrumentation 은 edge 로도 번들되어 pg 를 직접 import 할 수 없어 라우트로 위임.
 * AUTH_SECRET 헤더 가드(외부 오호출 방지 — 디스패처 자체도 발송시각·일1회 멱등이라 이중 안전).
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await dispatchDueBidNotices();
    // 마감 임박(M6-C)은 매칭 발송과 독립 — 매칭이 "오늘 이미 발송"으로 끝나도 따로 돈다.
    const deadline = await dispatchBidDeadlineReminders();
    return NextResponse.json({ ...result, deadline });
  } catch (err) {
    console.error("[bid-notify] tick error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
