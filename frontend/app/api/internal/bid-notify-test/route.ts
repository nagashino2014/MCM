import { NextRequest, NextResponse } from "next/server";
import { sendTestNotification } from "@/lib/bid/notify-dispatch";
import { loadBidNotifyConfig } from "@/lib/bid/notify-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 저장된 발송 조건으로 테스트 전송(운영 점검용) — AUTH_SECRET 헤더 가드.
 * body: { profileId?: string } 미지정이면 첫 조건. 큐·발송이력은 변경하지 않는다.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const { profiles } = await loadBidNotifyConfig();
    const profile = body?.profileId
      ? profiles.find((p) => p.profileId === body.profileId)
      : profiles[0];
    if (!profile) return NextResponse.json({ error: "발송 조건이 없습니다." }, { status: 404 });
    const result = await sendTestNotification(profile);
    return NextResponse.json({ profile: profile.name, ...result });
  } catch (err) {
    console.error("[bid-notify] test error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
