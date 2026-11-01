// RAG & 영업 발굴 (D단계) — 벡터 유사도 검색, 질의형 브리핑 생성, 브리핑 이력, 발굴 후보.
// 검색: pgvector 코사인(intel_embeddings) 기본, VOYAGE_API_KEY 없으면 키워드(ILIKE) 폴백.
// 브리핑: 검색 결과를 공통 근거 선별·요약기로 전달해 구조화 보고서를 생성한다.

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { embedTexts, isEmbeddingConfigured, toVectorLiteral } from "./embeddings";
import { sourceCondition } from "./intel-queries";
import { curateBriefingReport } from "./briefing-curation";
import { separateAmbiguousProjectLinks, sortBriefingInsights } from "./briefing-report-policy";
import type { BriefingEvidence } from "./briefing-types";
import { assertLegacyBriefingSourcePolicy, legacySignalSourceCondition } from "./official-sources-visibility";
import { assertBriefingCapability, briefingOwnerSql, briefingVisibilitySql, getBriefingCapabilities } from "./briefing-access";
import { newsContentQualityCondition } from "./news-content-quality";
import { currentSignalContent, isSignalEmbeddingCurrent } from "./rag-indexer";
import { signalOriginalEvidence } from "./briefing-original-text";

const BRIEFING_MODEL = process.env.INTEL_RAG_MODEL || "claude-sonnet-5";

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

// ── 검색 ──────────────────────────────────────────────────────────────

export interface RagSearchFilter {
  source?: string; // dart|eiass|press|news|gosi_eum|gosi_me
  grade?: string; // 미지정=기본(excluded 제외), 'all'=전량, 특정등급=그 등급만
  relevance?: string; // 미지정=기본(none 제외), 'all'=전량, 특정 관련성=그 값만
  matchStatus?: string;
  from?: string; // disclosed_at >=
  to?: string; // disclosed_at <=
}

export interface RagSearchHit {
  originalText?: BriefingEvidence["originalText"];
  qualityInputKind?: BriefingEvidence["qualityInputKind"];
  signalId: string;
  source: string;
  companyName: string | null;
  reportName: string | null;
  signalType: string;
  signalGrade: string;
  disclosedAt: string | null;
  url: string | null;
  facilityId: string | null;
  facilityName: string | null;
  matchStatus: string;
  status: string;
  summary: string | null;
  content: string; // 현재 원자료로 재구성한 브리핑 컨텍스트
  score: number | null; // 코사인 유사도(0~1). 키워드 폴백이면 null
}

function mapHit(row: Record<string, unknown>): RagSearchHit {
  return {
    ...signalOriginalEvidence(row),
    signalId: String(row.signal_id ?? ""),
    source: String(row.source ?? ""),
    companyName: str(row.company_name),
    reportName: str(row.report_name),
    signalType: String(row.signal_type ?? "other"),
    signalGrade: String(row.signal_grade ?? "candidate"),
    disclosedAt: str(row.disclosed_at),
    url: str(row.url),
    facilityId: str(row.facility_id),
    facilityName: str(row.facility_name),
    matchStatus: String(row.match_status ?? "unmatched"),
    status: String(row.status ?? "new"),
    summary: str(row.summary),
    content: currentSignalContent(row),
    score: row.score == null ? null : Number(row.score),
  };
}

function buildRagWhere(filter: RagSearchFilter, alias = "s."): { where: string[]; params: unknown[] } {
  const where: string[] = [legacySignalSourceCondition(alias.replace(/\.$/, "")), newsContentQualityCondition(alias.replace(/\.$/, ""))];
  const params: unknown[] = [];
  if (filter.source) where.push(sourceCondition(filter.source, params, alias));
  // 등급 기본값: excluded(무관 판정·기간 초과 강등분) 제외 — 검색·브리핑 노이즈 저감.
  // 'all' 이면 전량, 특정 등급이면 그 등급만.
  if (filter.grade === undefined || filter.grade === "") {
    where.push(`${alias}signal_grade <> 'excluded'`);
  } else if (filter.grade !== "all") {
    params.push(filter.grade); where.push(`${alias}signal_grade = $${params.length}`);
  }
  // 중복(변형 기사) 마킹 건은 검색 모수에서 상시 제외 — 대표 신호가 같은 내용을 대표한다
  where.push(`${alias}duplicate_of IS NULL`);
  // 업종 관련성 기본값: none(비제조·무관) 제외. 태깅 전(NULL) 신호는 안전하게 포함.
  if (filter.relevance === undefined || filter.relevance === "") {
    where.push(`(${alias}industry_relevance IS NULL OR ${alias}industry_relevance <> 'none')`);
  } else if (filter.relevance !== "all") {
    params.push(filter.relevance); where.push(`${alias}industry_relevance = $${params.length}`);
  }
  if (filter.matchStatus) { params.push(filter.matchStatus); where.push(`${alias}match_status = $${params.length}`); }
  if (filter.from) { params.push(filter.from); where.push(`${alias}disclosed_at >= $${params.length}`); }
  if (filter.to) { params.push(filter.to); where.push(`${alias}disclosed_at <= $${params.length}`); }
  return { where, params };
}

