// RAG & 영업 발굴 (D단계) — 벡터 유사도 검색, 질의형 브리핑 생성, 브리핑 이력, 발굴 후보.
// 검색: pgvector 코사인(intel_embeddings) 기본, VOYAGE_API_KEY 없으면 키워드(ILIKE) 폴백.
// 브리핑: 검색 결과를 컨텍스트로 Claude(Anthropic Messages API 직접 호출)가 마크다운 보고서 생성.

import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { embedTexts, isEmbeddingConfigured, toVectorLiteral } from "./embeddings";
import { sourceCondition } from "./intel-queries";

const BRIEFING_MODEL = process.env.INTEL_RAG_MODEL || "claude-sonnet-5";
const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";

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
  matchStatus?: string;
  from?: string; // disclosed_at >=
  to?: string; // disclosed_at <=
}

export interface RagSearchHit {
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
  content: string; // 임베딩 문서 텍스트(브리핑 컨텍스트)
  score: number | null; // 코사인 유사도(0~1). 키워드 폴백이면 null
}

function mapHit(row: Record<string, unknown>): RagSearchHit {
  return {
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
    content: String(row.content ?? ""),
    score: row.score == null ? null : Number(row.score),
  };
}

function buildRagWhere(filter: RagSearchFilter, alias = "s."): { where: string[]; params: unknown[] } {
  const where: string[] = [];
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
  if (filter.matchStatus) { params.push(filter.matchStatus); where.push(`${alias}match_status = $${params.length}`); }
  if (filter.from) { params.push(filter.from); where.push(`${alias}disclosed_at >= $${params.length}`); }
  if (filter.to) { params.push(filter.to); where.push(`${alias}disclosed_at <= $${params.length}`); }
  return { where, params };
}

const HIT_SELECT = `
  SELECT s.signal_id, s.source, s.company_name, s.report_name, s.signal_type, s.signal_grade,
         s.disclosed_at, s.url, s.facility_id, f.company_name AS facility_name,
         s.match_status, s.status, s.summary, e.content`;

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
    return { hits: rows.map(mapHit), mode: "vector" };
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

const BRIEFING_SYSTEM =
  "당신은 통합환경허가(IEPS) 대행사의 영업 인텔리전스 애널리스트입니다. " +
  "제공된 발주 신호(DART 공시·환경영향평가·보도자료·뉴스·산단 고시)만 근거로 한국어 브리핑 리포트를 작성합니다. " +
  "핵심 임무는 개별 신호 나열이 아니라, 신호들을 종합해 동향을 항목별로 일목요연하게 정리하는 것입니다. " +
  "근거 없는 추정은 하지 않고, 신호에 없는 내용은 '미공개' 또는 '수집된 신호 없음'이라고 명시합니다. " +
  "각 사실 뒤에 반드시 근거 신호 번호를 [1], [2] 형태로 인용합니다. " +
  "반드시 JSON 하나만 출력하고 코드펜스·그 외 설명은 쓰지 않습니다.";

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
    desc: string;
    facts: Array<{ label: string; value: string }>;
    note: { kind: string; text: string } | null;
  }>;
  etcNote: string | null;
  insights: Array<{ badge: string; text: string }>;
}

function buildBriefingPrompt(question: string, hits: RagSearchHit[]): string {
  const ctx = hits
    .map((h, i) => {
      const head = `[${i + 1}] (${h.source}${h.disclosedAt ? ` / ${h.disclosedAt.slice(0, 10)}` : ""})`;
      const body = h.content || [h.companyName, h.reportName, h.summary].filter(Boolean).join(" · ");
      return `${head}\n${body.slice(0, 700)}`;
    })
    .join("\n\n");
  return (
    `아래는 수집된 발주 신호 ${hits.length}건입니다.\n\n${ctx}\n\n---\n\n` +
    `질문: ${question}\n\n` +
    "위 신호만 근거로 브리핑 리포트를 아래 JSON 스키마로 출력하세요(JSON만, 코드펜스 없이). " +
    "모든 텍스트 값은 한국어이고, 강조는 **굵게**, 근거는 [n] 형태로 문장 안에 넣습니다.\n\n" +
    "{\n" +
    '  "kpis": [  // 정확히 4개 — 질문과 관련된 신호를 종합한 핵심 지표. label 은 상황에 맞게(예: 수집 신호/총 투자규모/투자 예정지/완공 목표·투자 시기). 값이 없으면 value 를 "미공개"로.\n' +
    '    {"label": "수집 신호", "value": "N건", "sub": "핵심만 담은 짧은 한 줄(20자 이내, 인용 최대 2개) [1][2]"}\n' +
    "  ],\n" +
    '  "trends": [  // 핵심 동향 1~3개 — 가장 중요한 흐름을 문장으로. **회사/키워드** — 설명 [n] 형태.\n' +
    '    "**회사명** — 동향 설명 [3]"\n' +
    "  ],\n" +
    '  "companies": [  // 투자계획 상세 — 질문과 직접 관련된 회사/사업만, 중요도순 최대 6개. 관련 신호가 없으면 빈 배열.\n' +
    "    {\n" +
    '      "name": "회사명", "region": "지역(시·군) 또는 null", "status": "진행 상태 짧게(예: 전환 증설 · 진행 중) 또는 null",\n' +
    '      "project": "사업/프로젝트 한 줄 제목 또는 null",\n' +
    '      "desc": "위치·규모·금액·진행단계·시점을 간결한 2~3문장으로. 각 문장은 마침표로 끝내고(화면에서 문장 단위 줄바꿈됨) 신호번호 인용 [3]",\n' +
    '      "facts": [{"label": "규모", "value": "1만6000톤"}],  // 확인된 수치만 최대 3개(규모/금액/완공목표/착수시기 등). 없으면 빈 배열\n' +
    '      "note": {"kind": "기회", "text": "통합환경허가 영업 관점 한 줄"} 또는 null  // kind: 기회|리스크|참고\n' +
    "    }\n" +
    "  ],\n" +
    '  "etcNote": "다루지 않은 나머지 신호를 40자 이내 한 문장으로(예: 그 외 N건은 반도체·전력 등 무관 신호로 확인). 인용 번호는 문장 끝에 모아서 [1][2][4]. 없으면 null",\n' +
    '  "insights": [  // 영업 시사점 2~4개. badge: 우선 접촉|차순위|타이밍|한계|참고 중 선택.\n' +
    '    {"badge": "우선 접촉", "text": "**대상** — 근거와 제안 [3]"}\n' +
    "  ]\n" +
    "}"
  );
}

