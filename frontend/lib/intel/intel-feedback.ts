// 신호 삭제 피드백 — 개별 삭제 시 사유·스냅샷을 남겨 수집 로직 개선의 학습 데이터로 쓴다.
// ①UI 삭제 팝업의 사유 저장 ②수집기 재수집 차단((source, external_id) 차단목록)
// ③사유별 통계(분류기·키워드 튜닝 근거)

import crypto from "node:crypto";
import { rowsToObjects, type PgDatabase } from "@/lib/db";

/** 삭제 사유 코드(DB CHECK 제약과 동일). 라벨은 intel-shared(클라이언트)에도 복제되어 있음. */
export const FEEDBACK_REASONS = ["irrelevant_industry", "mere_goal", "duplicate", "lacks_specifics"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

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
        signal_type, signal_grade, industry_relevance, summary, url, deleted_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (source, external_id) DO UPDATE
       SET reason = EXCLUDED.reason,
           deleted_by = EXCLUDED.deleted_by,
           created_at = EXCLUDED.created_at`,
    [
      `ifb_${crypto.randomBytes(8).toString("hex")}`,
      snapshot.source, snapshot.externalId, reason,
      snapshot.companyName ?? null, snapshot.reportName ?? null,
      snapshot.signalType ?? null, snapshot.signalGrade ?? null,
      snapshot.industryRelevance ?? null, snapshot.summary ?? null,
      snapshot.url ?? null, deletedBy, now,
    ]
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
