/**
 * Claude Messages API 단일 게이트웨이(블루프린트 §3.1, P0).
 * MCM 의 모든 Anthropic 호출은 이 함수를 지난다 — 응답 usage 를 캡처해 기능별 토큰·비용을 ai_usage_log 에 남긴다.
 *
 * 동작 계약(호출부 diff 최소화를 위해 기존 fetch 관례를 그대로 따른다):
 * - ANTHROPIC_API_KEY 미설정 → throw ClaudeClientError("llm_not_configured"). (호출부 대부분은 사전에 hasClaudeApiKey() 로 폴백)
 * - HTTP 비-2xx → throw 하지 않고 { ok:false, status, errorText } 반환(호출부가 res.ok 를 보던 습관 유지).
 * - 타임아웃(AbortError)·네트워크 오류 → 로그를 남긴 뒤 원래 예외를 그대로 throw(호출부의 try/catch 폴백 유지).
 * - 프롬프트·응답 원문은 로그에 남기지 않는다. meta 에는 길이·블록 종류 같은 형상 정보만.
 */
import { AI_FEATURES, type AiFeatureKey } from "./features";
import { computeCostUsd, getModelPrices, normalizeModelFamily, type ClaudeUsage } from "./pricing";
import { currentAiEnv, logAiUsage, type AiCallStatus } from "./usage-log";
import { getFeatureModelOverride } from "./settings";
import { afterCallBudgetCheck, budgetGate } from "./budget";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 120_000;

export class ClaudeClientError extends Error {}

export type ClaudeContentBlock = { type: string; text?: string; [k: string]: unknown };

export interface ClaudeResponse {
  id?: string;
  model?: string;
  content?: ClaudeContentBlock[];
  stop_reason?: string;
  usage?: ClaudeUsage;
}

export interface ClaudeMessagesRequest {
  /** 기능 키(필수) — 집계 단위. */
  feature: AiFeatureKey;
  /** 요청 모델. 미지정 시 기능 기본값(features.ts). */
  model?: string;
  max_tokens: number;
  system?: string;
  /** Anthropic MessageParam 배열 그대로(text/image/document 블록 포함). */
  messages: unknown[];
  /** 타임아웃(ms). signal 을 주면 그것을 우선한다. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** 호출 주체·대상(있을 때만) — 사용자별·대상별 집계용. */
  userId?: string | null;
  subject?: { type: string; id: string } | null;
  /** 형상 메타(페이지 수·이미지 크기 등). 원문 금지. */
  meta?: Record<string, unknown>;
  /** body 에 추가로 얹을 파라미터(thinking·output_config 등, P4). */
  extra?: Record<string, unknown>;
}

export interface ClaudeMessagesResult {
  ok: boolean;
  /** HTTP 상태. */
  status: number;
  data: ClaudeResponse | null;
  errorText: string | null;
  requestId: string | null;
  usage: ClaudeUsage | null;
  costUsd: number | null;
  /** 실제 요청한 모델 ID. */
  model: string;
  latencyMs: number;
  /** content 의 text 블록을 이어 붙인 문자열(편의). */
  text: string;
}

export function hasClaudeApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * 기능의 적용 모델 해석(블루프린트 §3.6): 관리 화면 오버라이드(ai_settings) → 호출부 지정(env var) → 코드 기본값.
 * 오버라이드 조회는 30초 캐시·실패 시 null 이라 호출 경로를 막지 않는다.
 */
export async function resolveModel(feature: AiFeatureKey, requested?: string | null): Promise<string> {
  const override = await getFeatureModelOverride(feature);
  if (override) return override;
  if (requested && requested.trim()) return requested.trim();
  return AI_FEATURES[feature].defaultModel;
}

