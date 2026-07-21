// 신호 삭제 피드백 — 개별 삭제 시 사유·스냅샷을 남겨 수집 로직 개선의 학습 데이터로 쓴다.
// ①UI 삭제 팝업의 사유 저장 ②수집기 재수집 차단((source, external_id) 차단목록)
// ③사유별 통계(분류기·키워드 튜닝 근거)

import crypto from "node:crypto";
import { rowsToObjects, type PgDatabase } from "@/lib/db";

/** 삭제 사유 코드(DB CHECK 제약과 동일). 라벨은 intel-shared(클라이언트)에도 복제되어 있음. */
export const FEEDBACK_REASONS = ["irrelevant_industry", "mere_goal", "duplicate", "lacks_specifics"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export const FEEDBACK_REASON_LABELS: Record<FeedbackReason, string> = {
  irrelevant_industry: "무관한 업종",
  mere_goal: "단순 경영목표",
  duplicate: "중복 기사",
  lacks_specifics: "구체성 부재",
};

export function isFeedbackReason(v: unknown): v is FeedbackReason {
  return typeof v === "string" && (FEEDBACK_REASONS as readonly string[]).includes(v);
}

export interface FeedbackSnapshot {
  source: string;
  externalId: string;
  companyName?: string | null;
  reportName?: string | null;
  signalType?: string | null;
  signalGrade?: string | null;
  industryRelevance?: string | null;
  summary?: string | null;
  url?: string | null;
  /** '중복 기사' 삭제 시 가장 유사한 생존 신호와의 코사인 유사도(dedup 임계 튜닝 근거) */
  maxSimilarity?: number | null;
  similarSignalId?: string | null;
}

/** 삭제 사유 + 신호 스냅샷 upsert(같은 신호 재삭제 시 사유 갱신). */
export async function recordSignalFeedback(
  db: PgDatabase,
  snapshot: FeedbackSnapshot,
  reason: FeedbackReason,
  deletedBy: string | null
): Promise<void> {
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO intel_signal_feedback
       (feedback_id, source, external_id, reason, company_name, report_name,
        signal_type, signal_grade, industry_relevance, summary, url,
        max_similarity, similar_signal_id, deleted_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (source, external_id) DO UPDATE
       SET reason = EXCLUDED.reason,
           max_similarity = EXCLUDED.max_similarity,
           similar_signal_id = EXCLUDED.similar_signal_id,
           deleted_by = EXCLUDED.deleted_by,
           created_at = EXCLUDED.created_at`,
    [
      `ifb_${crypto.randomBytes(8).toString("hex")}`,
      snapshot.source, snapshot.externalId, reason,
      snapshot.companyName ?? null, snapshot.reportName ?? null,
      snapshot.signalType ?? null, snapshot.signalGrade ?? null,
      snapshot.industryRelevance ?? null, snapshot.summary ?? null,
      snapshot.url ?? null,
      snapshot.maxSimilarity ?? null, snapshot.similarSignalId ?? null,
      deletedBy, now,
    ]
  );
}

/** '중복 기사' 삭제 직전에 호출 — 삭제될 신호와 가장 유사한 다른 신호의 코사인 유사도.
 *  임베딩 미적재·pgvector 부재 시 null(기록만 생략). */
export async function measureTopSimilarity(
  db: PgDatabase,
  signalId: string
): Promise<{ similarity: number; signalId: string } | null> {
  try {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT b.signal_id, 1 - (a.embedding <=> b.embedding) AS sim
           FROM intel_embeddings a
           JOIN intel_embeddings b ON b.signal_id <> a.signal_id
          WHERE a.signal_id = $1
          ORDER BY a.embedding <=> b.embedding
          LIMIT 1`,
        [signalId]
      )
    );
    if (!rows.length) return null;
    const sim = Number(rows[0].sim);
    return Number.isFinite(sim) ? { similarity: sim, signalId: String(rows[0].signal_id) } : null;
  } catch {
    return null;
  }
}

// ── 분류기 few-shot 주입 — 삭제 사례를 "이런 것은 신호가 아니다" 실례로 활용 ──

/** few-shot 대상 사유 — duplicate 는 분류기가 판단할 수 없는 축(수집 시점엔 다른 기사를 모름)이라 제외. */
const EXAMPLE_REASONS: FeedbackReason[] = ["irrelevant_industry", "mere_goal", "lacks_specifics"];

export interface FeedbackExample {
  reason: FeedbackReason;
  title: string;
}

/** 소스별 최근 삭제 사례(사유별 최대 perReason건, 최신순). 테이블 부재·오류 시 빈 배열. */
export async function loadFeedbackExamples(
  db: PgDatabase,
  source: string,
  perReason = 5
): Promise<FeedbackExample[]> {
  try {
    const rows = rowsToObjects(
      await db.exec(
        `SELECT reason, report_name FROM (
           SELECT reason, report_name,
                  ROW_NUMBER() OVER (PARTITION BY reason ORDER BY created_at DESC) AS rn
             FROM intel_signal_feedback
            WHERE source = $1 AND reason = ANY($2::text[]) AND report_name IS NOT NULL
         ) t WHERE rn <= $3`,
        [source, EXAMPLE_REASONS, perReason]
      )
    );
    return rows.map((r) => ({
      reason: String(r.reason) as FeedbackReason,
      title: String(r.report_name),
    }));
  } catch {
    return [];
  }
}

/** 사례 목록 → 분류 프롬프트 삽입 블록. 사례 없으면 빈 문자열(프롬프트 불변 — 캐시 친화). */
export function formatFeedbackExamples(examples: FeedbackExample[], falseField = "isSignal"): string {
  if (!examples.length) return "";
  const lines = examples
    .map((e) => `  · (${FEEDBACK_REASON_LABELS[e.reason]}) "${e.title.slice(0, 80)}"`)
    .join("\n");
  return (
    `- ${falseField}=false 실례(사용자가 오인 수집으로 판단해 삭제한 실제 사례 — 유사한 건은 반드시 false):\n` +
    `${lines}\n`
  );
}

export const feedbackKey = (source: string, externalId: string): string => `${source}|${externalId}`;

/** 수집기 재수집 차단목록 — 사유와 무관하게 삭제된 (source, external_id) 전체.
 *  테이블 부재(마이그레이션 전)·오류 시 빈 Set(수집은 계속). */
export async function loadFeedbackBlocklist(db: PgDatabase): Promise<Set<string>> {
  try {
    const rows = rowsToObjects(await db.exec(`SELECT source, external_id FROM intel_signal_feedback`));
    return new Set(rows.map((r) => feedbackKey(String(r.source), String(r.external_id))));
  } catch {
    return new Set();
  }
}
