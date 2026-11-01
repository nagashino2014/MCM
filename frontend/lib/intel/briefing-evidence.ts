import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbRead, type PgDatabase } from "@/lib/db";
import { queryBriefingProjects } from "./project-intelligence";
import { listOfficialEvidence } from "./official-sources";
import { newsContentQualityCondition } from "./news-content-quality";
import { signalOriginalEvidence } from "./briefing-original-text";
import { briefingError } from "./briefing-schedule";
import { iso } from "./briefing-store";
import type { BriefingEvidence, BriefingPreview, BriefingProfile, BriefingSourceHealth } from "./briefing-types";

const hash = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
/** 새 생성·재시도에서만 현재 품질을 확인한다. 발행 당시 보고서의 열람 권한과는 분리한다. */
export async function assertBriefingEvidenceContentQuality(items: Array<{ id: string; kind: string }>): Promise<void> {
  const signalIds = items.filter(item => item.kind === "signal").map(item => item.id.replace(/^signal:/, ""));
  const projectIds = items.filter(item => item.kind === "project").map(item => item.id.replace(/^project:/, ""));
  if (!signalIds.length && !projectIds.length) return;
  const db = await getDb();
  const held = rowsToObjects(await db.exec(`SELECT s.signal_id FROM intel_signals s WHERE
    (s.signal_id=ANY($1::text[]) OR EXISTS(SELECT 1 FROM intel_project_signals ps WHERE ps.signal_id=s.signal_id AND ps.project_id=ANY($2::text[]))
      OR EXISTS(SELECT 1 FROM intel_project_events e WHERE s.signal_id=ANY(e.evidence_signal_ids) AND e.project_id=ANY($2::text[])))
    AND NOT (${newsContentQualityCondition()}) LIMIT 1`, [signalIds, projectIds]));
  if (held.length) throw briefingError("기존 근거 중 제목·내용 재검증이 필요한 수집 자료가 있습니다. 검증을 완료한 자료로 새 브리핑을 생성하세요.", 409);
}
/** 유사도 상위 N건 대신 조건 전체를 조회한다. 안전 상한 초과는 조용한 절단 없이 실패한다. */
export async function buildBriefingEvidence(profile: BriefingProfile, asOf = new Date().toISOString(), period?: { periodStart: string | null; periodEnd: string }): Promise<BriefingPreview> {
  return withDbRead(db => collectBriefingEvidence(db, profile, asOf, period));
}
async function collectBriefingEvidence(db: PgDatabase, profile: BriefingProfile, asOf: string, period?: { periodStart: string | null; periodEnd: string }): Promise<BriefingPreview> {
  const f = profile.filters;
  const evidence: BriefingEvidence[] = [];
  let offset = 0, totalProjects = 0;
  do {
    const result = await queryBriefingProjects({ industries: f.industries, regions: f.regions, types: f.signalTypes, companyNames: f.companyNames, serviceCodes: f.services, amountMin: f.amountMin ?? undefined, amountMax: f.amountMax ?? undefined, includeUnknownAmount: f.includeUnknownScale, limit: 200, offset }, { asOf, db });
    totalProjects = result.total;
    if (totalProjects > 10000) throw briefingError("분석 대상이 10,000개를 넘습니다. 관심 조건을 좁혀 주세요.", 422);
    for (const p of result.projects) {
      const facts = { title: p.title, companyName: p.companyName, region: p.region, stage: p.stage, amount: p.amount, currency: p.currency, amountScope: p.amountScope, publicSummary: p.publicSummary };
      evidence.push({ id: `project:${p.projectId}`, revision: hash(facts), kind: "project", title: p.title, companyName: p.companyName, region: p.region, source: "project", url: null, publishedAt: null, discoveredAt: p.updatedAt, text: JSON.stringify(facts), originalText: null, qualityInputKind: "derived", changed: false, amount: p.amount });
    }
    offset += result.projects.length;
    if (!result.projects.length) break;
  } while (offset < totalProjects);
  const params: unknown[] = [asOf]; const where = ["s.duplicate_of IS NULL", "s.signal_grade <> 'excluded'", "COALESCE(s.status,'new') <> 'dismissed'", "s.source NOT LIKE 'official:%'", newsContentQualityCondition(), "COALESCE(s.industry_relevance,'') <> 'none'", "s.updated_at::timestamptz <= $1::timestamptz"];
  const exactFilter = (column: string, values: string[]) => { if (values.length) { params.push(values); where.push(`${column}=ANY($${params.length}::text[])`); } };
  exactFilter("s.industry", f.industries); exactFilter("s.company_name", f.companyNames);
  if (f.regions.length) { params.push(f.regions); where.push(`EXISTS(SELECT 1 FROM unnest($${params.length}::text[]) region WHERE s.region=region OR s.region LIKE region||' %')`); }
  if (f.signalTypes.length) { params.push(f.signalTypes); where.push(`s.signal_type=ANY($${params.length}::text[])`); }
  if (f.amountMin != null || f.amountMax != null) {
    const bounds: string[] = []; if (f.amountMin != null) { params.push(f.amountMin); bounds.push(`s.amount >= $${params.length}`); } if (f.amountMax != null) { params.push(f.amountMax); bounds.push(`s.amount <= $${params.length}`); }
    where.push(`(${bounds.join(" AND ")}${f.includeUnknownScale ? " OR s.amount IS NULL" : ""})`);
  }
  if (f.services.length) {
    params.push(evidence.filter(e => e.kind === "project").map(e => e.id.slice(8)));
    where.push(`EXISTS(SELECT 1 FROM intel_project_signals ps WHERE ps.signal_id=s.signal_id AND ps.project_id=ANY($${params.length}::text[]))`);
  }
  const quality = newsContentQualityCondition();
  const heldRows = rowsToObjects(await db.exec(`SELECT count(*)-count(*) FILTER(WHERE ${quality}) AS held FROM intel_signals s WHERE ${where.filter(condition => condition !== quality).join(" AND ")}`, params));
  const heldNews = Number(heldRows[0]?.held ?? 0);
  const rows = rowsToObjects(await db.exec(`SELECT s.signal_id,s.source,s.company_name,s.report_name,s.summary,s.raw_json,s.disclosed_at,s.created_at,s.updated_at,s.region,s.amount,s.url,s.signal_type FROM intel_signals s WHERE ${where.join(" AND ")} ORDER BY s.created_at,s.signal_id LIMIT 10001`, params));
  if (rows.length > 10000) throw briefingError("분석 신호가 10,000건을 넘습니다. 관심 조건을 좁혀 주세요.", 422);
  for (const s of rows) {
    const text = [s.report_name, s.summary, s.region, s.signal_type, s.amount == null ? "규모 미상" : `투자금액 ${s.amount}원`].filter(Boolean).join(" · ");
    const original = signalOriginalEvidence(s);
    evidence.push({ id: `signal:${s.signal_id}`, revision: hash([s.report_name, s.summary, s.company_name, s.disclosed_at, s.region, s.signal_type, s.amount, original.originalText, original.qualityInputKind]), kind: "signal", title: String(s.report_name ?? "수집 신호"), companyName: s.company_name ? String(s.company_name) : null, region: s.region ? String(s.region) : null, source: String(s.source), url: s.url ? String(s.url) : null, publishedAt: s.disclosed_at ? iso(s.disclosed_at) : null, discoveredAt: iso(s.updated_at ?? s.created_at), text, ...original, changed: false, amount: s.amount == null ? null : Number(s.amount) });
  }
  const projectSources = rowsToObjects(await db.exec(`SELECT ps.project_id,s.signal_id,s.source,d.document_id FROM intel_project_signals ps JOIN intel_signals s ON s.signal_id=ps.signal_id LEFT JOIN intel_source_documents d ON d.signal_id=s.signal_id WHERE ps.project_id=ANY($1::text[])`, [evidence.filter(e => e.kind === "project").map(e => e.id.slice(8))]));
  let officialOffset: number | null = 0;
  const backgroundFrom = new Date(Date.parse(asOf) - 93 * 86400000).toISOString();
  while (officialOffset !== null) {
    const result: Awaited<ReturnType<typeof listOfficialEvidence>> = await listOfficialEvidence({ from: backgroundFrom, asOf, industries: f.industries, limit: 200, offset: officialOffset });
    if (result.total > 10000) throw briefingError("산업동향 자료가 분석 상한을 넘습니다. 범위를 좁혀 주세요.", 422);
    for (const d of result.evidence) {
      evidence.push({ id: `official:${d.documentId}`, revision: d.revisionId, kind: "official", title: d.title, companyName: null, region: null, source: d.sourceName, url: d.url, publishedAt: d.publishedAt, discoveredAt: d.fetchedAt, text: d.normalizedText, originalText: d.normalizedText, qualityInputKind: "full_text", changed: false, amount: null });
    }
    officialOffset = result.nextOffset;
  }
  // 산업동향의 최근 기간과 장기 프로젝트의 유효 근거는 별도로 읽는다.
  const projectDocumentIds = [...new Set(projectSources.filter(r=>String(r.source).startsWith("official:")&&r.document_id).map(r=>String(r.document_id)))];
  if(projectDocumentIds.length) {
    officialOffset=0;
    while(officialOffset!==null) {
      const result: Awaited<ReturnType<typeof listOfficialEvidence>>=await listOfficialEvidence({documentIds:projectDocumentIds,asOf,limit:200,offset:officialOffset});
      if(result.total>10000)throw briefingError("프로젝트 근거 자료가 분석 상한을 넘습니다. 범위를 좁혀 주세요.",422);
      for(const d of result.evidence) if(!evidence.some(e=>e.id===`official:${d.documentId}`))evidence.push({id:`official:${d.documentId}`,revision:d.revisionId,kind:"official",title:d.title,companyName:d.companyName??null,region:null,source:d.sourceName,url:d.url,publishedAt:d.publishedAt,discoveredAt:d.fetchedAt,text:d.normalizedText,originalText:d.normalizedText,qualityInputKind:"full_text",changed:false,amount:null});
      officialOffset=result.nextOffset;
    }
  }
  const seen = rowsToObjects(await db.exec("SELECT evidence_id,revision FROM intel_profile_seen_revisions WHERE profile_id=$1 AND profile_version=$2", [profile.profileId, profile.version]));
  const keys = new Set(seen.map(r => `${r.evidence_id}:${r.revision}`));
  // 공식 문서에서 파생된 프로젝트도 현재 AI 이용이 허용된 근거가 있어야 공통 문맥에 포함한다.
  const officialAllowed = new Set(evidence.filter(e => e.kind === "official").map(e => e.id.slice(9)));
  const filtered = evidence.filter(e => e.kind !== "project" || !projectSources.some(r => r.project_id === e.id.slice(8) && String(r.source).startsWith("official:") && !officialAllowed.has(String(r.document_id))));
  const byId = new Map(filtered.map(item => [item.id, item]));
  for (const link of projectSources) {
    // 기존 수집 신호도 이력 보존용 문서를 가진다. 문서 존재가 아닌 실제 소스로 근거 종류를 구분한다.
    const sourceId = String(link.source).startsWith("official:") ? `official:${link.document_id}` : `signal:${link.signal_id}`;
    const p = byId.get(`project:${link.project_id}`), source = byId.get(sourceId);
    if (p && source) { p.relatedEvidenceIds = [...new Set([...(p.relatedEvidenceIds ?? []), source.id])]; source.relatedEvidenceIds = [...new Set([...(source.relatedEvidenceIds ?? []), p.id])]; }
  }
  totalProjects = filtered.filter(e => e.kind === "project").length;
  const periodEnd = period?.periodEnd ?? asOf; const periodStart = period?.periodStart ?? new Date(Date.parse(periodEnd) - 93 * 86400000).toISOString();
  for (const item of filtered) {
    item.changed = !keys.has(`${item.id}:${item.revision}`);
    const eventDate = item.publishedAt && !Number.isNaN(Date.parse(item.publishedAt)) ? item.publishedAt : item.discoveredAt;
    item.temporalClass = !period?.periodStart ? "initial_baseline" : !item.changed ? "background" : Date.parse(eventDate) <= Date.parse(periodStart) ? "late_arrival" : Date.parse(eventDate) > Date.parse(periodEnd) ? "background" : "current_period";
    if (Date.parse(eventDate) > Date.parse(periodEnd)) item.changed = false;
  }
  return { totalProjects, totalSignals: rows.length, changedCount: filtered.filter(e => e.changed).length, sourceHealth: await getBriefingSourceHealth(db, profile.requiredSources, asOf), items: filtered, asOf, capturedAt: asOf, periodStart, periodEnd, initialBaseline: !period?.periodStart, coverageNote: heldNews ? `제목·본문 근거 재검증에서 보류된 수집 자료 ${heldNews.toLocaleString("ko-KR")}건은 투자 분석에서 제외했습니다. 원자료는 보존됩니다.` : null };
}
export async function getBriefingSourceHealth(db: PgDatabase, requiredSources: string[], now = new Date().toISOString()): Promise<BriefingSourceHealth[]> {
  const rows = rowsToObjects(await db.exec("SELECT source,last_run_at FROM intel_collect_state"));
  const states = new Map(rows.map(r => [String(r.source), r.last_run_at ? iso(r.last_run_at) : null]));
  const logs = rowsToObjects(await db.exec("SELECT DISTINCT ON(source_slug) source_slug,status,finished_at,error FROM scraper_run_logs ORDER BY source_slug,finished_at DESC"));
  const official = rowsToObjects(await db.exec("SELECT official_provider,official_config FROM scraper_sources WHERE official_provider IS NOT NULL"));
  const names = [...new Set(["dart", "eiass", "press", "news", "gosi_eum", "gosi_me", ...official.map(r => String(r.official_provider)), ...requiredSources])];
  return names.map(source => {
    const last = states.get(source === "gosi_eum" || source === "gosi_me" ? "gosi" : source) ?? null;
    const off = official.find(r => r.official_provider === source);
    if (off) { const state = off.official_config as { enabled?: boolean; lastSuccessAt?: string; lastError?: string; nextDueAt?: string }; const fresh = state.enabled && state.lastSuccessAt && !state.lastError && (!state.nextDueAt || Date.parse(state.nextDueAt) >= Date.parse(now)-3600000); return { source, lastSuccessAt: state.lastSuccessAt ?? null, status: fresh ? "fresh" : state.lastSuccessAt ? "stale" : "unavailable", message: fresh ? "공식 자료 수집 확인" : state.lastError ?? "공식 자료 활성·수집 상태를 확인하세요." }; }
    const log = logs.find(r => r.source_slug === source || r.source_slug === (source.startsWith("gosi_") ? "gosi" : source));
    const success = log?.status === "success" ? iso(log.finished_at) : null;
    const fresh = success != null && Date.parse(now) - Date.parse(success) <= 36 * 3600000;
    return { source, lastSuccessAt: success, status: fresh ? "fresh" : success ? "stale" : "unavailable", message: fresh ? "완료 로그로 최근 수집 확인" : log?.status === "error" ? `수집 실패: ${String(log.error ?? "")}` : last ? `최근 실행 ${last.slice(0,16)} — 성공 완료 로그가 없어 정상 수집 여부 확인 필요` : "성공한 수집 기록이 없습니다." };
  });
}
