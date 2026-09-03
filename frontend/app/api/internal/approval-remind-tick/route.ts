import { NextRequest, NextResponse } from "next/server";
import { dispatchDueReminders } from "@/lib/approval/notify";
import { applyDueResignations } from "@/lib/approval/hr-actions";
import { dispatchFilingDueReminders } from "@/lib/filings/notify";

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
    // 퇴사일 도래 비활성(FRM-P3, 206) — 같은 틱에 얹는다(멱등, 실패해도 리마인드 결과는 반환).
    const resignations = await applyDueResignations().catch(() => ({ deactivated: 0 }));
    // 대외 신고 기한 알림(213) — 대기열 재파생 + 임박·초과 푸시(일자 dedup, 실패해도 무시).
    const filings = await dispatchFilingDueReminders();
    return NextResponse.json({ ...result, resignationsDeactivated: resignations.deactivated, filingsNotified: filings.notified });
  } catch (err) {
    console.error("[approval-remind] tick error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
