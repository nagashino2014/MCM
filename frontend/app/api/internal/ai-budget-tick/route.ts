import { NextRequest, NextResponse } from "next/server";
import { evaluateBudgets } from "@/lib/ai/budget";
import { kstToday } from "@/lib/ai/usage-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// AI API 예산 일 1회 평가(P2) — instrumentation.ts 가 1시간마다 자기호출.
// ⚠ Aurora auto-pause 보호(infra/aws/ops/README.md "틱을 새로 추가할 때"): "오늘 이미 실행" 판정은
//    프로세스 메모리로만 하고 DB 를 열지 않는다. 실행 시각은 KST 09시 이후 하루 1회. 재기동 후 중복 실행은
//    ai_budget_alerts 유니크 dedup 이 흡수한다(재발송 없음).
const g = globalThis as { __aiBudgetTickDone?: string };

export async function GET(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const today = kstToday();
  const hourKst = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
  if (hourKst < 9) return NextResponse.json({ ok: true, skipped: "before-09" });
  if (g.__aiBudgetTickDone === today) return NextResponse.json({ ok: true, skipped: "done-today" });
  g.__aiBudgetTickDone = today;

  try {
    const sent = await evaluateBudgets({ trigger: "daily", asOf: today });
    return NextResponse.json({ ok: true, day: today, sent });
  } catch (e) {
    g.__aiBudgetTickDone = undefined; // 다음 틱에 재시도
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
