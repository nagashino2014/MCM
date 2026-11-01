import type { BriefingEvidence } from "./briefing-types";

const object = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") { try { return object(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
};

/** 현재 허용된 신호의 공개 입력만 선택한다. 분류 요약·업무 메모를 원문으로 승격하지 않는다. */
export function signalOriginalEvidence(row: Record<string, unknown>): Pick<BriefingEvidence, "originalText" | "qualityInputKind"> {
  const signal = { ...row, ...object(row.signal_snapshot) }, raw = object(signal.raw_json);
  const candidate = signal.source === "news" ? raw.description : signal.source === "press" ? raw.body : null;
  if (typeof candidate !== "string" || !candidate.trim()) return { originalText: null, qualityInputKind: "title_only" };
  const quality = object(object(raw.classification).contentQuality);
  return { originalText: candidate, qualityInputKind: signal.source === "news" || quality.inputKind === "search_excerpt" ? "search_excerpt" : "full_text" };
}
