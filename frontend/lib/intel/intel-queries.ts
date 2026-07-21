// intel_signals 조회·상태변경·영업건 전환 쿼리. API & RAG 1차.

import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { createSalesProject } from "@/lib/sales/queries";
import { measureTopSimilarity, recordSignalFeedback, type FeedbackReason } from "./intel-feedback";
import { INTEL_SIGNAL_TYPE_LABELS, type IntelSignalType, type IntelSignalGrade } from "./signal-extractor";

const text = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface IntelSignal {
  signalId: string;
  source: string;
  externalId: string;
  corpCode: string | null;
  companyName: string | null;
  brn: string | null;
  reportName: string | null;
  signalType: IntelSignalType;
  signalGrade: IntelSignalGrade;
  assetClass: string | null;
  acquirePurpose: string | null;
  counterparty: string | null;
  disclosedAt: string | null;
  amount: number | null;
  url: string | null;
  facilityId: string | null;
  facilityName: string | null;
  matchStatus: string; // matched | unmatched | ignored
  matchType: string; // direct | counterparty
  linkedProjectId: string | null;
  status: string; // new | reviewed | converted | dismissed
  duplicateOf: string | null; // 중복(변형 기사)이면 대표 신호 ID
  industry: string | null; // 통합허가 대상 업종 id
  industryRelevance: string | null; // direct | supply_chain | low | none
  relevanceNote: string | null; // supply_chain 유발 경로
  createdAt: string;
  updatedAt: string;
}

export interface IntelSignalFilter {
  /** dart|eiass|press|news|gosi 또는 gosi 채널 분리(gosi_eum=토지이음, gosi_me=유역청) */
  source?: string;
  signalType?: string;
  matchStatus?: string;
  status?: string;
  grade?: string; // 미지정=confirmed+candidate 기본, 'all'=전체, 특정등급=그 등급만
  includeDuplicates?: boolean; // 기본 false — 중복(변형 기사) 마킹 건 제외
  relevance?: string; // 업종 관련성 필터(direct/supply_chain/low/none). 미지정=전체 노출
  q?: string;
  from?: string; // disclosed_at >=
  to?: string; // disclosed_at <=
  limit?: number;
  offset?: number;
}

