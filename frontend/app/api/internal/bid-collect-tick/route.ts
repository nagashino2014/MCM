import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  DEFAULT_BATCH_HOUR,
  listEnabledCustomCollectors,
  markSourceBatchRun,
} from "@/lib/scraper/sources-store";
import { logScraperRun } from "@/lib/scraper/run-log";
import { collectBidSource } from "@/lib/bid/bid-sink";
import { matchAndQueueBidNotices } from "@/lib/bid/match-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** KST 기준 현재 시(0~23)와 날짜(YYYY-MM-DD). */
function kstNow(): { hour: number; date: string } {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return { hour: kst.getUTCHours(), date: kst.toISOString().slice(0, 10) };
}

// 동시 실행 방지(5분 틱이 겹치거나 수집이 길어질 때) — 프로세스 내 락.
const inFlight = new Set<string>();

/**
 * 공공입찰 수집 틱 — instrumentation.ts 의 5분 타이머가 자기호출한다.
 * ⚠ 야간 배치(KST 03:00)에서 분리한 이유: 나라장터(공공데이터포털)가 새벽 시간대에
 *    응답 없이 60초 타임아웃되는 사례 실측(2026-08-05). 소스별 batch_hour(기본 07시)에
 *    도달하면 수집하고, last_batch_date(KST)로 하루 1회 멱등을 보장한다.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const { hour, date } = kstNow();
    const db = await getDb();
    const collectors = await listEnabledCustomCollectors(db, "bid");
    const ran: Array<Record<string, unknown>> = [];

    for (const { source, endpoint } of collectors) {
      const targetHour = source.batchHour ?? DEFAULT_BATCH_HOUR;
      if (hour !== targetHour) continue;
      if (source.lastBatchDate === date) continue; // 오늘 이미 수집됨
      if (inFlight.has(endpoint.endpointId)) continue;

      inFlight.add(endpoint.endpointId);
      const startedAt = new Date().toISOString();
      try {
        const r = await collectBidSource(source, endpoint, {});
        await logScraperRun({
          source, endpoint, trigger: "batch",
          scanned: r.scanned, inserted: r.inserted,
          updated: (r as { updated?: number }).updated ?? 0,
          error: r.error ?? null, startedAt,
        });
        // 신규 건만 사업분야 매칭 알림 큐 적재(발송은 설정 시각에 디스패처가).
        if (r.insertedItems?.length) {
          try {
            await matchAndQueueBidNotices(r.bidType, r.insertedItems);
          } catch (err) {
            console.error(`[bid-collect] ${source.slug} match error`, err);
          }
        }
        // 완전 실패(0건+오류)면 날짜를 찍지 않는다 — 다음 틱에서 재시도.
        if (!r.error || r.scanned > 0) await markSourceBatchRun(source.sourceId, date);
        ran.push({ slug: source.slug, scanned: r.scanned, inserted: r.inserted, error: r.error ?? null });
        console.log(`[bid-collect] ${source.slug}`, JSON.stringify({ scanned: r.scanned, inserted: r.inserted, error: r.error }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await logScraperRun({ source, endpoint, trigger: "batch", error: msg, startedAt });
        ran.push({ slug: source.slug, error: msg });
        console.error(`[bid-collect] ${source.slug} error`, err);
      } finally {
        inFlight.delete(endpoint.endpointId);
      }
    }
    return NextResponse.json({ hour, date, candidates: collectors.length, ran });
  } catch (err) {
    console.error("[bid-collect] tick error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