const HIT_SELECT = `
  SELECT s.signal_id, s.source, s.company_name, s.report_name, s.signal_type, s.signal_grade,
         s.disclosed_at, s.url, s.facility_id, f.company_name AS facility_name,
         s.match_status, s.status, s.summary, to_jsonb(s) AS signal_snapshot, e.content`;

/**
 * 질의 → 유사 신호 검색. 벡터(코사인) 기본, 임베딩 키 없으면 키워드(ILIKE) 폴백.
 * 반환은 유사도 내림차순.
 */
export async function searchSimilarSignals(
  question: string,
  filter: RagSearchFilter = {},
  topK = 12
): Promise<{ hits: RagSearchHit[]; mode: "vector" | "keyword" }> {
  const db = await getDb();
  const k = Math.min(Math.max(1, topK), 40);

  if (isEmbeddingConfigured()) {
    const vectors = await embedTexts([question], "query");
    if (!vectors || !vectors.length) {
      throw new Error("질의 임베딩에 실패했습니다. VOYAGE_API_KEY 또는 네트워크를 확인하세요.");
    }
    const { where, params } = buildRagWhere(filter);
    params.push(toVectorLiteral(vectors[0]));
    const vecParam = `$${params.length}::vector`;
    const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const rows = rowsToObjects(
      await db.exec(
        `${HIT_SELECT}, 1 - (e.embedding <=> ${vecParam}) AS score
           FROM intel_embeddings e
           JOIN intel_signals s ON s.signal_id = e.signal_id
           LEFT JOIN facilities f ON f.facility_id = s.facility_id
          ${whereSql}
          ORDER BY e.embedding <=> ${vecParam}
          LIMIT ${k}`,
        params
      )
    );
    // 정정 전 본문으로 만들어진 벡터는 현재 자료의 순위 근거로 사용하지 않는다.
    // 재임베딩을 자동 호출하지 않고 현재 제목·요약을 대상으로 한 키워드 검색으로 전환한다.
    if (rows.every(isSignalEmbeddingCurrent)) return { hits: rows.map(mapHit), mode: "vector" };
  }

  // 키워드 폴백 — 질문에서 2자 이상 토큰 추출해 OR 매칭(간이).
  const tokens = question.split(/[\s,./·]+/).map((t) => t.trim()).filter((t) => t.length >= 2).slice(0, 6);
  const { where, params } = buildRagWhere(filter);
  if (tokens.length) {
    const ors = tokens.map((t) => {
      params.push(`%${t}%`);
      return `(s.company_name ILIKE $${params.length} OR s.report_name ILIKE $${params.length} OR s.summary ILIKE $${params.length})`;
    });
    where.push(`(${ors.join(" OR ")})`);
  }
  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const rows = rowsToObjects(
    await db.exec(
      `${HIT_SELECT.replace(", e.content", ", COALESCE(e.content, '') AS content")}, NULL::float AS score
         FROM intel_signals s
         LEFT JOIN intel_embeddings e ON e.signal_id = s.signal_id
         LEFT JOIN facilities f ON f.facility_id = s.facility_id
        ${whereSql}
        ORDER BY s.disclosed_at DESC NULLS LAST
        LIMIT ${k}`,
      params
    )
  );
  return { hits: rows.map(mapHit), mode: "keyword" };
}

// ── 브리핑 생성 ────────────────────────────────────────────────────────

