/*
 * 보드 진척 일일 스냅샷(297, §29-3 2차) — remind-tick 이 5분마다 호출하지만 KST 날짜당 보드마다 1행만 적재(NOT EXISTS, 한 문장).
 *   avg_pct = 미완 상위 할 일의 하위 진행율 평균(완료 100·미기입 0, 하위 없는 보드는 0), open_n/done_n = 상위 건수. 개인 보드는 제외.
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

export async function snapshotBoardProgress(): Promise<{ snapshots: number }> {
  const today = kstToday();
  let n = 0;
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(
        `INSERT INTO todo_board_progress_snapshots (board_id, snapshot_date, avg_pct, open_n, done_n, created_at)
         SELECT b.board_id, $1,
                COALESCE(ROUND(AVG(CASE WHEN s.status = 'done' THEN 100 ELSE COALESCE(s.progress_pct, 0) END)), 0)::int,
                COUNT(DISTINCT p.item_id) FILTER (WHERE p.status <> 'done')::int,
                COUNT(DISTINCT p.item_id) FILTER (WHERE p.status = 'done')::int,
                $2
           FROM todo_boards b
           LEFT JOIN todo_items p ON p.board_id = b.board_id AND p.parent_item_id IS NULL AND p.archived_at IS NULL
           LEFT JOIN todo_items s ON s.parent_item_id = p.item_id AND s.archived_at IS NULL AND p.status <> 'done'
          WHERE b.kind <> 'personal'
            AND NOT EXISTS (SELECT 1 FROM todo_board_progress_snapshots x WHERE x.board_id = b.board_id AND x.snapshot_date = $1)
          GROUP BY b.board_id
         ON CONFLICT DO NOTHING
         RETURNING board_id`,
        [today, new Date().toISOString()]
      )
    );
    n = rows.length;
  });
  return { snapshots: n };
}

/** 특정 날짜(없으면 그 이전 가장 최근) 스냅샷의 avg_pct — 보드별. */
export async function boardAvgOn(boardIds: string[], date: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!boardIds.length) return out;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT DISTINCT ON (board_id) board_id, avg_pct FROM todo_board_progress_snapshots
        WHERE board_id = ANY($1::text[]) AND snapshot_date <= $2 ORDER BY board_id, snapshot_date DESC`,
      [boardIds, date]
    )
  );
  for (const r of rows) out.set(String(r.board_id), Number(r.avg_pct ?? 0));
  return out;
}
