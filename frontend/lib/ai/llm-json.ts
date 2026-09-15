/**
 * 공용 Anthropic JSON 헬퍼 — 구조화 JSON 출력을 요구하는 LLM 호출을 한 곳으로.
 * summarize.ts / news-classifier.ts 의 (Anthropic Messages 직접 fetch + extractJson) 패턴을 승격했다.
 * MCM 은 Anthropic 단일. ANTHROPIC_API_KEY 없으면 throw("llm_not_configured").
 * P0(2026-09-03): 실제 전송은 게이트웨이(claude-client.ts)가 맡는다 — usage 계측을 위해 feature 키가 필수.
 */
import { claudeMessages, ClaudeClientError } from "./claude-client";
import type { AiFeatureKey } from "./features";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export class LlmError extends Error {}

/** 응답 텍스트에서 첫 JSON 값을 추출(코드펜스·잡텍스트 방어). 객체/배열 모두 대응. */
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = text.replace(/```json\s*|\s*```/g, "");
  // 객체 우선, 없으면 배열
  const objStart = fenced.indexOf("{");
  const arrStart = fenced.indexOf("[");
  let start: number;
  let end: number;
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
    start = objStart;
    end = fenced.lastIndexOf("}");
  } else if (arrStart >= 0) {
    start = arrStart;
    end = fenced.lastIndexOf("]");
  } else {
    return null;
  }
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** 사용자 메시지에 텍스트 앞에 붙일 첨부 — PDF 문서 또는 이미지(base64, 개행 없는 문자열). */
export type ChatAttachment =
  | { kind: "pdf"; base64: string }
  | { kind: "image"; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; base64: string };

export interface ChatJsonOpts {
  /** 기능 키(집계 단위, 필수). */
  feature: AiFeatureKey;
  system?: string;
  user: string;
  /** 문서/이미지 입력(비전). 텍스트 블록보다 앞에 배치된다. */
  attachments?: ChatAttachment[];
  maxTokens?: number;
  timeoutMs?: number;
  /** 기본 Haiku. 구조 추론이 무거우면 "claude-sonnet-5" / "claude-opus-5" 등 지정. */
  model?: string;
  /**
   * 서버측 폴백(Opus 5 이상) — 안전 분류기가 요청을 거절(stop_reason: refusal)하면 서버가
   * 다른 모델로 재실행한다. beta 헤더 server-side-fallback-2026-07-01 + fallbacks:"default".
   */
  serverFallback?: boolean;
  userId?: string | null;
  subject?: { type: string; id: string } | null;
}

/**
 * 프롬프트를 보내 JSON 응답을 파싱해 반환한다.
 * - 키 미설정: throw LlmError("llm_not_configured")
 * - HTTP 실패/타임아웃/파싱 실패/거절: throw LlmError(사유)
 */
export async function anthropicChatJson<T = unknown>(opts: ChatJsonOpts): Promise<T> {
  try {
    // 첨부(문서/이미지)가 있으면 content 블록 배열, 없으면 기존처럼 문자열 그대로.
    const attachmentBlocks = (opts.attachments ?? []).map((a) =>
      a.kind === "pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.base64 } }
        : { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.base64 } }
    );
    const content =
      attachmentBlocks.length > 0 ? [...attachmentBlocks, { type: "text", text: opts.user }] : opts.user;

    const r = await claudeMessages({
      feature: opts.feature,
      model: opts.model ?? DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      messages: [{ role: "user", content }],
      timeoutMs: opts.timeoutMs ?? 30000,
      userId: opts.userId,
      subject: opts.subject,
      ...(opts.serverFallback
        ? { betas: ["server-side-fallback-2026-07-01"], extra: { fallbacks: "default" } }
        : {}),
    });
    if (!r.ok) throw new LlmError(`llm_http_${r.status}: ${(r.errorText ?? "").slice(0, 200)}`);
    // 안전 분류기 거절 — content 가 비어 있을 수 있으므로 텍스트 파싱 전에 판정한다.
    if (r.data?.stop_reason === "refusal") throw new LlmError("llm_refusal: 모델이 요청을 거절했습니다");
    const parsed = extractJson<T>(r.text);
    if (parsed == null) {
      throw new LlmError(
        r.data?.stop_reason === "max_tokens" ? "llm_truncated: max_tokens 초과로 JSON 미완성" : "llm_parse_failed: JSON 을 찾지 못함"
      );
    }
    return parsed;
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e instanceof ClaudeClientError) throw new LlmError(e.message);
    if (e instanceof Error && e.name === "AbortError") throw new LlmError("llm_timeout");
    throw new LlmError(e instanceof Error ? e.message : String(e));
  }
}
