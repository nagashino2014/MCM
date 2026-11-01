import { createHash, randomUUID } from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { ensureMailbox, getSystemFolderId } from "@/lib/mail/mailbox";
import { postDirectSharedRecordInTransaction, type ChatSharedRecord } from "@/lib/chat/queries";
import { sendPush } from "@/lib/notify/push-expo";
import { assertBriefingCapability, assertBriefingDocumentOwner } from "./briefing-access";
import { assertBriefingAccess } from "./briefing-store";
import { getBriefing } from "./rag-queries";
import type { OrganizationSnapshot } from "@/components/admin/users/types";
import type { BriefingShareChannel, BriefingShareDelivery, BriefingShareInput, BriefingShareResult, BriefingShareStatus } from "./briefing-share-types";

type Row = Record<string, unknown>;
export interface BriefingShareOptions { pushSender?: typeof sendPush; blockExternalPush?: boolean }
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const uid = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "")}`;
const str = (value: unknown) => value == null ? null : String(value);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const channelOrder: BriefingShareChannel[] = ["shared", "inbox", "push", "messenger"];
function normalized(input: BriefingShareInput) {
  if (!input || typeof input !== "object") throw fail("공유 설정을 확인하세요.");
  const requestKey = typeof input.requestKey === "string" ? input.requestKey.trim() : "";
  if (!requestKey || requestKey.length > 160) throw fail("공유 요청 키가 필요합니다.");
  if (!Array.isArray(input.recipients) || !input.recipients.length || input.recipients.length > 100) throw fail("공유 대상은 1~100명까지 선택하세요.");
  const recipients = [...new Set(input.recipients.map(item => typeof item?.userId === "string" ? item.userId.trim() : ""))].sort();
  if (recipients.some(id => !id || id.length > 160)) throw fail("공유 대상 계정을 확인하세요.");
  const selected = input.channels ?? [];
  if (!Array.isArray(selected) || selected.some(channel => !channelOrder.includes(channel))) throw fail("지원하지 않는 공유 채널입니다.");
  const channels = channelOrder.filter(channel => channel === "shared" || selected.includes(channel));
  return { requestKey, recipients, channels };
}
function mapDelivery(row: Row): BriefingShareDelivery {
  const room = /^chat:(\d+):\d+$/.exec(String(row.provider_id ?? ""));
  return { deliveryId: String(row.delivery_id), userId: String(row.recipient_user_id), channel: row.channel as BriefingShareChannel, status: row.status as BriefingShareStatus, attempt: Number(row.attempt), error: str(row.error), providerId: str(row.provider_id), roomId: row.channel === "messenger" && room ? Number(room[1]) : null };
}
async function checkOwner(briefingId: string, actorId: string) {
  await assertBriefingDocumentOwner(briefingId, actorId, "share");
  await assertBriefingAccess(briefingId, actorId);
  // legacy 문서의 공식 자료 권리도 ACL을 부여하기 전에 확인한다.
  const briefing = await getBriefing(briefingId);
  if (!briefing) throw fail("브리핑을 찾을 수 없습니다.", 404);
  if (briefing.status !== "done") throw fail("작성이 완료된 브리핑만 공유할 수 있습니다.", 409);
}

/** 수신자 조직도: 인사 상세정보 없이 활성 + 브리핑 열람권한이 있는 계정만 내린다. */
export async function listBriefingShareRecipients(briefingId: string, actorId: string): Promise<OrganizationSnapshot> {
  await checkOwner(briefingId, actorId);
  const db = await getDb();
  const [departmentResult, positionResult, employeeResult] = await Promise.all([
    db.exec("SELECT to_jsonb(d) AS value FROM departments d ORDER BY dept_name"),
    db.exec("SELECT to_jsonb(p) AS value FROM positions p ORDER BY rank_order DESC"),
    db.exec(`SELECT e.employee_id,e.name,e.dept_id,to_jsonb(e)->>'position_id' AS position_id,
      to_jsonb(e)->>'photo_public_path' AS photo_path,u.user_id,u.email
      FROM employee_profiles e JOIN users u ON u.employee_id=e.employee_id
      WHERE u.status='active' AND COALESCE(to_jsonb(e)->>'status','active')='active' ORDER BY e.name`),
  ]);
  const employeeRows: Row[] = [];
  for (const row of rowsToObjects(employeeResult)) {
    try { await assertBriefingCapability(String(row.user_id), "view"); employeeRows.push(row); }
    catch (error) { if (![403, 404].includes(Number((error as { status?: number }).status))) throw error; }
  }
  const departments = rowsToObjects(departmentResult).map(row => row.value as Row);
  const positions = rowsToObjects(positionResult).map(row => row.value as Row);
  const departmentMap = new Map(departments.map(department => [String(department.dept_id), department]));
  const keep = new Set<string>();
  for (const row of employeeRows) {
    let id = str(row.dept_id);
    while (id && !keep.has(id)) { keep.add(id); id = str(departmentMap.get(id)?.parent_dept_id); }
  }
  return {
    departments: departments.filter(row => keep.has(String(row.dept_id))).map(row => ({ deptId: String(row.dept_id), deptName: String(row.dept_name), deptKind: String(row.dept_kind ?? "division"), parentDeptId: str(row.parent_dept_id), displayOrder: Number(row.display_order ?? 100), accentColor: str(row.accent_color), isActive: row.is_active !== false && row.is_active !== 0 })),
    positions: positions.map(row => ({ positionId: String(row.position_id), positionName: String(row.position_name), rankOrder: Number(row.rank_order ?? 0), isActive: row.is_active !== false && row.is_active !== 0 })),
    departmentPositions: [], deptHeads: [],
    employees: employeeRows.map(row => { const position = positions.find(item => item.position_id === row.position_id); return { employeeId: String(row.employee_id), userId: String(row.user_id), employeeNo: null, name: String(row.name), deptId: str(row.dept_id), positionId: str(row.position_id), positionName: str(position?.position_name), positionRankOrder: position ? Number(position.rank_order) : null, email: str(row.email), status: "active", hiredAt: null, gender: null, hasBirthDate: false, photoPath: str(row.photo_path) }; }),
  };
}

export async function getBriefingShareResult(briefingId: string, actorId: string, requestId: string): Promise<BriefingShareResult> {
  await checkOwner(briefingId, actorId);
  const db = await getDb();
  const request = rowsToObjects(await db.exec("SELECT * FROM intel_briefing_share_requests WHERE request_id=$1 AND briefing_id=$2 AND actor_user_id=$3", [requestId, briefingId, actorId]))[0];
  if (!request) throw fail("공유 이력을 찾을 수 없습니다.", 404);
  await recoverExpiredShareClaims(db, requestId);
  const deliveries = rowsToObjects(await db.exec("SELECT * FROM intel_briefing_share_deliveries WHERE request_id=$1 ORDER BY recipient_user_id,created_at,channel", [requestId])).map(mapDelivery);
  const summary = { sent: 0, failed: 0, skipped: 0, unknown: 0, pending: 0 };
  for (const delivery of deliveries) summary[delivery.status === "sending" ? "pending" : delivery.status]++;
  return { ok: summary.failed === 0 && summary.unknown === 0 && summary.pending === 0 && summary.skipped === 0, shared: deliveries.filter(delivery => delivery.channel === "shared" && delivery.status === "sent").length, requestId, requestKey: String(request.request_key), deliveries, summary };
}

/** 상태 조회만으로도 중단된 전송을 확정 상태로 바꾼다. GET에서 실제 재전송은 하지 않는다. */
async function recoverExpiredShareClaims(db: PgDatabase, requestId: string) {
  await db.run(`UPDATE intel_briefing_share_deliveries SET status=CASE WHEN channel='push' THEN 'unknown' ELSE 'failed' END,
    error=CASE WHEN channel='push' THEN '전달 중 실행이 종료되어 푸시 도착 여부를 확인해야 합니다. 자동 재전송하지 않습니다.' ELSE '전달 중 실행이 종료되었습니다. 실패 전송 재시도로 안전하게 다시 확인할 수 있습니다.' END,
    lease_token=NULL,lease_until=NULL,updated_at=now() WHERE request_id=$1 AND status='sending' AND lease_until<now()`, [requestId]);
}

/** ACL 등록은 항상 먼저 원자 저장한다. 같은 요청 키의 성공 채널은 이후 호출에서 다시 보내지 않는다. */
export async function shareBriefingWithChannels(briefingId: string, actorId: string, input: BriefingShareInput, options: BriefingShareOptions = {}): Promise<BriefingShareResult> {
  const value = normalized(input);
  await checkOwner(briefingId, actorId);
  for (const recipient of value.recipients) await assertBriefingCapability(recipient, "view");
  const payloadHash = createHash("sha256").update(JSON.stringify({ briefingId, recipients: value.recipients, channels: value.channels })).digest("hex");
  const requestId = await withDbWrite(async db => {
    await db.run("SELECT pg_advisory_xact_lock(hashtext($1))", [`briefing-share:${actorId}:${value.requestKey}`]);
    const prior = rowsToObjects(await db.exec("SELECT * FROM intel_briefing_share_requests WHERE actor_user_id=$1 AND request_key=$2", [actorId, value.requestKey]))[0];
    if (prior) {
      if (prior.payload_hash !== payloadHash) throw fail("같은 공유 요청 키의 수신자 또는 채널이 변경되었습니다. 새 공유로 시작하세요.", 409);
      return String(prior.request_id);
    }
    const id = uid("ibshare");
    await db.run("INSERT INTO intel_briefing_share_requests(request_id,briefing_id,actor_user_id,request_key,payload_hash) VALUES($1,$2,$3,$4,$5)", [id, briefingId, actorId, value.requestKey, payloadHash]);
    for (const recipient of value.recipients) {
      await db.run(`INSERT INTO intel_rag_briefing_shares(share_id,briefing_id,recipient_user_id,shared_by,created_at,explicit_share) VALUES($1,$2,$3,$4,$5,true)
        ON CONFLICT(briefing_id,recipient_user_id) DO UPDATE SET shared_by=EXCLUDED.shared_by,created_at=EXCLUDED.created_at,read_at=NULL,explicit_share=true`, [uid("irsh"), briefingId, recipient, actorId, new Date().toISOString()]);
      for (const channel of value.channels) await db.run("INSERT INTO intel_briefing_share_deliveries(delivery_id,request_id,recipient_user_id,channel,status) VALUES($1,$2,$3,$4,$5)", [uid("ibsdel"), id, recipient, channel, channel === "shared" ? "sent" : "pending"]);
    }
    return id;
  });
  await dispatchBriefingShare(requestId, actorId, options);
  return getBriefingShareResult(briefingId, actorId, requestId);
}

async function finish(db: PgDatabase, deliveryId: string, token: string, status: BriefingShareStatus, error: string | null, providerId: string | null) {
  await db.run("UPDATE intel_briefing_share_deliveries SET status=$3,error=$4,provider_id=$5,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE delivery_id=$1 AND lease_token=$2", [deliveryId, token, status, error, providerId]);
}
async function dispatchBriefingShare(requestId: string, actorId: string, options: BriefingShareOptions) {
  const db = await getDb();
  const request = rowsToObjects(await db.exec("SELECT * FROM intel_briefing_share_requests WHERE request_id=$1 AND actor_user_id=$2", [requestId, actorId]))[0];
  if (!request) throw fail("공유 요청을 찾을 수 없습니다.", 404);
  const briefingId = String(request.briefing_id);
  await checkOwner(briefingId, actorId);
  const briefing = await getBriefing(briefingId);
  if (!briefing) throw fail("브리핑을 찾을 수 없습니다.", 404);
  const title = briefing.question.slice(0, 180);
  const href = `/sales/rag?briefingId=${encodeURIComponent(briefingId)}`;
  const record: ChatSharedRecord = { type: "intel_briefing", id: briefingId, title, href };
  // 프로세스 중단으로 전송 결과를 모르는 외부 푸시는 자동 재발송하지 않는다.
  await recoverExpiredShareClaims(db, requestId);
  const candidates = rowsToObjects(await db.exec("SELECT delivery_id FROM intel_briefing_share_deliveries WHERE request_id=$1 AND status IN('pending','failed') ORDER BY created_at,channel", [requestId]));
  for (const candidate of candidates) {
    const token = uid("ibslease");
    const claimed = await withDbWrite(async tx => rowsToObjects(await tx.exec(`UPDATE intel_briefing_share_deliveries SET status='sending',attempt=attempt+1,error=NULL,lease_token=$2,lease_until=now()+interval '5 minutes',updated_at=now()
      WHERE delivery_id=$1 AND status IN('pending','failed') RETURNING *`, [candidate.delivery_id, token]))[0]);
    if (!claimed) continue;
    const deliveryId = String(claimed.delivery_id), recipientId = String(claimed.recipient_user_id);
    let externalAttempted = false;
    try {
      await checkOwner(briefingId, actorId);
      await assertBriefingCapability(recipientId, "view");
      await assertBriefingAccess(briefingId, recipientId);
      if (claimed.channel === "push") {
        if (options.blockExternalPush) {
          await withDbWrite(tx => finish(tx, deliveryId, token, "skipped", "실제 모바일 푸시는 로컬 실증에서 발송하지 않습니다.", null));
          continue;
        }
        externalAttempted = true;
        const result = await (options.pushSender ?? sendPush)([recipientId], { event: "intel.briefing", title: "AI 브리핑이 공유되었습니다", body: title, link: href, targetRef: briefingId, dedupKey: `${deliveryId}:attempt:${claimed.attempt}` });
        const status: BriefingShareStatus = result.ok ? "sent" : result.skipped ? "skipped" : !result.error || /timeout|ECONN|socket|network/i.test(result.error) ? "unknown" : "failed";
        await withDbWrite(tx => finish(tx, deliveryId, token, status, result.error ?? result.skipped ?? (status === "unknown" ? "푸시 전송 결과를 확인하지 못했습니다. 자동 재전송하지 않습니다." : null), result.providerId ?? null));
        continue;
      }
      let inbox: { mailboxId: string; address: string; folderId: string } | undefined;
      if (claimed.channel === "inbox") {
        const mailbox = await ensureMailbox(recipientId);
        if (mailbox.status !== "active") throw fail("사내 메일함이 비활성 상태입니다.", 409);
        inbox = { mailboxId: mailbox.mailboxId, address: mailbox.address, folderId: await getSystemFolderId(mailbox.mailboxId, "inbox") };
      }
      await withDbWrite(async tx => {
        const lease = rowsToObjects(await tx.exec("SELECT delivery_id FROM intel_briefing_share_deliveries WHERE delivery_id=$1 AND lease_token=$2 FOR UPDATE", [deliveryId, token]));
        if (!lease.length) return;
        let providerId: string | null = null;
        if (inbox) {
          const messageId = `briefingshare_${deliveryId}`, now = new Date().toISOString();
          let base: URL;
          try { base = new URL(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? process.env.APP_PUBLIC_URL ?? "https://koensain.app"); } catch { throw fail("보고서 링크의 서비스 주소가 올바르지 않습니다.", 503); }
          if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw fail("보고서 링크의 서비스 주소가 올바르지 않습니다.", 503);
          const reportUrl = new URL(href, base.origin).toString();
          const text = `AI 브리핑이 공유되었습니다.\n${title}\n\n보고서 확인: ${reportUrl}`;
          const html = `<p>AI 브리핑이 공유되었습니다.</p><p>${escapeHtml(title)}</p><p><a href="${escapeHtml(reportUrl)}" target="_blank" rel="noopener noreferrer">브리핑 보고서 열기</a></p>`;
          const sender = rowsToObjects(await tx.exec("SELECT email FROM users WHERE user_id=$1", [actorId]))[0];
          await tx.run(`INSERT INTO mail_messages(message_id,mailbox_id,direction,rfc_message_id,thread_id,from_addr,to_addrs,subject,snippet,body_text,body_html,received_at,created_at)
            VALUES($1,$2,'in',$3,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$10) ON CONFLICT(mailbox_id,rfc_message_id) DO NOTHING`, [messageId, inbox.mailboxId, `<${deliveryId}@internal.mcm>`, sender?.email ?? null, JSON.stringify([{ address: inbox.address }]), `[AI 브리핑 공유] ${title}`, text.slice(0, 200), text, html, now]);
          await tx.run("INSERT INTO mail_message_state(message_id,folder_id,mailbox_id,is_read,created_at) VALUES($1,$2,$3,0,$4) ON CONFLICT(message_id,folder_id) DO NOTHING", [messageId, inbox.folderId, inbox.mailboxId, now]);
          providerId = messageId;
        } else if (claimed.channel === "messenger") {
          if (recipientId === actorId) { await finish(tx, deliveryId, token, "skipped", "메신저 공유는 본인 외 수신자에게 보냅니다.", null); return; }
          const message = await postDirectSharedRecordInTransaction(tx, actorId, recipientId, `AI 브리핑 공유: ${title}\n${href}`, record);
          providerId = `chat:${message.roomId}:${message.messageId}`;
        }
        await finish(tx, deliveryId, token, "sent", null, providerId);
      });
    } catch (error) {
      const status = externalAttempted ? "unknown" : [403, 404].includes(Number((error as { status?: number }).status)) ? "skipped" : "failed";
      await withDbWrite(tx => finish(tx, deliveryId, token, status, error instanceof Error ? error.message : String(error), null));
    }
  }
}
