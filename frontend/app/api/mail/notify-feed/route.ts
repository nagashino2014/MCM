import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ISO 시각 문자열(toISOString 형식)만 받는다 — 문자열 비교로 쓰므로 형식이 다르면 무시. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * 새 메일 PC 알림 피드(직원 개선 요청 11) — since 이후 받은편지함에 **들어온**(mail_message_state.created_at, 서버 시계)
 * 안읽은 메일 최대 5통 + 총 건수 + 서버 현재 시각.
 * 클라이언트는 네비 뱃지(mailArrivedAt)가 기준선보다 커졌을 때만 부른다(lib/mail/desktop-notify.ts).
 * - 메일 가져오기(281)·보관함→받은편지함 이동은 들어온 시각이 새로워도 메일 자체 날짜가 오래됐으므로
 *   메일 날짜(m.created_at)가 기준선 하루 전보다 이른 것은 뺀다(옛 메일 수천 통 알림 방지).
 * since 가 없으면 serverNow 만 돌려준다(켜기 시 기준선 잡기).
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const serverNow = new Date().toISOString();
    const since = String(req.nextUrl.searchParams.get("since") ?? "");
    if (!ISO_RE.test(since)) return NextResponse.json({ serverNow, total: 0, items: [] });
    const floor = new Date(Date.parse(since) - 24 * 60 * 60 * 1000).toISOString();
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT m.message_id, m.subject, m.from_addr, s.created_at AS arrived_at,
                sb.display_name AS from_name, COUNT(*) OVER ()::int AS total
           FROM mail_message_state s
           JOIN mail_folders f ON f.folder_id = s.folder_id
           JOIN mailboxes mb ON mb.mailbox_id = s.mailbox_id
           JOIN mail_messages m ON m.message_id = s.message_id
           LEFT JOIN mailboxes sb ON lower(sb.address) = lower(m.from_addr)
          WHERE mb.user_id = $1 AND f.system_kind = 'inbox' AND s.is_read = 0 AND s.is_deleted = 0
            AND s.created_at > $2 AND m.created_at >= $3
          ORDER BY s.created_at DESC
          LIMIT 5`,
        [ctx.userId, since, floor]
      )
    );
    const items = rows.map((r) => {
      const addr = r.from_addr != null ? String(r.from_addr) : "";
      const name = r.from_name != null ? String(r.from_name).trim() : "";
      return {
        messageId: String(r.message_id),
        subject: r.subject != null ? String(r.subject) : "",
        from: name || addr,
        arrivedAt: String(r.arrived_at),
      };
    });
    return NextResponse.json({ serverNow, total: rows.length ? Number(rows[0].total) : 0, items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
