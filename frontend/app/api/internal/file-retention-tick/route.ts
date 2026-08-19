import { NextRequest, NextResponse } from "next/server";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { loadTickCached, TICK_CACHE_FILE_RETENTION } from "@/lib/tick-cache";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  deleteLibraryFiles,
  getRetentionPolicies,
  listExpiredLibraryFileIds,
  type RetentionPolicies,
} from "@/lib/files/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 파일 저장 정책 자동 삭제 틱 — instrumentation.ts 주기 타이머가 자기호출(6시간).
 * 정책이 전부 '영구'면 no-op(tick-cache 로 DB 조회도 생략 — Aurora auto-pause 보호).
 * 실행은 KST 일 1회 멱등: file_retention_runs 의 마지막 실행일로 판정한다.
 * 1회 상한 1,000건 — 초과분은 다음 날 이어서 삭제된다(점진 소진).
 */
const BATCH_LIMIT = 1000;

function kstDate(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    // 사전 판정(캐시) — 전 구간 permanent 면 할 일 없음.
    const cached = await loadTickCached<RetentionPolicies>(TICK_CACHE_FILE_RETENTION, getRetentionPolicies);
    if (Object.values(cached).every((v) => v === "permanent")) {
      return NextResponse.json({ ok: true, skipped: "all-permanent" });
    }

    // 일 1회 멱등 — 오늘(KST) 이미 실행했으면 종료.
    const db = await getDb();
    const last = rowsToObjects(
      await db.exec(`SELECT ran_at FROM file_retention_runs ORDER BY run_id DESC LIMIT 1`)
    );
    if (last.length && kstDate(String(last[0].ran_at)) === kstDate()) {
      return NextResponse.json({ ok: true, skipped: "already-ran-today" });
    }

    // 실제 작업은 항상 DB 최신 정책으로.
    const policies = await getRetentionPolicies();
    const ids = await listExpiredLibraryFileIds(policies, BATCH_LIMIT);
    let deleted = 0;
    let failed = 0;
    if (ids.length) {
      const result = await deleteLibraryFiles(ids);
      deleted = result.deleted;
      failed = result.failed.length;
    }
    await withDbWrite(async (tx) => {
      await tx.run(`INSERT INTO file_retention_runs (ran_at, deleted_count, detail) VALUES ($1, $2, $3::jsonb)`, [
        new Date().toISOString(),
        deleted,
        JSON.stringify({ policies, candidates: ids.length, failed, truncated: ids.length >= BATCH_LIMIT }),
      ]);
    });
    if (deleted > 0) {
      await recordAuditLog({
        actorUserId: "system",
        action: "file_retention_purge",
        targetTable: "file_library",
        targetId: "retention-batch",
        after: { deleted, failed, policies },
      });
    }
    return NextResponse.json({ ok: true, deleted, failed });
  } catch (err) {
    console.error("[file-retention] tick error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
