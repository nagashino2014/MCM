import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getAiFeature } from "@/lib/ai/features";
import type { BriefingReport, RagBriefingSource } from "./rag-queries";
import { assertBriefingEvidenceContentQuality, buildBriefingEvidence } from "./briefing-evidence";
import { curateBriefingReport } from "./briefing-curation";
import { assertBriefingCapability } from "./briefing-access";
import { assertBriefingSnapshotRights, briefingAudit, briefingId, iso, json, loadBriefingProfile, queueDueBriefings } from "./briefing-store";
import { briefingError } from "./briefing-schedule";
import { intelSourceLabel } from "./source-labels";
import type { BriefingEvidence, BriefingPreview, BriefingProfile, BriefingRunStatus } from "./briefing-types";

interface ClaimedRun { runId: string; profileId: string; trigger: string; scheduledFor: string; periodStart: string | null; profile: BriefingProfile; token: string; attempt: number; createdAt: string; snapshotId: string | null; generated: GeneratedBriefing | null }
export interface GeneratedBriefing { report: BriefingReport; sources: RagBriefingSource[]; model: string | null }
export async function claimBriefingRun(): Promise<ClaimedRun | null> {
  return withDbWrite(async db => {
    await db.run("UPDATE intel_briefing_runs SET status='failed',error='실행 재시도 한도를 초과했습니다.',next_attempt_at='9999-12-31',lease_token=NULL,lease_until=NULL WHERE status IN('running','ready') AND lease_until<now() AND attempt>=3");
    const token = briefingId("lease");
    const rows = rowsToObjects(await db.exec(`WITH candidate AS (
      SELECT run_id FROM intel_briefing_runs WHERE
      ((status IN ('queued','waiting_sources','failed') AND next_attempt_at<=now() AND attempt<3) OR (status IN ('running','ready') AND lease_until<now() AND attempt<3))
      ORDER BY scheduled_for FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE intel_briefing_runs r SET status='running',lease_token=$1,lease_until=now()+interval '5 minutes',attempt=attempt+1,updated_at=now()
      FROM candidate c WHERE r.run_id=c.run_id RETURNING r.*`, [token]));
    if (!rows[0]) return null; const r = rows[0];
    // 첫 시도에 정한 초기 기준 여부와 기간을 재시도에서도 유지한다.
    const previous = r.period_end ? (r.initial_baseline ? null : r.period_start) : rowsToObjects(await db.exec("SELECT max(scheduled_for) AS previous FROM intel_briefing_runs WHERE profile_id=$1 AND profile_version=$2 AND trigger='scheduled' AND status IN('published','no_change') AND scheduled_for<$3", [r.profile_id,r.profile_version,r.scheduled_for]))[0]?.previous;
    const periodStart = previous ? iso(previous) : null;
    await db.run("UPDATE intel_briefing_runs SET period_start=$2,period_end=scheduled_for,initial_baseline=$3 WHERE run_id=$1", [r.run_id, periodStart ?? new Date(Date.parse(iso(r.scheduled_for))-93*86400000).toISOString(), periodStart === null]);
    return { runId: String(r.run_id), profileId: String(r.profile_id), trigger: String(r.trigger), scheduledFor: iso(r.scheduled_for), periodStart, profile: json<BriefingProfile>(r.config_snapshot), token, attempt: Number(r.attempt), createdAt: iso(r.created_at), snapshotId: r.snapshot_id ? String(r.snapshot_id) : null, generated: r.generated_result ? json<GeneratedBriefing>(r.generated_result) : null };
  });
}
function assertClaim(rows: Record<string, unknown>[]): void { if (!rows.length) throw briefingError("실행 소유권이 만료되었거나 중지되었습니다.", 409); }
async function heartbeat(run: ClaimedRun): Promise<void> {
  const db = await getDb();
  assertClaim(rowsToObjects(await db.exec("UPDATE intel_briefing_runs SET lease_until=now()+interval '5 minutes',updated_at=now() WHERE run_id=$1 AND lease_token=$2 AND status IN ('running','ready') AND lease_until>now() RETURNING run_id", [run.runId, run.token])));
}
/** 정기 보고서가 한 번에 분석하는 근거 상한. 넘으면 실패로 알린다. */
export const BRIEFING_EVIDENCE_LIMIT = 1200;
/** 첫 보고서(93일 전체가 새 자료) 분석 상한 — 요약 4묶음 분량. 넘으면 최근 프로젝트부터 채우고 보고서에 생략 수를 적는다. */
export const INITIAL_BASELINE_EVIDENCE_LIMIT = 360;
export interface BriefingEvidenceSelection { items: BriefingEvidence[]; analyzedProjects: number; omittedProjects: number }