export interface RagBriefingSource {
  kind?: "signal" | "project" | "official";
  revision?: string;
  signalId: string;
  score: number | null;
  source: string;
  companyName: string | null;
  reportName: string | null;
  disclosedAt: string | null;
  facilityName: string | null;
  url: string | null;
}

export interface RagBriefing {
  canShare?: boolean;
  canManage?: boolean;
  briefingId: string;
  question: string;
  answerMd: string | null; // 구조화 실패/구버전 폴백용 마크다운(구조화 성공 시 JSON 원문)
  report: BriefingReport | null; // 구조화 리포트 — 있으면 화면은 카드로 렌더
  sources: RagBriefingSource[];
  filters: RagSearchFilter;
  model: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
}

// 구조화 리포트(화면 카드 렌더용). answer_md 컬럼에 JSON 문자열로 저장하고,
// JSON 파싱이 안 되는 구버전/폴백 브리핑은 마크다운으로 렌더한다.
export interface BriefingReport {
  kpis: Array<{ label: string; value: string; sub: string | null }>;
  trends: string[];
  companies: Array<{
    name: string;
    region: string | null;
    status: string | null;
    project: string | null;
    projectId?: string | null;
    desc: string;
    facts: Array<{ label: string; value: string }>;
    note: { kind: string; text: string } | null;
  }>;
  etcNote: string | null;
  insights: Array<{ badge: string; text: string; importance?: number }>;
}

/** Claude 응답 텍스트에서 BriefingReport JSON 추출·정규화. 실패 시 null(마크다운 폴백). */
export function parseBriefingReport(text: string): BriefingReport | null {
  const fenced = text.replace(/```json\s*|\s*```/g, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const kpis = arr(j.kpis)
    .map((k) => {
      const o = (k ?? {}) as Record<string, unknown>;
      return { label: str(o.label) ?? "", value: str(o.value) ?? "미공개", sub: str(o.sub) };
    })
    .filter((k) => k.label);
  if (!kpis.length) return null; // 최소 요건 — KPI 없으면 구조화 실패로 간주
  return {
    kpis,
    trends: arr(j.trends).map((t) => str(t)).filter((t): t is string => !!t),
    companies: separateAmbiguousProjectLinks(arr(j.companies).map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return {
        name: str(o.name) ?? "회사 미상",
        region: str(o.region),
        status: str(o.status),
        project: str(o.project),
        projectId: typeof o.projectId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(o.projectId) ? o.projectId : null,
        desc: str(o.desc) ?? "",
        facts: arr(o.facts)
          .map((f) => {
            const fo = (f ?? {}) as Record<string, unknown>;
            return { label: str(fo.label) ?? "", value: str(fo.value) ?? "" };
          })
          .filter((f) => f.label && f.value)
          .slice(0, 3),
        note: (() => {
          const n = (o.note ?? null) as Record<string, unknown> | null;
          const noteText = n ? str(n.text) : null;
          return noteText ? { kind: (n && str(n.kind)) || "참고", text: noteText } : null;
        })(),
      };
    })),
    etcNote: str(j.etcNote),
    insights: sortBriefingInsights(arr(j.insights)
      .map((i) => {
        const o = (i ?? {}) as Record<string, unknown>;
        return { badge: str(o.badge) ?? "참고", text: str(o.text) ?? "", ...(typeof o.importance === "number" && Number.isFinite(o.importance) ? { importance: o.importance } : {}) };
      })
      .filter((i) => i.text)),
  };
}

function searchHitSource(h: RagSearchHit): RagBriefingSource {
  return { signalId: h.signalId, score: h.score, source: h.source, companyName: h.companyName,
    reportName: h.reportName, disclosedAt: h.disclosedAt, facilityName: h.facilityName, url: h.url };
}

function sourceEvidence(source: RagBriefingSource, text: string, capturedAt: string, original: Pick<BriefingEvidence, "originalText" | "qualityInputKind">): BriefingEvidence {
  const kind = source.kind ?? (source.signalId.startsWith("project:") ? "project" : source.signalId.startsWith("official:") ? "official" : "signal");
  return { id: kind === "signal" ? `signal:${source.signalId}` : source.signalId,
    revision: source.revision ?? crypto.createHash("sha256").update(JSON.stringify([text, original.originalText, original.qualityInputKind])).digest("hex"), kind,
    title: source.reportName ?? source.companyName ?? "수집 신호", companyName: source.companyName,
    region: null, source: source.source, url: source.url, publishedAt: source.disclosedAt,
    discoveredAt: capturedAt, text, ...original, changed: true, amount: null, temporalClass: "initial_baseline" };
}