function mapSignal(row: Record<string, unknown>): IntelSignal {
  return {
    signalId: String(row.signal_id ?? ""),
    source: String(row.source ?? ""),
    externalId: String(row.external_id ?? ""),
    corpCode: text(row.corp_code),
    companyName: text(row.company_name),
    brn: text(row.brn),
    reportName: text(row.report_name),
    signalType: (String(row.signal_type ?? "other") as IntelSignalType),
    signalGrade: (String(row.signal_grade ?? "candidate") as IntelSignalGrade),
    assetClass: text(row.asset_class),
    acquirePurpose: text(row.acquire_purpose),
    counterparty: text(row.counterparty),
    disclosedAt: text(row.disclosed_at),
    amount: num(row.amount),
    url: text(row.url),
    facilityId: text(row.facility_id),
    facilityName: text(row.facility_name),
    matchStatus: String(row.match_status ?? "unmatched"),
    matchType: String(row.match_type ?? "direct"),
    linkedProjectId: text(row.linked_project_id),
    status: String(row.status ?? "new"),
    duplicateOf: text(row.duplicate_of),
    industry: text(row.industry),
    industryRelevance: text(row.industry_relevance),
    relevanceNote: text(row.relevance_note),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

const SIGNAL_SELECT = `
  SELECT s.signal_id, s.source, s.external_id, s.corp_code, s.company_name, s.brn, s.report_name,
         s.signal_type, s.signal_grade, s.asset_class, s.acquire_purpose, s.counterparty,
         s.disclosed_at, s.amount, s.url, s.facility_id, f.company_name AS facility_name,
         s.match_status, s.match_type, s.linked_project_id, s.status, s.duplicate_of,
         s.industry, s.industry_relevance, s.relevance_note, s.created_at, s.updated_at
    FROM intel_signals s
    LEFT JOIN facilities f ON f.facility_id = s.facility_id`;

/** gosi 채널 분리(gosi_eum/gosi_me)를 포함한 소스 WHERE 절 생성. rag-queries 에서도 재사용. */
export function sourceCondition(source: string, params: unknown[], alias = "s."): string {
  if (source === "gosi_eum" || source === "gosi_me") {
    params.push(source === "gosi_eum" ? "eum" : "me");
    return `${alias}source = 'gosi' AND COALESCE(${alias}raw_json->>'channel','me') = $${params.length}`;
  }
  params.push(source);
  return `${alias}source = $${params.length}`;
}

function buildSignalWhere(filter: IntelSignalFilter): { where: string[]; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.source) where.push(sourceCondition(filter.source, params));
  if (filter.signalType) { params.push(filter.signalType); where.push(`s.signal_type = $${params.length}`); }
  if (filter.matchStatus) { params.push(filter.matchStatus); where.push(`s.match_status = $${params.length}`); }
  if (filter.status) { params.push(filter.status); where.push(`s.status = $${params.length}`); }
  // grade 기본값: confirmed+candidate 노출. 'all'=제약없음, 특정등급=그 등급만.
  if (filter.grade === undefined) {
    where.push(`s.signal_grade IN ('confirmed','candidate')`);
  } else if (filter.grade !== "all") {
    params.push(filter.grade); where.push(`s.signal_grade = $${params.length}`);
  }
  // 중복(동일 사건 변형 기사) 기본 제외 — 데이터는 보존, 노출만 대표 신호로 일원화
  if (!filter.includeDuplicates) where.push(`s.duplicate_of IS NULL`);
  // 업종 관련성 필터 — 리스트는 기본 전체 노출(배제 없음), 명시 선택 시에만 좁힘
  if (filter.relevance) { params.push(filter.relevance); where.push(`s.industry_relevance = $${params.length}`); }
  if (filter.from) { params.push(filter.from); where.push(`s.disclosed_at >= $${params.length}`); }
  if (filter.to) { params.push(filter.to); where.push(`s.disclosed_at <= $${params.length}`); }
  if (filter.q) {
    params.push(`%${filter.q}%`);
    where.push(`(s.company_name ILIKE $${params.length} OR s.report_name ILIKE $${params.length})`);
  }
  return { where, params };
}

export async function listIntelSignals(
  filter: IntelSignalFilter = {}
): Promise<{ signals: IntelSignal[]; total: number }> {
  const { where, params } = buildSignalWhere(filter);
  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const db = await getDb();
  const countRows = rowsToObjects(
    await db.exec(`SELECT COUNT(*)::int AS total FROM intel_signals s${whereSql}`, params)
  );
  const total = Number(countRows[0]?.total ?? 0);
  const limit = Math.min(Math.max(1, filter.limit ?? 50), 200);
  const offset = Math.max(0, filter.offset ?? 0);
  const sql = `${SIGNAL_SELECT}${whereSql}
    ORDER BY s.disclosed_at DESC NULLS LAST, s.created_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  const signals = rowsToObjects(await db.exec(sql, params)).map(mapSignal);
  return { signals, total };
}

export async function getIntelSignal(signalId: string): Promise<IntelSignal | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`${SIGNAL_SELECT} WHERE s.signal_id = $1 LIMIT 1`, [signalId]));
  return rows.length ? mapSignal(rows[0]) : null;
}

export interface IntelSignalDetail extends IntelSignal {
  summary: string | null;
  rawJson: Record<string, unknown> | null;
}

/** 원문 모달용 상세 — raw_json(소스별 원본·본문·분류)·summary 포함. */
export async function getIntelSignalDetail(signalId: string): Promise<IntelSignalDetail | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `${SIGNAL_SELECT.replace("s.match_status,", "s.summary, s.raw_json, s.match_status,")}
       WHERE s.signal_id = $1 LIMIT 1`,
      [signalId]
    )
  );
  if (!rows.length) return null;
  const row = rows[0];
  let rawJson: Record<string, unknown> | null = null;
  const rawVal = row.raw_json;
  try {
    const parsed = typeof rawVal === "string" ? JSON.parse(rawVal) : rawVal;
    if (parsed && typeof parsed === "object") rawJson = parsed as Record<string, unknown>;
  } catch { /* 원본 파싱 실패 시 모달은 기본 정보만 표시 */ }
  return { ...mapSignal(row), summary: text(row.summary), rawJson };
}

/** 선택 신호 일괄 삭제. 반환: 삭제 건수. */
/** 개별 삭제 + 사유 피드백 기록. 스냅샷은 DELETE RETURNING 으로 확보(임베딩은 FK CASCADE).
 *  피드백에 남은 (source, external_id)는 수집기가 재수집하지 않는다. 반환: 삭제 여부. */
export async function deleteSignalWithFeedback(
  signalId: string,
  reason: FeedbackReason,
  detailNote: string | null,
  deletedBy: string | null
): Promise<boolean> {
  return withDbWrite(async (db) => {
    // '중복 기사' 사유는 삭제 전에 최근접 유사도를 측정(임베딩은 삭제와 함께 CASCADE 소멸)
    // — dedup 병합 임계(0.90) 튜닝의 실측 근거로 축적된다.
    const sim = reason === "duplicate" ? await measureTopSimilarity(db, signalId) : null;
    const rows = rowsToObjects(
      await db.exec(
        `DELETE FROM intel_signals WHERE signal_id = $1
         RETURNING source, external_id, company_name, report_name,
                   signal_type, signal_grade, industry_relevance, summary, url`,
        [signalId]
      )
    );
    if (!rows.length) return false;
    const r = rows[0];
    await recordSignalFeedback(
      db,
      {
        source: String(r.source ?? ""),
        externalId: String(r.external_id ?? ""),
        companyName: text(r.company_name),
        reportName: text(r.report_name),
        signalType: text(r.signal_type),
        signalGrade: text(r.signal_grade),
        industryRelevance: text(r.industry_relevance),
        summary: text(r.summary),
        url: text(r.url),
        maxSimilarity: sim?.similarity ?? null,
        similarSignalId: sim?.signalId ?? null,
        detailNote,
      },
      reason,
      deletedBy
    );
    return true;
  });
}

export async function deleteSignals(signalIds: string[]): Promise<number> {
  if (!signalIds.length) return 0;
  return withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(
        `DELETE FROM intel_signals WHERE signal_id = ANY($1::text[]) RETURNING signal_id`,
        [signalIds]
      )
    );
    return rows.length;
  });
}

/** 등급(excluded/monitoring) 일괄 삭제. source 지정 시 해당 소스만. */
export async function deleteSignalsByGrade(grade: "excluded" | "monitoring", source?: string): Promise<number> {
  return withDbWrite(async (db) => {
    const params: unknown[] = [grade];
    let where = `signal_grade = $1`;
    if (source) where += ` AND ${sourceCondition(source, params, "")}`;
    const rows = rowsToObjects(
      await db.exec(`DELETE FROM intel_signals WHERE ${where} RETURNING signal_id`, params)
    );
    return rows.length;
  });
}

/** 처리상태 변경(new/reviewed/dismissed). converted는 전환 함수에서만. */
export async function updateSignalStatus(signalId: string, status: "new" | "reviewed" | "dismissed"): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run("UPDATE intel_signals SET status = $2, updated_at = $3 WHERE signal_id = $1", [signalId, status, now]);
  });
}

/** 미매칭 신호에 사업장 수동 연결. */
export async function linkSignalFacility(signalId: string, facilityId: string): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      "UPDATE intel_signals SET facility_id = $2, match_status = 'matched', updated_at = $3 WHERE signal_id = $1",
      [signalId, facilityId, now]
    );
  });
}

/** 신호 → 영업건(lead) 전환. facility 매칭 필수. 반환: projectId. */
export async function convertSignalToProject(signalId: string, userId: string | null): Promise<string> {
  const signal = await getIntelSignal(signalId);
  if (!signal) throw new Error("신호를 찾을 수 없습니다.");
  if (!signal.facilityId) throw new Error("사업장이 매칭되지 않은 신호는 전환할 수 없습니다.");
  if (signal.linkedProjectId) return signal.linkedProjectId;

  const label = INTEL_SIGNAL_TYPE_LABELS[signal.signalType] ?? "발주";
  const title = `${signal.companyName ?? "사업장"} · ${label} 대응`;
  const projectId = await createSalesProject(
    {
      facilityId: signal.facilityId,
      title,
      stage: "lead",
      priority: "normal",
      memo: `[DART 신호] ${signal.reportName ?? ""} (${signal.disclosedAt ?? ""})\n${signal.url ?? ""}`,
    },
    userId
  );

  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      "UPDATE intel_signals SET linked_project_id = $2, status = 'converted', updated_at = $3 WHERE signal_id = $1",
      [signalId, projectId, now]
    );
  });
  return projectId;
}
