import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

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
    let approvalPending = 0;
    let chatUnread = 0;
    try {
      const mailRows = rowsToObjects(
        await db.exec(
          `SELECT COUNT(*)::int AS n
             FROM mail_message_state s
             JOIN mail_folders f ON f.folder_id = s.folder_id
             JOIN mailboxes mb ON mb.mailbox_id = s.mailbox_id
            WHERE mb.user_id = $1 AND f.system_kind = 'inbox' AND s.is_read = 0 AND s.is_deleted = 0`,
          [ctx.userId]
        )
      );
      mailUnread = mailRows.length ? Number(mailRows[0].n) : 0;
    } catch {
      /* mail 테이블 미존재 등 — 0 유지 */
    }
    try {
      const apRows = rowsToObjects(
        await db.exec(
          `SELECT COUNT(*)::int AS n
             FROM approval_steps s JOIN approval_docs d ON d.doc_id = s.doc_id
            WHERE s.assignee_user_id = $1 AND s.status = 'pending' AND d.status = 'in_progress'`,
          [ctx.userId]
        )
      );
      approvalPending = apRows.length ? Number(apRows[0].n) : 0;
    } catch {
      /* 0 유지 */
    }
    try {
      const chatRows = rowsToObjects(
        await db.exec(
          `SELECT COUNT(*)::int AS n
             FROM chat_messages cm
             JOIN chat_room_members m ON m.room_id = cm.room_id
            WHERE m.user_id = $1 AND m.left_at IS NULL
              AND cm.message_id > m.last_read_message_id
              AND cm.sender_id <> $1 AND cm.deleted_at IS NULL`,
          [ctx.userId]
        )
      );
      chatUnread = chatRows.length ? Number(chatRows[0].n) : 0;
    } catch {
      /* chat 테이블 미존재 등 — 0 유지 */
    }
    return NextResponse.json({ mailUnread, approvalPending, chatUnread });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
