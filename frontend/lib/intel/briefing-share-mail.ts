import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { assertBriefingAccess } from "./briefing-store";
import { getBriefing } from "./rag-queries";

export interface MailBriefingLink { briefingId: string; title: string; href: string }

/** 본문·제목·ID 접두어를 신뢰하지 않고 실제 완료된 공유 전달과 메일 소유자를 대조한다. */
export async function getVerifiedMailBriefingLink(db: PgDatabase, messageId: string, mailboxId: string, userId: string): Promise<MailBriefingLink | null> {
  // 323 적용 전의 일반 메일 조회는 그대로 유지한다.
  const schema = rowsToObjects(await db.exec("SELECT to_regclass('public.intel_briefing_share_deliveries') AS deliveries,to_regclass('public.intel_briefing_share_requests') AS requests"))[0];
  if (!schema?.deliveries || !schema.requests) return null;
  const row = rowsToObjects(await db.exec(`SELECT b.briefing_id
    FROM mail_messages m JOIN mailboxes mb ON mb.mailbox_id=m.mailbox_id
    JOIN intel_briefing_share_deliveries d ON d.provider_id=m.message_id AND d.channel='inbox' AND d.status='sent' AND d.recipient_user_id=mb.user_id
    JOIN intel_briefing_share_requests r ON r.request_id=d.request_id
    JOIN intel_rag_briefings b ON b.briefing_id=r.briefing_id
    WHERE m.message_id=$1 AND m.mailbox_id=$2 AND mb.user_id=$3 LIMIT 1`, [messageId, mailboxId, userId]))[0];
  if (!row) return null;
  const briefingId = String(row.briefing_id);
  try {
    await assertBriefingAccess(briefingId, userId);
    // legacy 공식 자료도 현재 이용 권리가 있어야 링크 제목을 제공한다.
    const briefing = await getBriefing(briefingId);
    if (!briefing || briefing.status !== "done") return null;
    return { briefingId, title: briefing.question.slice(0, 180), href: `/sales/rag?briefingId=${encodeURIComponent(briefingId)}` };
  } catch (error) {
    if ([403, 404, 409].includes(Number((error as { status?: number }).status))) return null;
    throw error;
  }
}
