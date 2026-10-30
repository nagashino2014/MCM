/**
 * 외부 연동 감시(316) 심장박동 기록 — 수집 경로(야간 배치·사내 PC 반입구)가 호출한다.
 * 알림·판정 모듈(integration-watch.ts)과 분리해 배치 번들이 push·메일 의존을 끌고 오지 않게 한다.
 */

import { withDbWrite } from "@/lib/db";

/**
 * 수집 경로가 "돌았다/성공했다"를 남긴다. ok=false 면 last_seen_at·last_error 만 갱신한다.
 * 감시 기록 실패가 수집 자체를 깨뜨리지 않도록 예외를 삼킨다.
 */
export async function recordHeartbeat(
  source: string,
  input: { ok: boolean; error?: string | null; detail?: Record<string, unknown> }
): Promise<void> {
  try {
    await withDbWrite(async (db) => {
      await db.run(
        `INSERT INTO integration_heartbeats (source, last_seen_at, last_ok_at, last_error, detail, updated_at)
         VALUES ($1, now(), CASE WHEN $2 THEN now() END, $3, $4::jsonb, now())
         ON CONFLICT (source) DO UPDATE SET
           last_seen_at = now(),
           last_ok_at   = CASE WHEN $2 THEN now() ELSE integration_heartbeats.last_ok_at END,
           last_error   = CASE WHEN $2 THEN NULL ELSE EXCLUDED.last_error END,
           detail       = EXCLUDED.detail,
           updated_at   = now()`,
        [source, input.ok, input.ok ? null : (input.error ?? "실패").slice(0, 500), JSON.stringify(input.detail ?? {})]
      );
    });
  } catch (err) {
    console.warn(`[integration-watch] heartbeat 기록 실패 ${source}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
