import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { ingestSignalProjects, listProjectEvents, queryBriefingProjects } from "./project-intelligence";
import { briefingId, json } from "./briefing-store";
import type { BriefingProfileInput } from "./briefing-types";

/** 초기 이관 자료는 알림을 울리지 않고, 이후 발견된 신호만 live로 정규화한다. */
export async function synchronizeBriefingProjects(): Promise<{ created: number; updated: number }> {
  const db = await getDb();
  await db.run("INSERT INTO intel_briefing_runtime(key,value) VALUES('initial_cutoff',to_jsonb(now()::text)) ON CONFLICT(key) DO NOTHING");
  // 스테이징 pg 드라이버는 jsonb 문자열을 이미 풀어 주므로 JSON.parse 하지 않고 DB에서 시각으로 바꿔 읽는다.
  const cutoff = new Date(rowsToObjects(await db.exec("SELECT (value#>>'{}')::timestamptz AS cutoff FROM intel_briefing_runtime WHERE key='initial_cutoff'"))[0].cutoff as string | Date).getTime();
  const pending = rowsToObjects(await db.exec(`SELECT DISTINCT s.signal_id,s.created_at,s.updated_at FROM intel_signals s LEFT JOIN intel_project_signals ps ON ps.signal_id=s.signal_id LEFT JOIN intel_projects p ON p.project_id=ps.project_id LEFT JOIN intel_briefing_signal_checks c ON c.signal_id=s.signal_id WHERE s.duplicate_of IS NULL AND s.signal_grade<>'excluded' AND (ps.signal_id IS NULL OR s.updated_at::timestamptz>p.source_checked_at) AND (c.signal_id IS NULL OR s.updated_at::timestamptz>c.source_updated_at) ORDER BY s.created_at ASC LIMIT 500`));
  let created = 0, updated = 0;
  for (const mode of ["initial_backfill", "live"] as const) {
    const selected = pending.filter(s => (Date.parse(String(s.updated_at ?? s.created_at)) <= cutoff) ===(mode === "initial_backfill"));
    const ids = selected.map(s => String(s.signal_id));
    if (!ids.length) continue;
    const revisionIds=rowsToObjects(await db.exec("SELECT current_revision_id FROM intel_source_documents WHERE signal_id=ANY($1::text[]) AND current_revision_id IS NOT NULL",[ids])).map(r=>String(r.current_revision_id));
    const r = await ingestSignalProjects({ signalIds: ids, revisionIds, mode, limit: 500 }); created += r.created; updated += r.updated;
    // 내용 부족 등으로 스킵된 신호도 같은 개정은 다시 선두를 점유하지 않는다.
    for (const s of selected) await db.run("INSERT INTO intel_briefing_signal_checks(signal_id,source_updated_at) VALUES($1,$2) ON CONFLICT(signal_id) DO UPDATE SET source_updated_at=EXCLUDED.source_updated_at,checked_at=now()", [s.signal_id,s.updated_at ?? s.created_at]);
  }
  await db.run("INSERT INTO intel_briefing_runtime(key,value,updated_at) VALUES('last_signal_scan',to_jsonb(now()::text),now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()");
  return { created, updated };
}
/** 같은 사건·버전·수신자·채널은 여러 프로필에서 매칭돼도 하나의 outbox만 만든다. */
export async function queueImportantBriefingEvents(): Promise<number> {
  const db = await getDb(); const profiles = rowsToObjects(await db.exec("SELECT * FROM intel_briefing_profiles WHERE enabled=true AND config->>'importantAlerts'='true'"));
  let queued = 0;
  for (const row of profiles) {
    const config = json<BriefingProfileInput>(row.config), f = config.filters;
    const projects = new Map<string, { amount: number | null; stage: string }>(); let offset = 0;
    while (true) {
      const result = await queryBriefingProjects({ industries: f.industries, regions: f.regions, types: f.signalTypes, companyNames: f.companyNames, serviceCodes: f.services, amountMin: f.amountMin ?? undefined, amountMax: f.amountMax ?? undefined, includeUnknownAmount: f.includeUnknownScale, limit: 500, offset });
      for (const p of result.projects) projects.set(p.projectId, p);
      offset += result.projects.length; if (!result.projects.length || offset >= result.total) break;
    }
    let eventOffset = 0;
    while (true) {
      const events = await listProjectEvents({ after: new Date(String(row.created_at)).toISOString(), asOf: new Date().toISOString(), mode: "live", confirmedOnly: true, limit: 500, offset: eventOffset });
      for (const event of events) {
        const project = projects.get(event.projectId); if (!project) continue;
        const critical = isImportantBriefingChange(event, config.importantAmount);
        if (!critical) continue;
        await withDbWrite(async tx => {
          for (const r of config.recipients) for (const channel of r.channels) {
            const payload = { title: "관심 투자프로젝트의 중요 변화", text: `${event.title} — ${String(event.before.stage ?? "이전 단계 미확인")} → ${String(event.after.stage ?? project.stage)}`, link: `/sales/rag?tab=projects&projectId=${event.projectId}`, projectId: event.projectId, eventId: event.eventId, profileIds: [String(row.profile_id)] };
            const inserted = rowsToObjects(await tx.exec(`INSERT INTO intel_notification_outbox(delivery_id,dedup_key,profile_id,event_id,user_id,channel,kind,payload) VALUES($1,$2,$3,$4,$5,$6,'important',$7::jsonb) ON CONFLICT(dedup_key) DO UPDATE SET payload=jsonb_set(intel_notification_outbox.payload,'{profileIds}',(SELECT jsonb_agg(DISTINCT v) FROM jsonb_array_elements((intel_notification_outbox.payload->'profileIds')||(EXCLUDED.payload->'profileIds')) v)) RETURNING delivery_id`, [briefingId("ibd"), `important:${event.eventId}:${event.version}:${r.userId}:${channel}`, row.profile_id, event.eventId, r.userId, channel, JSON.stringify(payload)]));
            queued += inserted.length;
          }
        });
      }
      if (events.length < 500) break; eventOffset += events.length;
    }
  }
  return queued;
}
export function isImportantBriefingChange(event: { before: Record<string, unknown>; after: Record<string, unknown>; correctsEventId?: string | null }, threshold: number | null): boolean {
  const stageChanged = event.before.stage !== event.after.stage && ["canceled", "delayed", "suspended", "construction", "permitting", "approved"].includes(String(event.after.stage ?? ""));
  const oldAmount = event.before.amount == null ? null : Number(event.before.amount), amount = event.after.amount == null ? null : Number(event.after.amount);
  const amountChanged = amount != null && Number.isFinite(amount) && oldAmount !== amount && threshold != null && (oldAmount == null ? amount >= threshold : Math.abs(amount-oldAmount) >= threshold);
  return stageChanged || !!event.correctsEventId || amountChanged;
}