export function joinTextBlocks(data: ClaudeResponse | null | undefined): string {
  return (data?.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();
}

function shapeMeta(req: ClaudeMessagesRequest): Record<string, unknown> {
  // 원문 대신 형상만: 메시지 수, 블록 종류별 개수, system/user 텍스트 길이.
  const blocks: Record<string, number> = {};
  let textChars = 0;
  for (const m of req.messages as Array<{ content?: unknown }>) {
    const c = m?.content;
    if (typeof c === "string") {
      textChars += c.length;
      blocks.text = (blocks.text ?? 0) + 1;
    } else if (Array.isArray(c)) {
      for (const b of c as ClaudeContentBlock[]) {
        blocks[b.type] = (blocks[b.type] ?? 0) + 1;
        if (b.type === "text" && typeof b.text === "string") textChars += b.text.length;
      }
    }
  }
  return {
    messages: req.messages.length,
    blocks,
    text_chars: textChars,
    system_chars: req.system?.length ?? 0,
    max_tokens: req.max_tokens,
    ...(req.meta ?? {}),
  };
}

export async function claudeMessages(req: ClaudeMessagesRequest): Promise<ClaudeMessagesResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ClaudeClientError("llm_not_configured");

  const model = await resolveModel(req.feature, req.model);
  const modelFamily = normalizeModelFamily(model);
  const env = currentAiEnv();
  const startedAt = Date.now();

  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let signal = req.signal;
  if (!signal) {
    controller = new AbortController();
    signal = controller.signal;
    timer = setTimeout(() => controller?.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: req.max_tokens,
    ...(req.system ? { system: req.system } : {}),
    messages: req.messages,
    ...(req.extra ?? {}),
  };

  const base = {
    featureKey: req.feature,
    model,
    modelFamily,
    userId: req.userId ?? null,
    subjectType: req.subject?.type ?? null,
    subjectId: req.subject?.id ?? null,
    env,
  };

  // 예산 가드(P2) — 정책이 block_* 이고 한도를 넘었으면 호출하지 않는다. 호출부의 기존 폴백(수동 입력·원문)이 작동한다.
  const gate = await budgetGate(req.feature, modelFamily);
  if (gate.blocked) {
    if (timer) clearTimeout(timer);
    void logAiUsage({
      ...base,
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      latencyMs: 0,
      status: "budget_blocked",
      httpStatus: null,
      stopReason: null,
      requestId: null,
      meta: { ...shapeMeta(req), reason: gate.reason },
    });
    throw new ClaudeClientError(`llm_budget_exceeded: ${gate.reason}`);
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": API_VERSION, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const latencyMs = Date.now() - startedAt;
    const requestId = res.headers.get("request-id") ?? res.headers.get("x-request-id");

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      void logAiUsage({
        ...base,
        inputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        latencyMs,
        status: "error",
        httpStatus: res.status,
        stopReason: null,
        requestId,
        meta: { ...shapeMeta(req), error: errorText.slice(0, 300) },
      });
      return { ok: false, status: res.status, data: null, errorText, requestId, usage: null, costUsd: null, model, latencyMs, text: "" };
    }

    const data = (await res.json()) as ClaudeResponse;
    const usage: ClaudeUsage = {
      input_tokens: data.usage?.input_tokens ?? 0,
      output_tokens: data.usage?.output_tokens ?? 0,
      cache_creation_input_tokens: data.usage?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: data.usage?.cache_read_input_tokens ?? 0,
    };
    const prices = await getModelPrices();
    const costUsd = computeCostUsd(usage, prices[modelFamily]);
    const stopReason = data.stop_reason ?? null;
    const status: AiCallStatus = stopReason === "refusal" ? "refusal" : stopReason === "max_tokens" ? "truncated" : "ok";

    void logAiUsage({
      ...base,
      model: data.model ?? model,
      inputTokens: usage.input_tokens,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      outputTokens: usage.output_tokens,
      costUsd,
      latencyMs,
      status,
      httpStatus: res.status,
      stopReason,
      requestId,
      meta: shapeMeta(req),
    }).then((logId) => afterCallBudgetCheck({ logId, feature: req.feature, modelFamily, costUsd }));

    return { ok: true, status: res.status, data, errorText: null, requestId, usage, costUsd, model, latencyMs, text: joinTextBlocks(data) };
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    const isAbort = e instanceof Error && e.name === "AbortError";
    void logAiUsage({
      ...base,
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      latencyMs,
      status: isAbort ? "timeout" : "error",
      httpStatus: null,
      stopReason: null,
      requestId: null,
      meta: { ...shapeMeta(req), error: (e instanceof Error ? e.message : String(e)).slice(0, 300) },
    });
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
