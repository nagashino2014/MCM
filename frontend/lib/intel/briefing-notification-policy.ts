import { rowsToObjects, withDbWrite } from "@/lib/db";
import { assertBriefingEvidenceRights, briefingId, getBriefingProfile, json } from "./briefing-store";
import { briefingError } from "./briefing-schedule";

export interface NotificationPayload { title: string; text: string; link: string; projectId?: string; eventId?: string; profileIds?: string[]; digest?: boolean; eventIds?: string[] }
export function importantDeliveryWindow(now = new Date()): { day: string; start: string; nextMorning: string; quietUntil: string | null } {
  const kst = new Date(now.getTime()+9*3600000), day = kst.toISOString().slice(0,10), hour = kst.getUTCHours();
  const morning = new Date(`${day}T07:00:00+09:00`).getTime();
  return { day, start: new Date(`${day}T00:00:00+09:00`).toISOString(), nextMorning: new Date(morning+86400000).toISOString(), quietUntil: hour<7 ? new Date(morning).toISOString() : hour>=22 ? new Date(morning+86400000).toISOString() : null };
}
/** 같은 사건이 여러 프로필과 맞아도 현재 유효한 수신 설정 하나만 있으면 전달한다. */
export async function assertImportantRecipient(row: Record<string, unknown>): Promise<NotificationPayload> {
  const payload = json<NotificationPayload>(row.payload), uid = String(row.user_id);
  const profileIds = [...new Set([String(row.profile_id),...(payload.profileIds ?? [])])];
  let allowed = false;
  for (const profileId of profileIds) {
    try {
      const p = await getBriefingProfile(profileId, uid);
      if (p.enabled && p.importantAlerts && p.recipients.some(r => r.userId===uid && r.channels.includes(String(row.channel) as "inbox"))) { allowed=true; break; }
    } catch (error) { if (![403,404].includes((error as { status?: number }).status ?? 0)) throw error; }
  }
  if (!allowed) throw briefingError("중요 알림의 모든 수신 설정이 해제되었습니다.",403);
  if (payload.projectId) await assertBriefingEvidenceRights([{id:`project:${payload.projectId}`,kind:"project",revision:""}]);
  return payload;
}
/** 선점 후 실제 발송 직전에 수신자별 상한을 예약한다. 초과 사건은 원래 키를 보존한 채 익일 묶음에 연결한다. */
export async function applyImportantDeliveryPolicy(row: Record<string, unknown>, token: string, now = new Date()): Promise<boolean> {
  if (row.kind!=="important") return true;
  const payload=json<NotificationPayload>(row.payload), window=importantDeliveryWindow(now);
  return withDbWrite(async db=>{
    await db.exec("SELECT pg_advisory_xact_lock(hashtext($1))",[`briefing-cap:${row.user_id}:${row.channel}:${window.day}`]);
    if (window.quietUntil) {
      await db.run("UPDATE intel_notification_outbox SET status='pending',attempt=GREATEST(attempt-1,0),next_attempt_at=$3,lease_token=NULL,lease_until=NULL WHERE delivery_id=$1 AND lease_token=$2",[row.delivery_id,token,window.quietUntil]); return false;
    }
    if (payload.digest) return true;
    const configured=Number(process.env.INTEL_IMPORTANT_DAILY_LIMIT ?? 20), cap=Number.isInteger(configured)&&configured>0&&configured<=1000?configured:20;
    const count=Number(rowsToObjects(await db.exec("SELECT count(*) AS n FROM intel_notification_outbox WHERE user_id=$1 AND channel=$2 AND kind='important' AND digest_delivery_id IS NULL AND COALESCE(payload->>'digest','false')<>'true' AND status IN('sent','unknown','sending') AND updated_at>=$3::timestamptz",[row.user_id,row.channel,window.start]))[0].n);
    if(count<=cap)return true;
    const key=`important-digest:${row.user_id}:${row.channel}:${window.day}`;
    const digest=rowsToObjects(await db.exec(`INSERT INTO intel_notification_outbox(delivery_id,dedup_key,profile_id,user_id,channel,kind,payload,next_attempt_at)
      VALUES($1,$2,$3,$4,$5,'important',$6::jsonb,$7) ON CONFLICT(dedup_key) DO UPDATE SET updated_at=now() RETURNING delivery_id,status`,[briefingId("ibd"),key,row.profile_id,row.user_id,row.channel,JSON.stringify({title:"관심 프로젝트 중요 변화 모아보기",text:"개별 알림 상한을 초과한 중요 변화를 모았습니다.",link:"/sales/rag?tab=projects",digest:true}),window.nextMorning]))[0];
    if(digest.status!=="pending") throw briefingError("묶음 알림이 이미 전달 중입니다. 다음 시도에서 다시 확인합니다.",409);
    await db.run("UPDATE intel_notification_outbox SET status='pending',attempt=GREATEST(attempt-1,0),digest_delivery_id=$3,next_attempt_at='9999-12-31',lease_token=NULL,lease_until=NULL WHERE delivery_id=$1 AND lease_token=$2",[row.delivery_id,token,digest.delivery_id]);
    return false;
  });
}
export async function prepareImportantDigest(deliveryId: string): Promise<NotificationPayload> {
  return withDbWrite(async db=>{
    const members=rowsToObjects(await db.exec("SELECT * FROM intel_notification_outbox WHERE digest_delivery_id=$1 AND status='pending' ORDER BY created_at FOR UPDATE",[deliveryId]));
    const accepted: NotificationPayload[]=[];
    for(const member of members) {
      try { accepted.push(await assertImportantRecipient(member)); }
      catch(error) {
        if(![403,404].includes((error as {status?:number}).status??0))throw error;
        await db.run("UPDATE intel_notification_outbox SET status='skipped',error=$2,updated_at=now() WHERE delivery_id=$1",[member.delivery_id,error instanceof Error?error.message:String(error)]);
      }
    }
    if(!accepted.length)throw briefingError("현재 전달할 수 있는 중요 변화가 없습니다.",403);
    const payload:NotificationPayload={title:`관심 프로젝트 중요 변화 ${accepted.length}건`,text:accepted.map(p=>`${p.text}\n${p.link}`).join("\n\n"),link:"/sales/rag?tab=projects",digest:true,eventIds:accepted.flatMap(p=>p.eventId?[p.eventId]:[])};
    await db.run("UPDATE intel_notification_outbox SET payload=$2::jsonb WHERE delivery_id=$1",[deliveryId,JSON.stringify(payload)]);
    return payload;
  });
}