function sourceMetadata(sources: RagBriefingSource[], originals: RagBriefingSource[]): RagBriefingSource[] {
  const byId = new Map(originals.map(source => [source.signalId, source]));
  return sources.map(source => ({ ...byId.get(source.signalId), ...source,
    score: byId.get(source.signalId)?.score ?? source.score,
    facilityName: byId.get(source.signalId)?.facilityName ?? source.facilityName }));
}

/**
 * 질의형 브리핑 생성: 유사 신호 검색 → Claude 보고서 생성 → 이력 저장.
 */
export async function generateBriefing(
  question: string,
  filter: RagSearchFilter,
  userId: string | null
): Promise<RagBriefing> {
  const q = question.trim();
  if (!q) throw new Error("질문을 입력하세요.");
  const { hits } = await searchSimilarSignals(q, filter, 24);
  if (!hits.length) throw new Error("검색 범위에 해당하는 신호가 없습니다. 범위를 넓히거나 벡터 적재를 먼저 실행하세요.");

  const briefingId = id("irag");
  const now = new Date().toISOString();
  const originals = hits.map(searchHitSource);
  const dates = hits.map(hit => hit.disclosedAt?.slice(0, 10)).filter((date): date is string => !!date).sort();
  const generated = await curateBriefingReport({
    items: hits.map((hit, index) => sourceEvidence(originals[index], hit.content || [hit.companyName, hit.reportName, hit.summary].filter(Boolean).join(" · "), now, { originalText: hit.originalText, qualityInputKind: hit.qualityInputKind })),
    question: q, reportLevel: "detailed", context: "질문과 직접 관련된 투자·발주 계획을 영업 검토 관점에서 정리합니다. 사업기간이 근거에 없으면 미공개로 표시합니다. 검색한 신호는 전체 시장 통계가 아닙니다.",
    feature: "intel.rag_briefing", model: BRIEFING_MODEL, userId, subject: { type: "briefing", id: briefingId },
    kpis: [
      { label: "수집 신호", value: `${hits.length}건`, sub: "질문과 관련된 검색 결과" },
      { label: "식별 기업", value: `${new Set(hits.map(hit => hit.companyName).filter(Boolean)).size}개`, sub: "검색 결과 내 기업명 기준" },
      { label: "발표일 범위", value: dates.length ? dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} ~ ${dates[dates.length - 1]}` : "미공개", sub: "확인된 공개일 기준" },
      { label: "분석 기준", value: now.slice(0, 10), sub: "현재 검색 결과로 분석" },
    ], etcNote: "수치는 질문에 대한 검색 결과 범위이며 시장 전체 집계가 아닙니다.",
  });
  const report = generated.report, answerMd = JSON.stringify(report);
  const sources = sourceMetadata(generated.sources, originals);
  await withDbWrite(async (wdb) => {
    await wdb.run(
      `INSERT INTO intel_rag_briefings
         (briefing_id, question, answer_md, sources, filters, model, status, created_by, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, 'done', $7, $8)`,
      [briefingId, q, answerMd, JSON.stringify(sources), JSON.stringify(filter), generated.model, userId, now]
    );
  });
  return {
    briefingId, question: q, answerMd, report, sources, filters: filter,
    model: generated.model, status: "done", createdBy: userId, createdAt: now,
  };
}

/**
 * 브리핑 추가 분석(보강): 기존 리포트 + 추가 질문으로 재생성해 같은 브리핑을 업데이트한다.
 * 기존 출처 번호([n] 인용)를 보존하기 위해 기존 sources 순서는 유지하고, 추가 검색으로
 * 새로 발견된 신호만 뒤에 이어 붙인다.
 */
export async function refineBriefing(
  briefingId: string,
  instruction: string,
  _userId: string | null
): Promise<RagBriefing> {
  const inst = instruction.trim();
  if (!inst) throw new Error("추가 분석 요청 내용을 입력하세요.");
  const briefing = await getBriefing(briefingId);
  if (!briefing) throw new Error("브리핑을 찾을 수 없습니다.");
  if (!briefing.report) throw new Error("구버전(비구조화) 브리핑은 추가 분석을 지원하지 않습니다. 새로 생성해 주세요.");

  // 구형 수동 보고서 보강은 현재 원자료, 정기 보고서 보강은 발행 당시 snapshot을 사용한다.
  const db = await getDb();
  const ids = briefing.sources.map((s) => s.signalId);
  const evidenceIds = [...new Set(ids.flatMap(value => [value, value.replace(/^(signal|project):/, "")]))];
  const heldEvidence = rowsToObjects(await db.exec(`SELECT s.signal_id FROM intel_signals s WHERE
    (s.signal_id=ANY($1::text[]) OR EXISTS(SELECT 1 FROM intel_project_signals ps WHERE ps.signal_id=s.signal_id AND ps.project_id=ANY($1::text[])))
    AND NOT (${newsContentQualityCondition()}) LIMIT 1`, [evidenceIds]));
  if (heldEvidence.length) throw new Error("기존 근거 중 제목·내용 재검증이 필요한 수집 자료가 있습니다. 검증을 완료한 자료로 새 브리핑을 생성하세요.");
  const metadata = rowsToObjects(await db.exec("SELECT to_jsonb(b)->>'access_scope' AS scope,to_jsonb(b)->>'profile_id' AS profile_id,to_jsonb(b)->>'snapshot_id' AS snapshot_id FROM intel_rag_briefings b WHERE briefing_id=$1", [briefingId]))[0];
  const immutable = metadata?.scope === "restricted";
  const currentHits = new Map<string, RagSearchHit>();
  const snapshotItems = new Map<string, BriefingEvidence>();
  if (ids.length && !immutable) {
    const rows = rowsToObjects(
      await db.exec(`${HIT_SELECT} FROM intel_signals s LEFT JOIN intel_embeddings e ON e.signal_id=s.signal_id
        LEFT JOIN facilities f ON f.facility_id=s.facility_id WHERE s.signal_id=ANY($1::text[])
        AND ${legacySignalSourceCondition()} AND ${newsContentQualityCondition()}`, [ids])
    );
    for (const r of rows) currentHits.set(String(r.signal_id), mapHit(r));
  }
  if (immutable && metadata.snapshot_id) {
    const rows = rowsToObjects(await db.exec("SELECT payload FROM intel_briefing_snapshots WHERE snapshot_id=$1", [metadata.snapshot_id]));
    const payload = rows[0]?.payload as { items?: BriefingEvidence[] } | undefined;
    for (const e of payload?.items ?? []) snapshotItems.set(e.id.startsWith("signal:") ? e.id.slice(7) : e.id, e);
  }

  // 추가 질문으로 신규 신호 검색 — 기존 출처에 없는 것만 뒤에 append
  let newHits: RagSearchHit[] = [];
  try {
    const { hits } = immutable ? { hits: [] as RagSearchHit[] } : await searchSimilarSignals(inst, briefing.filters, 12);
    const seen = new Set(ids);
    newHits = hits.filter((h) => !seen.has(h.signalId));
  } catch {
    // 추가 검색 실패는 치명적이지 않다 — 기존 출처만으로 보강 진행
  }

  const capturedAt = new Date().toISOString();
  const existingSources = immutable ? briefing.sources : briefing.sources.map(source => {
    const current = currentHits.get(source.signalId);
    if (!current) throw new Error("기존 원자료를 확인할 수 없어 추가 분석을 보류했습니다. 현재 자료로 새 브리핑을 생성하세요.");
    return { ...source, ...searchHitSource(current) };
  });
  const originals = [...existingSources, ...newHits.map(searchHitSource)];
  const items = existingSources.map(source => {
    const snapshot = snapshotItems.get(source.signalId);
    if (snapshot) return snapshot;
    if (immutable) throw new Error("발행 당시의 근거가 없어 추가 분석을 진행할 수 없습니다.");
    const hit = currentHits.get(source.signalId)!;
    return sourceEvidence(source, hit.content, capturedAt, { originalText: hit.originalText, qualityInputKind: hit.qualityInputKind });
  });
  newHits.forEach(hit => items.push(sourceEvidence(searchHitSource(hit), hit.content || [hit.companyName, hit.reportName, hit.summary].filter(Boolean).join(" · "), capturedAt, { originalText: hit.originalText, qualityInputKind: hit.qualityInputKind })));
  const generated = await curateBriefingReport({
    items, question: briefing.question, reportLevel: "detailed", preserveSourceOrder: true,
    linkedProjectMetadata: immutable ? [...snapshotItems.values()].filter(item => item.kind === "project") : undefined,
    requireOfficialBackground: immutable,
    context: `사용자 보강 요청: ${inst}\n현재 브리핑(JSON, 편집 참고용):\n${JSON.stringify(briefing.report)}\n기존 내용은 현재 제공된 근거로 확인되는 범위에서 유지하고 반복은 통합합니다. 현재 브리핑 서술 자체를 새 사실의 근거로 사용하지 않습니다. 기존 [n]은 입력 근거 순서와 같으며 보강 후에도 유지합니다. 새 근거는 마지막 번호 뒤에 추가합니다.`,
    feature: "intel.rag_briefing:refine", model: BRIEFING_MODEL, userId: _userId, subject: { type: "briefing", id: briefingId },
    kpis: briefing.report.kpis.map(kpi => kpi.label === "수집 신호" && !immutable ? { ...kpi, value: `${originals.length}건`, sub: "기존 및 추가 검색 근거" } : kpi),
    etcNote: briefing.report.etcNote,
  });
  const report = generated.report, answerMd = JSON.stringify(report);
  const mergedSources = sourceMetadata(generated.sources, originals);
  const resultId = immutable ? id("irag") : briefingId;
  await withDbWrite(async (wdb) => {
    if (immutable) {
      await wdb.run(`INSERT INTO intel_rag_briefings(briefing_id,question,answer_md,sources,filters,model,status,created_by,created_at,access_scope,profile_id,snapshot_id,schema_version,previous_briefing_id) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,'done',$7,$8,'restricted',$9,$10,2,$11)`, [resultId, briefing.question, answerMd, JSON.stringify(mergedSources), JSON.stringify(briefing.filters), generated.model, _userId, new Date().toISOString(), metadata.profile_id, metadata.snapshot_id, briefingId]);
      return;
    }
    await wdb.run(
      `UPDATE intel_rag_briefings SET answer_md = $1, sources = $2::jsonb, model = $3 WHERE briefing_id = $4`,
      [answerMd, JSON.stringify(mergedSources), generated.model, briefingId]
    );
  });
  return { ...briefing, briefingId: resultId, answerMd, report, sources: mergedSources, model: generated.model };
}

// ── 브리핑 공유 ────────────────────────────────────────────────────────

export interface SharedBriefing extends RagBriefing {
  shareId: string;
  sharedBy: string | null;
  sharedByName: string | null;
  sharedAt: string;
  readAt: string | null;
}

/** 내가 공유받은 브리핑 목록(최신순). */
export async function listSharedBriefings(userId: string, limit = 20): Promise<SharedBriefing[]> {
  await assertBriefingCapability(userId, "view");
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT b.briefing_id, b.question, b.answer_md, b.sources, b.filters, b.model, b.status, b.created_by, b.created_at, to_jsonb(b)->>'access_scope' AS access_scope,
              sh.share_id, sh.shared_by, sh.created_at AS shared_at, sh.read_at,
              ep.name AS shared_by_name, ${briefingOwnerSql()} AS briefing_owner_id
         FROM intel_rag_briefing_shares sh
         JOIN intel_rag_briefings b ON b.briefing_id = sh.briefing_id
         LEFT JOIN employee_profiles ep ON ep.user_id = sh.shared_by
        WHERE sh.recipient_user_id = $1
          AND ${briefingVisibilitySql()}
        ORDER BY sh.created_at DESC
        LIMIT ${Math.min(Math.max(1, limit), 100)}`,
      [userId]
    )
  );
  return (await visibleBriefingRows(rows, userId)).map((r) => ({
    ...mapBriefing(r),
    shareId: String(r.share_id ?? ""),
    sharedBy: str(r.shared_by),
    sharedByName: str(r.shared_by_name),
    sharedAt: String(r.shared_at ?? ""),
    readAt: str(r.read_at),
  }));
}

