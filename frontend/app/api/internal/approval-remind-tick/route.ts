import { NextRequest, NextResponse } from "next/server";
import { dispatchDueReminders } from "@/lib/approval/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 미결재 리마인드 틱(AX-P1) — instrumentation.ts 주기 타이머가 자기호출(localhost).
 * instrumentation 은 edge 로도 번들되어 pg 직접 import 불가 → 라우트로 위임.
 * AUTH_SECRET 헤더 가드. 디스패처 자체가 스텝×일자 dedup 이라 이중 안전.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const result = await dispatchDueReminders();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[approval-remind] tick error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
