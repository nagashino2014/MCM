/**
 * 공용 Anthropic JSON 헬퍼 — 구조화 JSON 출력을 요구하는 LLM 호출을 한 곳으로.
 * summarize.ts / news-classifier.ts 의 (Anthropic Messages 직접 fetch + extractJson) 패턴을 승격했다.
 * MCM 은 Anthropic 단일. ANTHROPIC_API_KEY 없으면 throw("llm_not_configured").
 * (기존 summarize/news-classifier 는 그대로 두고, 신규 코드만 이 헬퍼를 소비한다.)
 */

const ENDPOINT = "https://api.anthropic.com/v1/messages";
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

export interface ChatJsonOpts {
  system?: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** 기본 Haiku. 구조 추론이 무거우면 "claude-sonnet-5" 등 지정. */
  model?: string;
}

/**
 * 프롬프트를 보내 JSON 응답을 파싱해 반환한다.
 * - 키 미설정: throw LlmError("llm_not_configured")
 * - HTTP 실패/타임아웃/파싱 실패: throw LlmError(사유)
 */
export async function anthropicChatJson<T = unknown>(opts: ChatJsonOpts): Promise<T> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmError("llm_not_configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model ?? DEFAULT_MODEL,
        max_tokens: opts.maxTokens ?? 4000,
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: "user", content: opts.user }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LlmError(`llm_http_${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
    };
    const text = (data.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("")
      .trim();
    const parsed = extractJson<T>(text);
    if (parsed == null) {
      throw new LlmError(
        data.stop_reason === "max_tokens"
          ? "llm_truncated: max_tokens 초과로 JSON 미완성"
          : "llm_parse_failed: JSON 을 찾지 못함"
      );
    }
    return parsed;
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new LlmError("llm_timeout");
    throw new LlmError(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}