/** 공유받은 브리핑 열람 마킹. */
export async function markShareRead(briefingId: string, userId: string): Promise<void> {
  await withDbWrite(async (wdb) => {
    await wdb.run(
      `UPDATE intel_rag_briefing_shares SET read_at = $1
        WHERE briefing_id = $2 AND recipient_user_id = $3 AND read_at IS NULL`,
      [new Date().toISOString(), briefingId, userId]
    );
  });
}

function mapBriefing(row: Record<string, unknown>): RagBriefing {
  const parse = (v: unknown): unknown => {
    try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; }
  };
  const sources = parse(row.sources);
  const filters = parse(row.filters);
  const answerMd = str(row.answer_md);
  return {
    briefingId: String(row.briefing_id ?? ""),
    question: String(row.question ?? ""),
    answerMd,
    report: answerMd ? parseBriefingReport(answerMd) : null,
    sources: Array.isArray(sources) ? (sources as RagBriefingSource[]) : [],
    filters: filters && typeof filters === "object" ? (filters as RagSearchFilter) : {},
    model: str(row.model),
    status: String(row.status ?? "done"),
    createdBy: str(row.created_by),
    createdAt: String(row.created_at ?? ""),
    canShare: row.can_share === true,
    canManage: row.can_manage === true,
  };
}

