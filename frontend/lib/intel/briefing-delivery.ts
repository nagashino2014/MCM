import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { sendNotifyEmail } from "@/lib/notify/email-ses";
import { sendPush } from "@/lib/notify/push-expo";
import { ensureMailbox, getSystemFolderId } from "@/lib/mail/mailbox";
import { assertBriefingAccess, briefingAudit, briefingId, getBriefingProfile, getBriefingRun, json } from "./briefing-store";
import type { BriefingDelivery } from "./briefing-types";
import { applyImportantDeliveryPolicy, assertImportantRecipient, prepareImportantDigest, type NotificationPayload } from "./briefing-notification-policy";

export async function listBriefingDeliveries(runId: string, userId: string): Promise<BriefingDelivery[]> {
  const run = await getBriefingRun(runId, userId); const profile = await getBriefingProfile(run.profileId, userId);
  const db = await getDb();
  return rowsToObjects(await db.exec("SELECT d.* FROM intel_notification_outbox d JOIN intel_briefing_runs r ON r.briefing_id=d.briefing_id WHERE r.run_id=$1 AND ($2::boolean OR d.user_id=$3) ORDER BY d.created_at", [runId, profile.canManage, userId])).map(r => ({ deliveryId: String(r.delivery_id), userId: String(r.user_id), channel: String(r.channel) as BriefingDelivery["channel"], status: String(r.status) as BriefingDelivery["status"], attempt: Number(r.attempt), error: r.error ? String(r.error) : null, providerId: r.provider_id ? String(r.provider_id) : null }));
}
export async function dispatchBriefingDeliveries(limit = 50, now = new Date()): Promise<{ sent: number; failed: number; skipped: number }> {
  const result = { sent: 0, failed: 0, skipped: 0 };
  const db = await getDb();
  // sending 중 프로세스가 종료되면 실제 발송 여부를 알 수 없다. 자동 재전송하지 않는다.
  await db.run("UPDATE intel_notification_outbox SET status=CASE WHEN channel='inbox' THEN 'pending' ELSE 'unknown' END,error='발송 중 실행자가 종료되었습니다. 채널 로그를 확인하세요.',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE status='sending' AND lease_until<now()");
  await db.run("UPDATE intel_notification_outbox member SET status='unknown',error='묶음 알림 발송 결과를 확인해야 합니다.',updated_at=now() FROM intel_notification_outbox parent WHERE member.digest_delivery_id=parent.delivery_id AND member.status='pending' AND parent.status='unknown'");
  for (let i = 0; i < Math.min(limit, 200); i++) {
    const token = briefingId("delivery_lease");
    const row = await withDbWrite(async tx => rowsToObjects(await tx.exec(`WITH c AS(SELECT delivery_id FROM intel_notification_outbox WHERE digest_delivery_id IS NULL AND status IN('pending','failed') AND next_attempt_at<=now() AND attempt<retry_limit ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE intel_notification_outbox d SET status='sending',attempt=attempt+1,lease_token=$1,lease_until=now()+interval '5 minutes',updated_at=now() FROM c WHERE d.delivery_id=c.delivery_id RETURNING d.*`, [token]))[0]);
    if (!row) break;
    const did = String(row.delivery_id), uid = String(row.user_id), attempt = Number(row.attempt);
    let status: BriefingDelivery["status"] = "failed", error: string | null = null, providerId: string | null = null;
    let inbox: { mailboxId: string; folderId: string; address: string } | null = null;
    let payload = json<NotificationPayload>(row.payload);
    let retryAt = "9999-12-31T00:00:00Z";
    try {
      if (row.kind === "important") {
        if (!(await applyImportantDeliveryPolicy(row,token,now))) continue;
        payload = payload.digest ? await prepareImportantDigest(did) : await assertImportantRecipient(row);
      } else {
        const p = await getBriefingProfile(String(row.profile_id), uid);
        if (row.briefing_id) await assertBriefingAccess(String(row.briefing_id), uid);
        const rcpt = p.recipients.find(r => r.userId === uid);
        if (!rcpt?.channels.includes(String(row.channel) as "email")) throw Object.assign(new Error("수신자 또는 채널이 해제되었습니다."),{status:403});
      }
        if (row.channel === "inbox") { const mailbox = await ensureMailbox(uid); if (mailbox.status !== "active") throw new Error("사내 메일함이 비활성 상태입니다."); inbox = { mailboxId: mailbox.mailboxId, folderId: await getSystemFolderId(mailbox.mailboxId, "inbox"), address: mailbox.address }; status = "sent"; }
        else {
          const users = rowsToObjects(await db.exec("SELECT email FROM users WHERE user_id=$1 AND status='active'", [uid]));
          if (!users.length) { status = "skipped"; error = "비활성 사용자"; }
          else if (row.channel === "email") {
            const base = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
            if (!/^https?:\/\//.test(base)) { status = "failed"; error = "보고서 링크의 서비스 주소가 설정되지 않았습니다."; }
            else {
              const sent = await sendNotifyEmail({ to: [String(users[0].email ?? "")], subject: `[영업 브리핑] ${payload.title}`, text: `${payload.text}\n\n보고서 확인: ${base}${payload.link}` });
              status = sent.ok ? "sent" : sent.skipped ? "skipped" : /timeout|ECONN|socket/i.test(sent.error ?? "") ? "unknown" : "failed";
              error = sent.error ?? sent.skipped ?? null; providerId = sent.providerId ?? null;
            }
          } else {
            const sent = await sendPush([uid], { event: row.kind === "important" ? "intel.important" : "intel.briefing", title: payload.title, body: payload.text.slice(0, 180), link: payload.link, targetRef: String(row.briefing_id ?? row.event_id), dedupKey: `${did}:attempt:${attempt}` });
            status = sent.ok ? "sent" : sent.skipped ? "skipped" : /timeout|ECONN|socket/i.test(sent.error ?? "") ? "unknown" : "failed";
            error = sent.error ?? sent.skipped ?? null;
          }
          if (status === "failed" && error && /throttl|429|503|temporar/i.test(error) && attempt < Number(row.retry_limit)) retryAt = new Date(Date.now() + attempt * 60000).toISOString();
        }
    } catch (e) { error = e instanceof Error ? e.message : String(e); status = (e as { status?: number }).status === 403 || (e as { status?: number }).status === 404 ? "skipped" : "failed"; }
    await withDbWrite(async tx => {
      const changed = rowsToObjects(await tx.exec("UPDATE intel_notification_outbox SET status=$3,error=$4,provider_id=$5,next_attempt_at=$6,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE delivery_id=$1 AND lease_token=$2 RETURNING delivery_id", [did, token, status, error, providerId, retryAt]));
      if (changed.length && inbox && status === "sent") {
        const mid = `intelmail_${did}`; const now = new Date().toISOString();
        const body = `${payload.text}\n\n보고서 확인: ${payload.link}`;
        await tx.run(`INSERT INTO mail_messages(message_id,mailbox_id,direction,rfc_message_id,thread_id,from_addr,to_addrs,subject,snippet,body_text,received_at,created_at) VALUES($1,$2,'in',$3,$3,$4,$5::jsonb,$6,$7,$8,$9,$9) ON CONFLICT(mailbox_id,rfc_message_id) DO NOTHING`, [mid,inbox.mailboxId,`<${did}@internal.mcm>`,process.env.BID_NOTIFY_EMAIL_FROM ?? null,JSON.stringify([{address:inbox.address}]),`[영업 브리핑] ${payload.title}`,payload.text.slice(0,200),body,now]);
        await tx.run("INSERT INTO mail_message_state(message_id,folder_id,mailbox_id,is_read,created_at) VALUES($1,$2,$3,0,$4) ON CONFLICT(message_id,folder_id) DO NOTHING", [mid,inbox.folderId,inbox.mailboxId,now]);
      }
      if (changed.length && payload.digest && ["sent","unknown","skipped"].includes(status)) await tx.run("UPDATE intel_notification_outbox SET status=$2,error=$3,provider_id=$4,updated_at=now() WHERE digest_delivery_id=$1 AND status='pending'",[did,status,error,providerId]);
      if (changed.length) await tx.run("INSERT INTO intel_notification_attempts(attempt_id,delivery_id,attempt,status,result) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(delivery_id,attempt) DO NOTHING", [briefingId("iba"), did, attempt, status, JSON.stringify({ error, providerId })]);
    });
    if (status === "sent") result.sent++; else if (status === "skipped") result.skipped++; else result.failed++;
  }
  return result;
}
/** 명시적 재전송만 unknown을 다시 pending으로 바꾼다. 성공 채널은 변경하지 않는다. */
export async function retryBriefingRun(runId: string, userId: string, resendUnknown = false): Promise<void> {
  const run = await getBriefingRun(runId, userId); await getBriefingProfile(run.profileId, userId, true);
  await withDbWrite(async db => {
    if (run.briefingId) await db.run(`UPDATE intel_notification_outbox SET status='pending',retry_limit=attempt+3,next_attempt_at=now(),error=NULL WHERE briefing_id=$1 AND status IN('failed'${resendUnknown ? ",'unknown'" : ""})`, [run.briefingId]);
    else await db.run("UPDATE intel_briefing_runs SET status='queued',attempt=0,next_attempt_at=now(),error=NULL WHERE run_id=$1 AND status IN('failed','blocked_budget','canceled')", [runId]);
    await briefingAudit(db, "run.retry", userId, run.profileId, runId, { resendUnknown });
  });
  const { refreshBriefingWakeup } = await import("./briefing-scheduler"); await refreshBriefingWakeup();
}
