/**
 * 새 메일 모바일 푸시(2026-11-12) — 수신 파이프라인(inbound.ts)이 받은편지함에 새로 적재한 메일만 알린다.
 *
 * 과하게 울리지 않도록 정한 기준:
 * - 받은편지함에 들어간 메일만 — 스팸함으로 간 메일은 알리지 않는다.
 * - 보낸 사람 자동 분류(305)가 붙은 메일은 알리지 않는다 — 사용자가 "따로 모아 볼 메일"로 지정한 발신자다.
 * - 대량·자동 발송 머리글이 있는 메일은 알리지 않는다:
 *   List-Unsubscribe·List-Id(뉴스레터·메일링 리스트), Precedence: bulk|list|junk,
 *   Auto-Submitted ≠ no(부재중 자동 회신 등), 반송 통지(MAILER-DAEMON·postmaster·multipart/report).
 *   ⚠ Feedback-ID 는 SES 가 모든 발송(사내 메일 포함)에 붙이므로 기준으로 쓰지 않는다.
 * - 한 번의 수신 처리에서 같은 사람에게 여러 통이 오면 한 번에 묶어 "새 메일 N통"으로 보낸다.
 * - 같은 사람에게 직전 60초 안에 메일 푸시가 나갔으면 이번 것은 보내지 않는다(배지 숫자는 그대로 오른다).
 * 사용자별 끄기는 앱 알림 설정의 '새 메일'(mail.received)과 방해금지 시간대를 sendPush 가 따른다.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import { sendPush } from "@/lib/notify/push-expo";

/** 같은 사람에게 메일 푸시를 다시 보내기까지의 최소 간격. */
export const MAIL_PUSH_COOLDOWN_MS = 60 * 1000;

export interface InboxMailForPush {
  mailboxId: string;
  messageId: string;
  fromName: string | null;
  fromAddress: string | null;
  subject: string;
}

/** mailparser 의 headers(소문자 키 Map) 중 판정에 쓰는 값만 문자열로 본다. */
function headerText(headers: Map<string, unknown> | undefined, key: string): string {
  const v = headers?.get(key);
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "value" in (v as Record<string, unknown>)) return String((v as { value: unknown }).value ?? "");
  return String(v);
}

/**
 * 푸시를 보내지 않을 사유. 보내도 되면 null.
 * 순수 함수 — scripts/test-mail-push-filter.ts 가 기준을 시험한다.
 */
export function mailPushSkipReason(input: {
  spam: boolean;
  categoryId: string | null;
  headers?: Map<string, unknown>;
  fromAddress: string | null;
  mailboxAddress: string;
}): string | null {
  if (input.spam) return "스팸함";
  if (input.categoryId) return "보낸 사람 자동 분류";
  const h = input.headers;
  // ⚠ mailparser 는 List-* 머리글을 따로 두지 않고 "list" 하나({ unsubscribe, id, … })로 합친다.
  const list = h?.get("list") as Record<string, unknown> | undefined;
  if (list?.unsubscribe || list?.id || h?.has("list-unsubscribe") || h?.has("list-id")) return "메일링 리스트·뉴스레터";
  const precedence = headerText(h, "precedence").trim().toLowerCase();
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") return `Precedence: ${precedence}`;
  const autoSubmitted = headerText(h, "auto-submitted").trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return "자동 발송(Auto-Submitted)";
  const from = (input.fromAddress ?? "").trim().toLowerCase();
  const local = from.split("@")[0] ?? "";
  if (local === "mailer-daemon" || local === "postmaster") return "반송 통지";
  if (headerText(h, "content-type").toLowerCase().startsWith("multipart/report")) return "반송 통지";
  if (from && from === input.mailboxAddress.trim().toLowerCase()) return "내가 나에게 보낸 메일";
  return null;
}

/** 사람별로 묶은 푸시 문구. 순수 함수(시험용). */
export function mailPushMessage(mails: InboxMailForPush[]): { title: string; body: string; link: string; dedupKey: string } {
  const first = mails[0];
  const who = (first.fromName ?? "").trim() || (first.fromAddress ?? "").trim() || "보낸 사람 없음";
  const subject = first.subject.trim() || "(제목 없음)";
  if (mails.length === 1) {
    return {
      title: `새 메일 · ${who}`,
      body: subject,
      link: `/mail?id=${encodeURIComponent(first.messageId)}`,
      dedupKey: `mail:${first.messageId}`,
    };
  }
  return {
    title: `새 메일 ${mails.length}통`,
    body: `${who}: ${subject} 외 ${mails.length - 1}통`,
    link: "/mail",
    dedupKey: `mail:${first.messageId}+${mails.length}`,
  };
}

/** 받은편지함에 새로 들어온 메일들을 사람별로 묶어 푸시한다. 실패해도 예외를 던지지 않는다(수신 처리 보호). */
export async function notifyNewInboxMails(mails: InboxMailForPush[]): Promise<void> {
  if (!mails.length) return;
  try {
    const db = await getDb();
    const owners = rowsToObjects(
      await db.exec(
        `SELECT mailbox_id, user_id FROM mailboxes WHERE mailbox_id = ANY($1::text[]) AND user_id IS NOT NULL`,
        [[...new Set(mails.map((m) => m.mailboxId))]]
      )
    );
    const userOf = new Map(owners.map((r) => [String(r.mailbox_id), String(r.user_id)]));
    const byUser = new Map<string, InboxMailForPush[]>();
    for (const m of mails) {
      const userId = userOf.get(m.mailboxId);
      if (!userId) continue; // 공용·주인 없는 메일함
      byUser.set(userId, [...(byUser.get(userId) ?? []), m]);
    }
    if (!byUser.size) return;

    const since = new Date(Date.now() - MAIL_PUSH_COOLDOWN_MS).toISOString();
    const recent = rowsToObjects(
      await db.exec(
        `SELECT DISTINCT user_id FROM mobile_push_log
          WHERE event_key = 'mail.received' AND ok = 1 AND user_id = ANY($1::text[]) AND created_at > $2`,
        [[...byUser.keys()], since]
      )
    );
    const cooling = new Set(recent.map((r) => String(r.user_id)));

    for (const [userId, list] of byUser) {
      if (cooling.has(userId)) {
        console.info(`[mail-push] ${userId}: 직전 ${MAIL_PUSH_COOLDOWN_MS / 1000}초 안에 보냄 — ${list.length}통 생략`);
        continue;
      }
      const msg = mailPushMessage(list);
      await sendPush([userId], {
        event: "mail.received",
        title: msg.title,
        body: msg.body,
        link: msg.link,
        targetRef: list.length === 1 ? list[0].messageId : null,
        dedupKey: msg.dedupKey,
        appBadge: true,
      });
    }
  } catch (e) {
    console.error("[mail-push] 새 메일 푸시 실패:", e);
  }
}
