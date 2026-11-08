import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { enqueueAwsJob, isFacilityQualityQueueEnabled } from "@/lib/ieps/aws-job-queue";
import { dailyLimit, SEARCH_SOURCES } from "@scraper/lib/facility-enrichment/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MIN = 10;

/**
 * 검색 진행 상황. 대기 회사의 updated_at 은 대기에 넣은 시각이라, 그중 가장 이른 시각을
 * 이번 검색의 시작으로 보고 그 뒤에 끝난 회사를 센다. 속도는 최근 10분 동안 끝난 회사 수다.
 */
export async function GET() {
  try {
    await requirePermission("facility.edit");
    const db = await getDb();
    const state = rowsToObjects(await db.exec(
      `SELECT COUNT(*) FILTER (WHERE decision IS NULL AND search_status IN ('pending', 'running'))::int AS remaining,
              COUNT(*) FILTER (WHERE decision IS NULL AND search_status = 'paused')::int AS paused,
              COUNT(*) FILTER (WHERE decision IS NULL AND search_status = 'running' AND search_lease_until > now())::int AS active,
              MIN(updated_at) FILTER (WHERE decision IS NULL AND search_status IN ('pending', 'running')) AS run_start
         FROM contact_import_companies`
    ))[0] ?? {};
    const remaining = Number(state.remaining ?? 0);
    const runStart = state.run_start != null ? String(state.run_start) : null;
    const recentSince = new Date(Date.now() - RATE_WINDOW_MIN * 60_000).toISOString();
    const finished = rowsToObjects(await db.exec(
      `SELECT COUNT(*) FILTER (WHERE updated_at >= $1)::int AS finished,
              COUNT(*) FILTER (WHERE updated_at >= GREATEST($1, $2))::int AS recent,
              MAX(updated_at) AS last_at
         FROM contact_import_companies
        WHERE search_status NOT IN ('pending', 'running') AND search_outcomes <> '{}'::jsonb`,
      [runStart ?? recentSince, recentSince]
    ))[0] ?? {};
    const finishedCount = runStart ? Number(finished.finished ?? 0) : 0;
    // 시작한 지 10분이 안 됐으면 지난 시간으로 나눈다.
    const window = runStart ? Math.min(RATE_WINDOW_MIN, Math.max(1, (Date.now() - Date.parse(runStart)) / 60_000)) : RATE_WINDOW_MIN;
    const perMinute = Number(finished.recent ?? 0) / window;
    const usage = new Map(rowsToObjects(await db.exec(
      `SELECT source, requests FROM facility_quality_source_requests WHERE day = CURRENT_DATE`
    )).map((r) => [String(r.source), Number(r.requests)]));
    const resetAt = rowsToObjects(await db.exec(`SELECT (CURRENT_DATE + 1)::timestamptz AS reset_at`))[0]?.reset_at;
    return NextResponse.json({
      remaining,
      finished: finishedCount,
      total: finishedCount + remaining,
      paused: Number(state.paused ?? 0),
      active: Number(state.active ?? 0) > 0,
      perMinute,
      etaMinutes: remaining > 0 && perMinute > 0 ? remaining / perMinute : null,
      lastFinishedAt: finished.last_at != null ? String(finished.last_at) : null,
      sources: SEARCH_SOURCES.map((source) => ({ source, used: usage.get(source) ?? 0, limit: dailyLimit(source) })),
      resetAt: resetAt != null ? new Date(String(resetAt)).toISOString() : null,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 한도·차단으로 멈췄거나 조회가 실패한 회사의 사업자번호 검색을 이어 간다. */
export async function POST() {
  try {
    await requirePermission("facility.edit");
    if (!isFacilityQualityQueueEnabled()) {
      return NextResponse.json({ error: "외부 조회 워커가 연결되지 않은 환경입니다." }, { status: 409 });
    }
    // 대기에 넣은 시각을 남겨 진행률의 시작점으로 쓴다.
    await withDbWrite((db) => db.run(
      `UPDATE contact_import_companies SET search_status = 'pending', updated_at = $1
        WHERE decision IS NULL AND search_status IN ('paused', 'attention', 'pending')`,
      [new Date().toISOString()]
    ));
    await enqueueAwsJob({ type: "contact-import-search" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
