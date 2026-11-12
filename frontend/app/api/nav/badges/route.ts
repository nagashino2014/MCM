import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { countDueBadge } from "@/lib/todo/store";
import { isPcWidgetActive } from "@/lib/notify/pc-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 사이드바 카운트 뱃지(G1) — 안읽은 메일 + 내 미결재 건수.
 * 60초 폴링 전제의 가벼운 집계 쿼리 2개. 실패해도 0 으로 응답(네비가 죽지 않게).
 */
export async function GET() {
  try {
    const ctx = await requireSession();
    const db = await getDb();
    let mailUnread = 0;
    // PC 알림 변화 신호(서버 시계, lib/notify/pc-notify-client.ts) — 메일=안읽음 중 가장 늦게 들어온 시각,
    // 결재=내 차례가 된 시각·내 문서 완료/반려 시각 중 최신, 메신저=안읽은 받은 메시지 중 최신.
    let mailArrivedAt: string | null = null;
    let approvalArrivedAt: string | null = null;
    let chatArrivedAt: string | null = null;
    let approvalPending = 0;
    let chatUnread = 0;
    try {
      const mailRows = rowsToObjects(
        await db.exec(
          `SELECT COUNT(*)::int AS n, MAX(s.created_at) AS arrived
             FROM mail_message_state s
             JOIN mail_folders f ON f.folder_id = s.folder_id
             JOIN mailboxes mb ON mb.mailbox_id = s.mailbox_id
            WHERE mb.user_id = $1 AND f.system_kind = 'inbox' AND s.is_read = 0 AND s.is_deleted = 0`,
          [ctx.userId]
        )
      );
      mailUnread = mailRows.length ? Number(mailRows[0].n) : 0;
      mailArrivedAt = mailRows.length && mailRows[0].arrived != null ? String(mailRows[0].arrived) : null;
    } catch {
      /* mail 테이블 미존재 등 — 0 유지 */
    }
    try {
      const apRows = rowsToObjects(
        await db.exec(
          `SELECT COUNT(*)::int AS n, MAX(s.activated_at) AS arrived,
                  (SELECT MAX(completed_at) FROM approval_docs
                    WHERE drafter_user_id = $1 AND status IN ('approved', 'rejected')) AS done_at
             FROM approval_steps s JOIN approval_docs d ON d.doc_id = s.doc_id
            WHERE s.assignee_user_id = $1 AND s.status = 'pending' AND d.status = 'in_progress'`,
          [ctx.userId]
        )
      );
      approvalPending = apRows.length ? Number(apRows[0].n) : 0;
      const a = apRows.length && apRows[0].arrived != null ? String(apRows[0].arrived) : "";
      const b = apRows.length && apRows[0].done_at != null ? String(apRows[0].done_at) : "";
      approvalArrivedAt = (a > b ? a : b) || null;
    } catch {
      /* 0 유지 */
    }
    try {
      const chatRows = rowsToObjects(
        await db.exec(
          `SELECT COUNT(*)::int AS n, MAX(cm.created_at) AS arrived
             FROM chat_messages cm
             JOIN chat_room_members m ON m.room_id = cm.room_id
            WHERE m.user_id = $1 AND m.left_at IS NULL
              AND cm.message_id > m.last_read_message_id
              AND cm.sender_id <> $1 AND cm.deleted_at IS NULL`,
          [ctx.userId]
        )
      );
      chatUnread = chatRows.length ? Number(chatRows[0].n) : 0;
      chatArrivedAt = chatRows.length && chatRows[0].arrived != null ? String(chatRows[0].arrived) : null;
    } catch {
      /* chat 테이블 미존재 등 — 0 유지 */
    }
    // 할 일(274) — 오늘+지연, 내 담당, 미완료. 표 미생성이면 0 유지.
    let todoDue = 0;
    try {
      todoDue = await countDueBadge(ctx.userId);
    } catch {
      /* todo 테이블 미존재 등 — 0 유지 */
    }
    // 메뉴 노출 판정은 세션의 권한 요약(session.user.perms)이 담당한다(role 일원화 WP5) — 여기서는 뱃지만 내린다.
    return NextResponse.json({
      mailUnread,
      mailArrivedAt,
      approvalArrivedAt,
      chatArrivedAt,
      pcWidgetActive: isPcWidgetActive(ctx.userId),
      approvalPending,
      chatUnread,
      todoDue,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