/** Claude 응답 텍스트에서 BriefingReport JSON 추출·정규화. 실패 시 null(마크다운 폴백). */
function parseBriefingReport(text: string): BriefingReport | null {
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
    companies: arr(j.companies).map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return {
        name: str(o.name) ?? "회사 미상",
        region: str(o.region),
        status: str(o.status),
        project: str(o.project),
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
    }),
    etcNote: str(j.etcNote),
    insights: arr(j.insights)
      .map((i) => {
        const o = (i ?? {}) as Record<string, unknown>;
        return { badge: str(o.badge) ?? "참고", text: str(o.text) ?? "" };
      })
      .filter((i) => i.text),
  };
}

/**
 * Anthropic Messages API 직접 호출(news-classifier 패턴). 실패 시 Error throw.
 * ⚠ claude-sonnet-5 는 기본으로 thinking 블록을 생성하며 max_tokens 가 thinking+본문 합산에
 * 적용된다 — 부족하면 본문이 중간에 잘리므로(stop_reason=max_tokens) 넉넉히 잡고 잘림을 검사한다.
 */
async function callClaude(system: string, prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY가 설정되지 않아 브리핑을 생성할 수 없습니다.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: BRIEFING_MODEL,
        max_tokens: 10000,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`브리핑 생성 API 오류 (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
    };
    let text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
    if (!text) throw new Error("브리핑 생성 응답이 비어 있습니다.");
    if (data.stop_reason === "max_tokens") {
      text += "\n\n*(분량 제한으로 뒷부분이 생략되었습니다 — 기간·소스 필터로 범위를 좁혀 다시 생성해 보세요.)*";
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
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

  const answerMd = await callClaude(BRIEFING_SYSTEM, buildBriefingPrompt(q, hits));
  const report = parseBriefingReport(answerMd); // 실패 시 null → 응답 텍스트를 마크다운으로 표시
  // JSON 형태인데 파싱 불가(잘림·형식 오류)면 원문 JSON 조각이 노출되므로 저장하지 않는다.
  if (!report && answerMd.trimStart().startsWith("{")) {
    throw new Error("브리핑 구조화 응답 파싱에 실패했습니다. 다시 생성해 주세요.");
  }
  const sources: RagBriefingSource[] = hits.map((h) => ({
    signalId: h.signalId,
    score: h.score,
    source: h.source,
    companyName: h.companyName,
    reportName: h.reportName,
    disclosedAt: h.disclosedAt,
    facilityName: h.facilityName,
    url: h.url,
  }));

  const briefingId = id("irag");
  const now = new Date().toISOString();
  await withDbWrite(async (wdb) => {
    await wdb.run(
      `INSERT INTO intel_rag_briefings
         (briefing_id, question, answer_md, sources, filters, model, status, created_by, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, 'done', $7, $8)`,
      [briefingId, q, answerMd, JSON.stringify(sources), JSON.stringify(filter), BRIEFING_MODEL, userId, now]
    );
  });
  return {
    briefingId, question: q, answerMd, report, sources, filters: filter,
    model: BRIEFING_MODEL, status: "done", createdBy: userId, createdAt: now,
  };
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
  };
}

export async function listBriefings(limit = 20): Promise<RagBriefing[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT briefing_id, question, answer_md, sources, filters, model, status, created_by, created_at
         FROM intel_rag_briefings
        ORDER BY created_at DESC
        LIMIT ${Math.min(Math.max(1, limit), 100)}`
    )
  );
  return rows.map(mapBriefing);
}

export async function getBriefing(briefingId: string): Promise<RagBriefing | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT briefing_id, question, answer_md, sources, filters, model, status, created_by, created_at
         FROM intel_rag_briefings WHERE briefing_id = $1 LIMIT 1`,
      [briefingId]
    )
  );
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
}

/**
 * 영업 발굴 후보 — 사업장 매칭 + 확정/후보 등급 + 미전환(new/reviewed) 신호.
 * "정제된 후보군"으로 RAG 브리핑과 함께 영업 착수 대상을 보여준다.
 */
export async function listDiscoveryCandidates(limit = 30): Promise<DiscoveryCandidate[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT s.signal_id, s.source, s.company_name, s.report_name, s.signal_type, s.signal_grade,
              s.disclosed_at, s.facility_id, f.company_name AS facility_name, s.status, s.summary
         FROM intel_signals s
         JOIN facilities f ON f.facility_id = s.facility_id
        WHERE s.match_status = 'matched'
          AND s.signal_grade IN ('confirmed','candidate')
          AND s.status IN ('new','reviewed')
          AND s.duplicate_of IS NULL
        ORDER BY s.disclosed_at DESC NULLS LAST, s.created_at DESC
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
  }));
}
