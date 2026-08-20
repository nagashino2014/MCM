import { NextRequest, NextResponse } from "next/server";
import { dispatchBidDeadlineReminders, dispatchDueBidNotices, duePrefetchSlots, isBidNotifyDue } from "@/lib/bid/notify-dispatch";
import { loadBidNotifyConfig } from "@/lib/bid/notify-settings";
import { getDb } from "@/lib/db";
import { listEnabledCustomCollectors } from "@/lib/scraper/sources-store";
import { logScraperRun } from "@/lib/scraper/run-log";
import { collectBidSource } from "@/lib/bid/bid-sink";
import { matchAndQueueBidNotices } from "@/lib/bid/match-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 프리페치 슬롯별 1회 실행(프로세스 내) — 수집은 upsert 멱등이라 재기동 후 재실행도 무해.
const g = globalThis as { __bidPrefetchDone?: Set<string> };
const prefetchDone = (g.__bidPrefetchDone ??= new Set<string>());

/**
 * 발송 슬롯 10분 전 최신화(2026-08-20) — 입찰공고·사전규격·발주계획 소스를 즉시 수집해
 * DB 를 최신 상태로 만든 뒤 발송한다. 아침 정기 배치(batch_hour·last_batch_date)와는
 * 독립이라 배치 멱등을 건드리지 않는다(markSourceBatchRun 미호출, run 로그 trigger='prefetch').
 */
async function runPrefetch(slots: string[]): Promise<Array<Record<string, unknown>>> {
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const fresh = slots.filter((s) => !prefetchDone.has(`${today} ${s}`));
  if (!fresh.length) return [];
  for (const s of fresh) prefetchDone.add(`${today} ${s}`);
  if (prefetchDone.size > 64) prefetchDone.clear(); // 날짜가 지난 키 정리(러프하게)

  const db = await getDb();
  const collectors = await listEnabledCustomCollectors(db, "bid");
  const ran: Array<Record<string, unknown>> = [];
  for (const { source, endpoint } of collectors) {
    const startedAt = new Date().toISOString();
    try {
      const r = await collectBidSource(source, endpoint, {});
      await logScraperRun({
        source, endpoint, trigger: "prefetch",
        scanned: r.scanned, inserted: r.inserted,
        updated: (r as { updated?: number }).updated ?? 0,
        error: r.error ?? null, startedAt,
      });
      if (r.insertedItems?.length) {
        try {
          await matchAndQueueBidNotices(r.bidType, r.insertedItems);
        } catch (err) {
          console.error(`[bid-prefetch] ${source.slug} match error`, err);
        }
      }
      ran.push({ slug: source.slug, scanned: r.scanned, inserted: r.inserted, error: r.error ?? null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logScraperRun({ source, endpoint, trigger: "prefetch", error: msg, startedAt });
      ran.push({ slug: source.slug, error: msg });
      console.error(`[bid-prefetch] ${source.slug} error`, err);
    }
  }
  console.log("[bid-prefetch] slots", fresh.join(","), JSON.stringify(ran));
  return ran;
}

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
    // 발송 시각·프리페치 창 전이면 DB 를 열지 않고 끝낸다 — Aurora auto-pause 유지(lib/tick-cache.ts).
    if (!(await isBidNotifyDue())) {
      return NextResponse.json({ dispatched: 0, skipped: "not-due" });
    }
    // 발송 슬롯 10분 전 창이면 대상 종류 수집을 먼저 돌려 최신화한다.
    const { profiles } = await loadBidNotifyConfig();
    const slots = duePrefetchSlots(profiles);
    const prefetch = slots.length ? await runPrefetch(slots) : [];
    const result = await dispatchDueBidNotices();
    // 마감 임박(M6-C)은 매칭 발송과 독립 — 매칭이 "오늘 이미 발송"으로 끝나도 따로 돈다.
    const deadline = await dispatchBidDeadlineReminders();
    return NextResponse.json({ ...result, deadline, ...(prefetch.length ? { prefetch } : {}) });
  } catch (err) {
    console.error("[bid-notify] tick error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
