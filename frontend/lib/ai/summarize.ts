// 추진내역 AI 요약 — Claude Haiku 4.5 (Anthropic Messages API 직접 호출).
// ANTHROPIC_API_KEY 미설정/실패 시 원문 truncate 폴백.

const MODEL = "claude-haiku-4-5-20251001";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

/** 구조화 노트 마커([], <>, 글머리 기호)를 제거해 평문화. */
function flatten(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/^[\s]*[\[\]<>①-⑳•\-※₩→←]+\s*/gm, "")
    .replace(/[\[\]<>]/g, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function fallback(progressText: string, planText: string): string {
  const merged = flatten([progressText, planText].filter(Boolean).join(" / "));
  return merged.length > 80 ? `${merged.slice(0, 79)}…` : merged;
}

/**
 * 이번/다음 기간 추진내역을 80자 내외 한글 한 문단으로 요약.
 * 키가 없거나 호출 실패 시 원문 truncate 로 폴백한다.
 */
export async function summarizeProgress(progressText: string | null, planText: string | null): Promise<string> {
  const progress = (progressText ?? "").trim();
  const plan = (planText ?? "").trim();
  if (!progress && !plan) return "";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback(progress, plan);

  const prompt =
    `다음은 한 용역/업무의 주간 업무보고 추진내역입니다. 핵심만 추려 80자 내외의 한국어 한 문단으로 간결하게 요약하세요. ` +
    `머리말·따옴표 없이 요약문만 출력하세요.\n\n[이번 기간]\n${flatten(progress) || "(없음)"}\n\n[다음 기간]\n${flatten(plan) || "(없음)"}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return fallback(progress, plan);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
    return text || fallback(progress, plan);
  } catch {
    return fallback(progress, plan);
  }
}