async function visibleBriefingRows(rows: Record<string, unknown>[], userId: string | null): Promise<Record<string, unknown>[]> {
  if (!userId) return [];
  const caps = await getBriefingCapabilities(userId);
  const { assertBriefingAccess } = await import("./briefing-store");
  const result: Record<string, unknown>[] = [];
  for (const row of rows) {
    try { assertLegacyBriefingSourcePolicy(row); }
    catch (error) { if ((error as { status?: number }).status === 403) continue; throw error; }
    try { await assertBriefingAccess(String(row.briefing_id), userId); }
    catch (error) { if ([403,404].includes((error as { status?: number }).status ?? 0)) continue; throw error; }
    row.can_manage = row.briefing_owner_id === userId && caps.canCreate;
    row.can_share = row.briefing_owner_id === userId && caps.canShare;
    result.push(row);
  }
  return result;
}
export async function listBriefings(limit = 20, userId: string | null = null): Promise<RagBriefing[]> {
  if (!userId) return [];
  await assertBriefingCapability(userId, "view");
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT b.briefing_id, b.question, b.answer_md, b.sources, b.filters, b.model, b.status, b.created_by, b.created_at, to_jsonb(b)->>'access_scope' AS access_scope, ${briefingOwnerSql()} AS briefing_owner_id
         FROM intel_rag_briefings b
        WHERE ${briefingVisibilitySql()}
        ORDER BY b.created_at DESC
        LIMIT ${Math.min(Math.max(1, limit), 100)}`, [userId]
    )
  );
  return (await visibleBriefingRows(rows, userId)).map(mapBriefing);
}

export async function getBriefing(briefingId: string, userId?: string): Promise<RagBriefing | null> {
  if (userId) { const { assertBriefingAccess } = await import("./briefing-store"); await assertBriefingAccess(briefingId, userId); }
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT b.briefing_id, b.question, b.answer_md, b.sources, b.filters, b.model, b.status, b.created_by, b.created_at,to_jsonb(b)->>'access_scope' AS access_scope, ${briefingOwnerSql()} AS briefing_owner_id
         FROM intel_rag_briefings b WHERE b.briefing_id = $1 LIMIT 1`,
      [briefingId]
    )
  );
  if (rows.length) assertLegacyBriefingSourcePolicy(rows[0]);
  if (rows.length && userId) { const caps = await getBriefingCapabilities(userId); rows[0].can_share = rows[0].briefing_owner_id === userId && caps.canShare; rows[0].can_manage = rows[0].briefing_owner_id === userId && caps.canCreate; }
  return rows.length ? mapBriefing(rows[0]) : null;
}