export function selectBriefingEvidence(preview: BriefingPreview): BriefingEvidence[] {
  return selectBriefingEvidenceWithin(preview).items;
}
export function selectBriefingEvidenceWithin(preview: BriefingPreview): BriefingEvidenceSelection {
  // 모든 프로젝트와 변경·산업동향은 요약 문맥에 포함한다. 정기 보고서의 상한은 실패로 알려 부분 성공을 만들지 않는다.
  const selectedIds = new Set(preview.items.filter(e => e.kind === "project" || e.changed || e.kind === "official").map(e => e.id));
  const byId = new Map(preview.items.map(e => [e.id, e]));
  // 이미 보고한 원문도 선택 프로젝트의 대표 근거 비교에 필요하다. 권리·관심 조건을 통과한 현재 스냅샷 안에서만 보강한다.
  for (const project of preview.items.filter(e => e.kind === "project" && selectedIds.has(e.id))) {
    for (const id of project.relatedEvidenceIds ?? []) if (byId.has(id) && byId.get(id)!.kind !== "project") selectedIds.add(id);
  }
  const selected = preview.items.filter(e => selectedIds.has(e.id));
  const projectCount = selected.filter(e => e.kind === "project").length;
  if (preview.initialBaseline && selected.length > INITIAL_BASELINE_EVIDENCE_LIMIT) return limitInitialBaseline(selected, projectCount);
  if (selected.length > BRIEFING_EVIDENCE_LIMIT) throw briefingError("새 분석 자료가 1,200건을 넘습니다. 프로필 범위를 나누어 주세요.", 422);
  return { items: selected, analyzedProjects: projectCount, omittedProjects: 0 };
}
/** 첫 보고서는 공식 산업동향을 먼저 담고, 프로젝트를 최근 발표 순으로 원근거와 묶어 상한까지 채운다. 생략 수는 보고서에 적는다. */
function limitInitialBaseline(selected: BriefingEvidence[], projectCount: number): BriefingEvidenceSelection {
  const byId = new Map(selected.map(e => [e.id, e]));
  const eventAt = (e: BriefingEvidence) => { const t = Date.parse(e.publishedAt ?? e.discoveredAt); return Number.isNaN(t) ? 0 : t; };
  const linked = new Set(selected.filter(e => e.kind === "project").flatMap(e => e.relatedEvidenceIds ?? []));
  const units: BriefingEvidence[][] = [
    ...selected.filter(e => e.kind === "official").map(e => [e]),
    ...[...selected.filter(e => e.kind === "project"), ...selected.filter(e => e.kind === "signal" && !linked.has(e.id))]
      .sort((a, b) => eventAt(b) - eventAt(a) || a.id.localeCompare(b.id))
      .map(e => e.kind === "project" ? [e, ...(e.relatedEvidenceIds ?? []).map(id => byId.get(id)).filter((x): x is BriefingEvidence => !!x && x.kind !== "project")] : [e]),
  ];
  const kept = new Set<string>(); let analyzedProjects = 0;
  for (const unit of units) {
    const added = unit.filter(e => !kept.has(e.id));
    if (kept.size + added.length > INITIAL_BASELINE_EVIDENCE_LIMIT) continue;
    added.forEach(e => kept.add(e.id));
    if (unit[0].kind === "project") analyzedProjects++;
  }
  return { items: selected.filter(e => kept.has(e.id)), analyzedProjects, omittedProjects: projectCount - analyzedProjects };
}
export function validateBriefingNarrative(text: string, evidenceCount: number): { trends: string[]; insights: Array<{ badge: string; text: string }> } {
  let data: { trends?: unknown; insights?: unknown };
  try { data = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch { throw briefingError("AI 보고서 형식 검증에 실패했습니다.", 422); }
  const trends = Array.isArray(data.trends) ? data.trends.filter((x): x is string => typeof x === "string") : [];
  const insights = Array.isArray(data.insights) ? data.insights.filter((x): x is { badge: string; text: string } => !!x && typeof x.badge === "string" && typeof x.text === "string") : [];
  if (!trends.length) throw briefingError("AI 보고서의 핵심 동향이 비어 있습니다.", 422);
  for (const text of [...trends, ...insights.map(x => x.text)]) {
    const refs = [...text.matchAll(/\[(\d+)\]/g)].map(x => Number(x[1]));
    if (!refs.length || refs.some(n => n < 1 || n > evidenceCount)) throw briefingError("AI 보고서에 유효하지 않은 출처가 있습니다.", 422);
  }
  return { trends, insights };
}
export async function generateScheduledBriefing(preview: BriefingPreview, profile: BriefingProfile, runId: string): Promise<GeneratedBriefing> {
  const { items: selected, analyzedProjects, omittedProjects } = selectBriefingEvidenceWithin(preview);
  const kpis = [{ label: "대상 프로젝트 후보", value: `${preview.totalProjects}개`, sub: "중복 선별 전 조건 전체 집계" }, { label: "수집 신호", value: `${preview.totalSignals}건`, sub: "프로젝트 수와 별도" }, { label: "새로 확인한 자료", value: `${preview.changedCount}건`, sub: "늦게 수집된 과거 자료 포함" }, { label: "분석 기준", value: (preview.periodEnd ?? preview.asOf).slice(0, 10), sub: "발표일과 수집일 구분" }];
  const limitNote = omittedProjects ? `첫 보고서는 범위가 넓어 조건에 맞는 프로젝트 ${(analyzedProjects + omittedProjects).toLocaleString("ko-KR")}개 중 최근 발표 ${analyzedProjects.toLocaleString("ko-KR")}개만 분석했습니다. 나머지 ${omittedProjects.toLocaleString("ko-KR")}개는 관심 기업·지역으로 범위를 나누면 함께 분석합니다.` : null;
  const etcNote = [limitNote, preview.coverageNote, preview.sourceHealth.some(s => s.status !== "fresh") ? `일부 자료 수집 상태 확인 필요: ${preview.sourceHealth.filter(s => s.status !== "fresh").map(s => intelSourceLabel(s.source)).join(", ")}` : null].filter(Boolean).join("\n") || null;
  if (!preview.changedCount) return { model: null, sources: [], report: { kpis, trends: ["새로운 주요 변동이 없습니다."], companies: [], insights: [], etcNote } };
  if (!process.env.ANTHROPIC_API_KEY) throw briefingError("AI API 키가 설정되지 않아 정기 브리핑을 생성할 수 없습니다.", 503);
  const generated = await curateBriefingReport({ items: selected, question: profile.name, reportLevel: profile.reportLevel, requireOfficialBackground: true,
    context: `보고 기간 ${preview.periodStart ?? "초기 기준"} ~ ${preview.periodEnd ?? preview.asOf}, 자료 확보 ${preview.asOf}. 대상 프로젝트 후보 ${preview.totalProjects}개, 신호 ${preview.totalSignals}건. initial_baseline은 첫 보고의 기준 자료, late_arrival은 이전 발표의 지연 수집, background는 배경 자료입니다.`,
    feature: "intel.scheduled_briefing", model: getAiFeature("intel.scheduled_briefing").defaultModel, userId: profile.ownerUserId, subject: { type: "intel_briefing_run", id: runId }, kpis, etcNote });
  generated.report.kpis[0] = { label: "선별 투자계획", value: `${generated.report.companies.length}개`, sub: `대상 후보 ${preview.totalProjects}개에서 중복·무관 자료 정리` };
  return generated;
}
export async function executeClaimedBriefing(run: ClaimedRun, generate = generateScheduledBriefing): Promise<BriefingRunStatus> {
  let heartbeatError: unknown = null;
  const timer = setInterval(() => { void heartbeat(run).catch(error => { heartbeatError = error; }); }, 30000);
  try {
    await assertBriefingCapability(run.profile.ownerUserId, "create");
    const current = await loadBriefingProfile(run.profileId);
    if (!current || (!current.enabled && run.trigger === "scheduled")) throw briefingError("중지된 프로필입니다.", 409);
    let preview: BriefingPreview;
    const db = await getDb();
    if (run.snapshotId) preview = json<BriefingPreview>(rowsToObjects(await db.exec("SELECT payload FROM intel_briefing_snapshots WHERE snapshot_id=$1", [run.snapshotId]))[0].payload);
    else {
      preview = await buildBriefingEvidence(run.profile, new Date().toISOString(), { periodStart: run.periodStart, periodEnd: run.scheduledFor });
      if (preview.sourceHealth.some(s => run.profile.requiredSources.includes(s.source) && s.status !== "fresh") && !run.profile.allowPartialSources) {
        const waiting = Date.now() - Date.parse(run.createdAt) < 30 * 60000;
        await db.run("UPDATE intel_briefing_runs SET status=$3,error=$4,next_attempt_at=now()+interval '5 minutes',attempt=GREATEST(attempt-1,0),lease_token=NULL,lease_until=NULL,updated_at=now() WHERE run_id=$1 AND lease_token=$2", [run.runId, run.token, waiting ? "waiting_sources" : "failed", "필수 소스의 최근 수집을 확인하지 못했습니다."]);
        if (!waiting) await db.run("UPDATE intel_briefing_runs SET next_attempt_at='9999-12-31' WHERE run_id=$1 AND status='failed'", [run.runId]);
        return waiting ? "waiting_sources" : "failed";
      }
      // 수집 대기가 끝난 후의 자료와 기준시각을 고정한다.
      const sid = briefingId("ibs");
      await withDbWrite(async tx => {
        assertClaim(rowsToObjects(await tx.exec("SELECT run_id FROM intel_briefing_runs WHERE run_id=$1 AND lease_token=$2 AND lease_until>now() AND status='running' FOR UPDATE", [run.runId, run.token])));
        await tx.run("INSERT INTO intel_briefing_snapshots(snapshot_id,run_id,as_of,payload) VALUES($1,$2,$3,$4::jsonb)", [sid, run.runId, preview.asOf, JSON.stringify(preview)]);
        await tx.run("UPDATE intel_briefing_runs SET snapshot_id=$2 WHERE run_id=$1", [run.runId, sid]);
      }); run.snapshotId = sid;
    }
    await assertBriefingSnapshotRights(run.snapshotId!);
    await assertBriefingEvidenceContentQuality(preview.items);
    const generated = run.generated ?? await generate(preview, run.profile, run.runId);
    if (heartbeatError) throw heartbeatError;
    await heartbeat(run);
    assertClaim(rowsToObjects(await db.exec("UPDATE intel_briefing_runs SET generated_result=$3::jsonb,status='ready',updated_at=now() WHERE run_id=$1 AND lease_token=$2 AND lease_until>now() RETURNING run_id", [run.runId, run.token, JSON.stringify(generated)])));
    await assertBriefingCapability(run.profile.ownerUserId, "create");
    await assertBriefingSnapshotRights(run.snapshotId!);
    await assertBriefingEvidenceContentQuality(preview.items);
    const status: BriefingRunStatus = preview.changedCount ? "published" : "no_change";
    await withDbWrite(async tx => {
      assertClaim(rowsToObjects(await tx.exec("SELECT run_id FROM intel_briefing_runs WHERE run_id=$1 AND lease_token=$2 AND lease_until>now() AND status='ready' FOR UPDATE", [run.runId, run.token])));
      const live = await loadBriefingProfile(run.profileId, tx);
      if (!live || (!live.enabled && run.trigger === "scheduled")) throw briefingError("발행 전에 프로필이 중지되었습니다.", 409);
      const bid = briefingId("irag");
      await tx.run(`INSERT INTO intel_rag_briefings(briefing_id,question,answer_md,sources,filters,model,status,created_by,created_at,access_scope,profile_id,run_id,snapshot_id,schema_version) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,'done',$7,$8,'restricted',$9,$10,$11,2)`, [bid, run.profile.name, JSON.stringify(generated.report), JSON.stringify(generated.sources), JSON.stringify(run.profile.filters), generated.model, run.profile.ownerUserId, new Date().toISOString(), run.profileId, run.runId, run.snapshotId]);
      const liveRecipients = rowsToObjects(await tx.exec("SELECT r.user_id,r.channels FROM intel_briefing_recipients r JOIN users u ON u.user_id=r.user_id AND u.status='active' WHERE r.profile_id=$1", [run.profileId]));
      for (const rcpt of run.profile.recipients) {
        const active = liveRecipients.find(r => r.user_id === rcpt.userId); if (!active) continue;
        await tx.run("INSERT INTO intel_rag_briefing_shares(share_id,briefing_id,recipient_user_id,shared_by,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(briefing_id,recipient_user_id) DO NOTHING", [briefingId("irsh"), bid, rcpt.userId, run.profile.ownerUserId, new Date().toISOString()]);
        for (const channel of rcpt.channels.filter(c => json<string[]>(active.channels).includes(c))) {
          if (status === "no_change" && !run.profile.notifyNoChange) continue;
          await tx.run(`INSERT INTO intel_notification_outbox(delivery_id,dedup_key,profile_id,briefing_id,user_id,channel,kind,payload) VALUES($1,$2,$3,$4,$5,$6,'briefing',$7::jsonb) ON CONFLICT(dedup_key) DO NOTHING`, [briefingId("ibd"), `briefing:${bid}:${rcpt.userId}:${channel}`, run.profileId, bid, rcpt.userId, channel, JSON.stringify({ title: run.profile.name, text: generated.report.trends.slice(0, 3).join("\n"), runId: run.runId, link: `/sales/rag?tab=scheduled&runId=${run.runId}` })]);
        }
      }
      // 수동 생성은 정기 증분 기준을 소모하지 않는다.
      if (run.trigger === "scheduled") for (const e of preview.items.filter(item => Date.parse(item.publishedAt ?? item.discoveredAt) <= Date.parse(preview.periodEnd ?? preview.asOf))) await tx.run("INSERT INTO intel_profile_seen_revisions(profile_id,profile_version,evidence_id,revision,run_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [run.profileId, run.profile.version, e.id, e.revision, run.runId]);
      await tx.run("UPDATE intel_briefing_runs SET status=$3,briefing_id=$4,lease_token=NULL,lease_until=NULL,error=NULL,updated_at=now() WHERE run_id=$1 AND lease_token=$2", [run.runId, run.token, status, bid]);
      await briefingAudit(tx, "run.publish", run.profile.ownerUserId, run.profileId, run.runId, { status, briefingId: bid, snapshotId: run.snapshotId });
    }); return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const budget = /budget|예산/.test(message); const code = (error as { status?: number }).status;
    const transient = code === 429 || code === 502 || /timeout|타임아웃|ECONN/.test(message);
    const db = await getDb();
    await db.run("UPDATE intel_briefing_runs SET status=$3,error=$4,next_attempt_at=$5,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE run_id=$1 AND lease_token=$2", [run.runId, run.token, budget ? "blocked_budget" : "failed", message.slice(0, 1000), transient && run.attempt < 3 ? new Date(Date.now() + run.attempt * 60000).toISOString() : "9999-12-31T00:00:00Z"]);
    return budget ? "blocked_budget" : "failed";
  } finally { clearInterval(timer); }
}
export async function runBriefingBatch(limit = 2): Promise<{ queued: number; processed: Array<{ runId: string; status: BriefingRunStatus }> }> {
  const queued = await queueDueBriefings(); const processed: Array<{ runId: string; status: BriefingRunStatus }> = [];
  for (let i = 0; i < Math.min(limit, 10); i++) { const run = await claimBriefingRun(); if (!run) break; processed.push({ runId: run.runId, status: await executeClaimedBriefing(run) }); }
  return { queued, processed };
}
