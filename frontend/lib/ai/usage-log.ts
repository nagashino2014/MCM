/**
 * AI 호출 로그 적재(ai_usage_log, 215) — 게이트웨이가 호출 1건마다 fire-and-forget 으로 남긴다.
 * 프롬프트·응답 원문은 저장하지 않는다(블루프린트 §2 비목표 — 영수증·명함·연말정산 개인정보).
 * 적재 실패는 본 호출에 영향을 주지 않고 console.warn 1회만 남긴다(마이그 미적용 상태 배포 대비).
 */
import { getDb, rowsToObjects } from "@/lib/db";

export type AiCallStatus = "ok" | "error" | "timeout" | "refusal" | "truncated" | "budget_blocked" | "disabled";

export interface AiUsageLogRow {
  provider?: string;
  featureKey: string;
  model: string;
  modelFamily: string;
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  latencyMs: number | null;
  status: AiCallStatus;
  httpStatus: number | null;
  stopReason: string | null;
  requestId: string | null;
  userId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  env: string;
  meta: Record<string, unknown> | null;
}

let warnedOnce = false;

/** 실행 환경 태그 — staging 컨테이너(ECS 메타데이터 env 존재) / local. MCM_ENV 로 명시 가능. */
export function currentAiEnv(): string {
  if (process.env.MCM_ENV) return process.env.MCM_ENV;
  if (process.env.ECS_CONTAINER_METADATA_URI_V4 || process.env.ECS_CONTAINER_METADATA_URI) return "staging";
  return process.env.NODE_ENV === "production" ? "prod-unknown" : "local";
}

/** 적재 후 log_id 를 돌려준다(예산 단건 경고 dedup 키). 실패 시 null. */
export async function logAiUsage(row: AiUsageLogRow): Promise<number | null> {
  try {
    const db = await getDb();
    const res = await db.exec(
      `INSERT INTO ai_usage_log (
         provider, feature_key, model, model_family,
         input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens,
         cost_usd, latency_ms, status, http_status, stop_reason, request_id,
         user_id, subject_type, subject_id, env, meta
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING log_id`,
      [
        row.provider ?? "anthropic",
        row.featureKey,
        row.model,
        row.modelFamily,
        row.inputTokens,
        row.cacheCreationInputTokens,
        row.cacheReadInputTokens,
        row.outputTokens,
        row.costUsd,
        row.latencyMs,
        row.status,
        row.httpStatus,
        row.stopReason,
        row.requestId,
        row.userId,
        row.subjectType,
        row.subjectId,
        row.env,
        row.meta ? JSON.stringify(row.meta) : null,
      ]
    );
    const id = rowsToObjects(res)[0]?.log_id;
    return id != null ? Number(id) : null;
  } catch (e) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(`[ai-usage-log] 적재 실패(이후 동일 경고 생략): ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }
}
