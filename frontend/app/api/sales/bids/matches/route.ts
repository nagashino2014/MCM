import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 사업분야 매칭 공고 목록(M6-C) — 매칭 알림 큐(bid_match_notices)를 그대로 읽는다.
 *
 * 푸시로 받은 알림을 눌렀을 때 볼 화면의 데이터원이다. 웹의 /api/sales/bids 는
 * 종류별 커스텀 열 계산까지 하는 무거운 목록이라, "알림으로 온 그 건들"만 보는
 * 용도로는 맞지 않는다.
 *
 * ?filter=deadline 이면 마감이 남은 건만(임박순), 기본은 최근 매칭순.
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
    const offset = Math.max(Number(sp.get("offset")) || 0, 0);
    const byDeadline = sp.get("filter") === "deadline";
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

    // 같은 공고가 여러 분류에 매칭될 수 있어 bid 단위로 접는다(최근 매칭 1건 대표).
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT * FROM (
           SELECT DISTINCT ON (bid_type, bid_id)
                  notice_id, bid_type, bid_id, category_name, title, org_name,
                  budget, posted_at, deadline, url, matched_at
             FROM bid_match_notices
            ${byDeadline ? `WHERE deadline IS NOT NULL AND deadline <> '' AND substring(deadline, 1, 10) >= $3` : ""}
            ORDER BY bid_type, bid_id, matched_at DESC
         ) t
         ORDER BY ${byDeadline ? "substring(deadline, 1, 10) ASC" : "matched_at DESC"}
         LIMIT $1 OFFSET $2`,
        byDeadline ? [limit, offset, today] : [limit, offset]
      )
    );

    const items = rows.map((r) => ({
      noticeId: String(r.notice_id),
      bidType: String(r.bid_type),
      bidId: String(r.bid_id),
      categoryName: r.category_name != null ? String(r.category_name) : null,
      title: r.title != null ? String(r.title) : null,
      orgName: r.org_name != null ? String(r.org_name) : null,
      budget: r.budget != null ? Number(r.budget) : null,
      postedAt: r.posted_at != null ? String(r.posted_at) : null,
      deadline: r.deadline != null ? String(r.deadline) : null,
      url: r.url != null ? String(r.url) : null,
      matchedAt: r.matched_at != null ? String(r.matched_at) : null,
    }));
    return NextResponse.json({ items, today });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
