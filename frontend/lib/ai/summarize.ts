// 추진내역 AI 요약 — Claude Haiku 4.5 (Anthropic Messages API 직접 호출).
// ANTHROPIC_API_KEY 미설정/실패 시 원문 truncate 폴백.

import { claudeMessages } from "@/lib/ai/claude-client";

const MODEL = "claude-haiku-4-5-20251001";

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

/** 원문을 문장 단위로 끊어 최대 3줄 불릿으로 폴백. */
function fallback(progressText: string, planText: string): string {
  const merged = flatten([progressText, planText].filter(Boolean).join(" "));
  if (!merged) return "";
  const lines = merged
    .split(/(?<=[.。!?]|다|음|함|됨|료)\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((s) => (s.length > 42 ? `${s.slice(0, 41)}…` : s));
  return lines.join("\n");
}

/**
 * 이번/다음 기간 추진내역을 한 줄 1항목의 불릿 3~4행으로 요약(발표모드 카드 표기용).
 * 키가 없거나 호출 실패 시 원문 문장 분할로 폴백한다.
 */
export async function summarizeProgress(progressText: string | null, planText: string | null): Promise<string> {
  const progress = (progressText ?? "").trim();
  const plan = (planText ?? "").trim();
  if (!progress && !plan) return "";

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback(progress, plan);

  const prompt =
    `다음은 한 용역/업무의 주간 업무보고 추진내역입니다. 임원 보고용 발표 카드에 넣을 요약을 만드세요.\n` +
    `- 핵심 항목 3개(내용이 많으면 4개)를 뽑아 한 줄에 하나씩, 줄바꿈으로 구분해 출력합니다.\n` +
    `- 각 줄은 공백 포함 40자 이내의 명사형 종결(예: "…완료", "…진행", "…예정")로 씁니다.\n` +
    `- 글머리 기호(•, -, 숫자)·머리말·따옴표는 붙이지 말고 문장만 출력하세요.\n\n` +
    `[이번 기간]\n${flatten(progress) || "(없음)"}\n\n[다음 기간]\n${flatten(plan) || "(없음)"}`;

  try {
    const r = await claudeMessages({
      feature: "workplan.progress_summary",
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
      timeoutMs: 15000,
    });
    if (!r.ok) {
      console.warn(`[work-plan] 추진내역 AI 요약 실패(status ${r.status}) — truncate 폴백`);
      return fallback(progress, plan);
    }
    return r.text || fallback(progress, plan);
  } catch (err) {
    console.warn(`[work-plan] 추진내역 AI 요약 실패(${(err as Error).message}) — truncate 폴백`);
    return fallback(progress, plan);
  }
}
