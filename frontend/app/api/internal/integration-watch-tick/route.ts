import { NextRequest, NextResponse } from "next/server";
import { runIntegrationWatch } from "@/lib/ops/integration-watch";
import { kstParts } from "@/lib/ops/integration-watch-core";
import { isSyncStale, runFinanceSync } from "@/lib/barobill/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 외부 연동 상태 감시 틱(docs/integration-watchdog-blueprint.md §4) — instrumentation.ts 가 10분마다 자기호출.
// ⚠ Aurora auto-pause 보호(infra/aws/ops/README.md "틱을 새로 추가할 때"): 실행 여부는 프로세스 메모리로만
//    판정하고 DB 를 열지 않는다. KST 08~20시에 시간당 1회만 점검한다(야간 03시 배치 실패는 08시대 첫 점검에서 잡힌다).
//    재기동 직후 같은 시간대에 한 번 더 돌 수 있으나 알림은 integration_health 전이로만 나가므로 중복 발송이 없다.
const g = globalThis as { __integrationWatchSlot?: string; __integrationFinanceDay?: string };

const FIRST_HOUR = 8;
const LAST_HOUR = 20;

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { ymd, hour } = kstParts(Date.now());
  if (hour < FIRST_HOUR || hour > LAST_HOUR) return NextResponse.json({ ok: true, skipped: "outside-hours" });
  const slot = `${ymd}T${hour}`;
  if (g.__integrationWatchSlot === slot) return NextResponse.json({ ok: true, skipped: "done-this-hour" });
  g.__integrationWatchSlot = slot;

  // 바로빌 계좌·카드는 재무 화면을 열 때만 따라잡기 동기화가 돈다 — 하루 첫 점검에서 밀렸으면 먼저 동기화(결정 3).
  let finance: string | undefined;
  if (g.__integrationFinanceDay !== ymd && process.env.BAROBILL_CERTKEY) {
    g.__integrationFinanceDay = ymd;
    try {
      if (await isSyncStale()) {
        const r = await runFinanceSync();
        finance = r.ran ? `synced ${r.targets.length}` : "fresh";
      } else {
        finance = "fresh";
      }
    } catch (e) {
      finance = `error: ${e instanceof Error ? e.message : String(e)}`; // 실패는 아래 판정이 finance_sync_logs 로 잡는다
    }
  }

  try {
    const summary = await runIntegrationWatch();
    console.log("[integration-watch]", JSON.stringify({ ...summary, finance }));
    return NextResponse.json({ ok: true, finance, ...summary });
  } catch (e) {
    g.__integrationWatchSlot = undefined; // 다음 틱에 재시도
    console.error("[integration-watch] error", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