export async function deleteBriefing(briefingId: string): Promise<void> {
  await withDbWrite(async (wdb) => {
    await wdb.run(`DELETE FROM intel_rag_briefings WHERE briefing_id = $1`, [briefingId]);
  });
}

// ── 현황 · 발굴 후보 ───────────────────────────────────────────────────

export interface RagStatus {
  embeddingReady: boolean; // VOYAGE_API_KEY
  briefingReady: boolean; // ANTHROPIC_API_KEY
  totalSignals: number;
  embedded: number;
  duplicates: number; // 중복 병합 마킹 누계(검색 모수에서 제외됨)
  bySource: Array<{ source: string; total: number; embedded: number }>;
  briefingCount: number;
}

export async function getRagStatus(): Promise<RagStatus> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT s.source, COUNT(*)::int AS total, COUNT(e.signal_id)::int AS embedded
         FROM intel_signals s
         LEFT JOIN intel_embeddings e ON e.signal_id = s.signal_id
        WHERE ${legacySignalSourceCondition()} AND ${newsContentQualityCondition()}
        GROUP BY s.source
        ORDER BY total DESC`
    )
  );
  const bySource = rows.map((r) => ({
    source: String(r.source ?? ""),
    total: Number(r.total ?? 0),
    embedded: Number(r.embedded ?? 0),
  }));
  const briefingRows = rowsToObjects(
    await db.exec(`SELECT COUNT(*)::int AS cnt FROM intel_rag_briefings`)
  );
  const dupRows = rowsToObjects(
    await db.exec(`SELECT COUNT(*)::int AS cnt FROM intel_signals WHERE duplicate_of IS NOT NULL`)
  );
  return {
    embeddingReady: isEmbeddingConfigured(),
    briefingReady: !!process.env.ANTHROPIC_API_KEY,
    totalSignals: bySource.reduce((a, r) => a + r.total, 0),
    embedded: bySource.reduce((a, r) => a + r.embedded, 0),
    duplicates: Number(dupRows[0]?.cnt ?? 0),
    bySource,
    briefingCount: Number(briefingRows[0]?.cnt ?? 0),
  };
}

export interface DiscoveryCandidate {
  signalId: string;
  source: string;
  companyName: string | null;
  reportName: string | null;
  signalType: string;
  signalGrade: string;
  disclosedAt: string | null;
  facilityId: string | null;
  facilityName: string | null;
  status: string;
  summary: string | null;
  industry: string | null;
  industryRelevance: string | null;
  relevanceNote: string | null;
}

/**
 * 영업 발굴 후보 — 사업장 매칭 + 확정/후보 등급 + 미전환(new/reviewed) 신호.
 * direct(대상 업종 직접) 우선 정렬, supply_chain 은 유발 경로와 함께 노출. none 은 제외.
 */
export async function listDiscoveryCandidates(limit = 30): Promise<DiscoveryCandidate[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT s.signal_id, s.source, s.company_name, s.report_name, s.signal_type, s.signal_grade,
              s.disclosed_at, s.facility_id, f.company_name AS facility_name, s.status, s.summary,
              s.industry, s.industry_relevance, s.relevance_note
         FROM intel_signals s
         JOIN facilities f ON f.facility_id = s.facility_id
        WHERE s.match_status = 'matched'
          AND ${legacySignalSourceCondition()} AND ${newsContentQualityCondition()}
          AND s.signal_grade IN ('confirmed','candidate')
          AND s.status IN ('new','reviewed')
          AND s.duplicate_of IS NULL
          AND COALESCE(s.industry_relevance, '') <> 'none'
        ORDER BY CASE s.industry_relevance
                   WHEN 'direct' THEN 0 WHEN 'supply_chain' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
                 s.disclosed_at DESC NULLS LAST, s.created_at DESC
        LIMIT ${Math.min(Math.max(1, limit), 100)}`
    )
  );
  return rows.map((r) => ({
    signalId: String(r.signal_id ?? ""),
    source: String(r.source ?? ""),
    companyName: str(r.company_name),
    reportName: str(r.report_name),
    signalType: String(r.signal_type ?? "other"),
    signalGrade: String(r.signal_grade ?? "candidate"),
    disclosedAt: str(r.disclosed_at),
    facilityId: str(r.facility_id),
    facilityName: str(r.facility_name),
    status: String(r.status ?? "new"),
    summary: str(r.summary),
    industry: str(r.industry),
    industryRelevance: str(r.industry_relevance),
    relevanceNote: str(r.relevance_note),
  }));
}
