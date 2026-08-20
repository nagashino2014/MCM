/**
 * 커스텀 API 소스 수집 실행 로그(scraper_run_logs).
 * 야간배치(intel-batch)·수동 수집·백필이 엔드포인트 실행 1회마다 1행을 기록하고,
 * 소스 화면 "야간배치 실행 로그" 카드가 최근 내역을 조회한다.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { ScraperEndpointRow, ScraperSourceRow } from "./types";

export type RunTrigger = "batch" | "manual" | "backfill" | "prefetch";

export interface ScraperRunLogInput {
  source: Pick<ScraperSourceRow, "sourceId" | "slug">;
  endpoint?: Pick<ScraperEndpointRow, "endpointId" | "name"> | null;
  trigger: RunTrigger;
  scanned?: number;
  inserted?: number;
  updated?: number;
  error?: string | null;
  startedAt: string; // ISO
}

export interface ScraperRunLogRow {
  runId: string;
  sourceId: string;
  sourceSlug: string;
  endpointId: string | null;
  endpointName: string | null;
  trigger: RunTrigger;
  status: "success" | "error";
  scanned: number;
  inserted: number;
  updated: number;
  error: string | null;
  startedAt: string;
  finishedAt: string;
}

/** 실행 로그 1행 기록 — 로그 실패가 수집을 깨지 않도록 호출부에서 격리 없이 써도 안전(내부 try/catch). */
export async function logScraperRun(input: ScraperRunLogInput): Promise<void> {
  try {
    await withDbWrite(async (wdb) => {
      await wdb.run(
        `INSERT INTO scraper_run_logs
           (run_id, source_id, source_slug, endpoint_id, endpoint_name, trigger, status,
            scanned, inserted, updated, error, started_at, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          `srun_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
          input.source.sourceId,
          input.source.slug,
          input.endpoint?.endpointId ?? null,
          input.endpoint?.name ?? null,
          input.trigger,
          input.error ? "error" : "success",
          input.scanned ?? 0,
          input.inserted ?? 0,
          input.updated ?? 0,
          input.error ?? null,
          input.startedAt,
          new Date().toISOString(),
        ]
      );
    });
  } catch (err) {
    console.error("[scraper] run log write failed", err);
  }
}

/** 소스별 최근 실행 로그(기본 최근 5일). */
export async function listRunLogs(sourceId: string, days = 5): Promise<ScraperRunLogRow[]> {
  const db = await getDb();
  const floor = new Date(Date.now() - Math.min(Math.max(1, days), 90) * 86400 * 1000).toISOString();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT run_id, source_id, source_slug, endpoint_id, endpoint_name, trigger, status,
              scanned, inserted, updated, error, started_at, finished_at
         FROM scraper_run_logs
        WHERE source_id = $1 AND started_at >= $2
        ORDER BY started_at DESC
        LIMIT 200`,
      [sourceId, floor]
    )
  );
  return rows.map((r) => ({
    runId: String(r.run_id),
    sourceId: String(r.source_id),
    sourceSlug: String(r.source_slug),
    endpointId: r.endpoint_id != null ? String(r.endpoint_id) : null,
    endpointName: r.endpoint_name != null ? String(r.endpoint_name) : null,
    trigger: String(r.trigger) as RunTrigger,
    status: String(r.status) === "error" ? "error" : "success",
    scanned: Number(r.scanned ?? 0),
    inserted: Number(r.inserted ?? 0),
    updated: Number(r.updated ?? 0),
    error: r.error != null ? String(r.error) : null,
    startedAt: String(r.started_at ?? ""),
    finishedAt: String(r.finished_at ?? ""),
  }));
}
