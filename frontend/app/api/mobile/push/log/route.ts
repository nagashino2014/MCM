import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 내게 발송된 푸시 알림 내역(2026-11-04, 앱 알림 화면). mobile_push_log 에서 발송 성공(ok=1)분만 최신순.
//   GET ?limit=50&offset=0 → { items: [{ pushId, eventKey, title, body, link, createdAt }], total, limit, offset }
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(100, Math.max(1, Number(sp.get("limit") ?? 50) || 50));
    const offset = Math.max(0, Number(sp.get("offset") ?? 0) || 0);
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT push_id, event_key, title, body, link, created_at
           FROM mobile_push_log
          WHERE user_id = $1 AND ok = 1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [ctx.userId, limit, offset]
      )
    );
    const totalRows = rowsToObjects(await db.exec(`SELECT COUNT(*)::int AS n FROM mobile_push_log WHERE user_id = $1 AND ok = 1`, [ctx.userId]));
    return NextResponse.json({
      items: rows.map((r) => ({
        pushId: String(r.push_id),
        eventKey: String(r.event_key),
        title: r.title != null ? String(r.title) : "",
        body: r.body != null ? String(r.body) : "",
        link: r.link != null ? String(r.link) : null,
        createdAt: String(r.created_at),
      })),
      total: Number(totalRows[0]?.n ?? 0),
      limit,
      offset,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
