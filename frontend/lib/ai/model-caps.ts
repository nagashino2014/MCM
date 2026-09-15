/**
 * 모델별 요청 파라미터 능력표(P4 thinking/effort 제어용) — 2026-06 API 기준.
 * 잘못된 조합은 400 이 나므로 게이트웨이가 여기로 걸러서 보낸다.
 * - adaptiveThinking: `thinking: {type:"adaptive"}` 를 받는 모델(4.6+)
 * - thinkingDisable: `thinking: {type:"disabled"}` 허용(Fable 계열은 400)
 * - disableOnlyUpToHigh: Opus 5 — disabled 는 effort ≤ high 에서만
 * - effort: `output_config.effort` 지원
 * - thinkingDefaultOn: thinking 파라미터를 생략하면 adaptive 로 도는 모델(Sonnet 5·Opus 5·Fable)
 */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export type ThinkingMode = "adaptive" | "off";

export interface ModelCaps {
  adaptiveThinking: boolean;
  thinkingDisable: boolean;
  disableOnlyUpToHigh: boolean;
  effort: boolean;
  effortLevels: EffortLevel[];
  thinkingDefaultOn: boolean;
}

const FIVE: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
const FOUR: EffortLevel[] = ["low", "medium", "high", "max"];

const CAPS: Record<string, ModelCaps> = {
  "claude-haiku-4-5": { adaptiveThinking: false, thinkingDisable: false, disableOnlyUpToHigh: false, effort: false, effortLevels: [], thinkingDefaultOn: false },
  "claude-sonnet-4-6": { adaptiveThinking: true, thinkingDisable: true, disableOnlyUpToHigh: false, effort: true, effortLevels: FOUR, thinkingDefaultOn: false },
  "claude-opus-4-6": { adaptiveThinking: true, thinkingDisable: true, disableOnlyUpToHigh: false, effort: true, effortLevels: FOUR, thinkingDefaultOn: false },
  "claude-opus-4-7": { adaptiveThinking: true, thinkingDisable: true, disableOnlyUpToHigh: false, effort: true, effortLevels: FIVE, thinkingDefaultOn: false },
  "claude-opus-4-8": { adaptiveThinking: true, thinkingDisable: true, disableOnlyUpToHigh: false, effort: true, effortLevels: FIVE, thinkingDefaultOn: false },
  "claude-sonnet-5": { adaptiveThinking: true, thinkingDisable: true, disableOnlyUpToHigh: false, effort: true, effortLevels: FIVE, thinkingDefaultOn: true },
  "claude-opus-5": { adaptiveThinking: true, thinkingDisable: true, disableOnlyUpToHigh: true, effort: true, effortLevels: FIVE, thinkingDefaultOn: true },
  "claude-fable-5": { adaptiveThinking: true, thinkingDisable: false, disableOnlyUpToHigh: false, effort: true, effortLevels: FIVE, thinkingDefaultOn: true },
  "claude-fable-5-1": { adaptiveThinking: true, thinkingDisable: false, disableOnlyUpToHigh: false, effort: true, effortLevels: FIVE, thinkingDefaultOn: true },
};

const UNKNOWN: ModelCaps = { adaptiveThinking: false, thinkingDisable: false, disableOnlyUpToHigh: false, effort: false, effortLevels: [], thinkingDefaultOn: false };

export function modelCaps(modelFamily: string): ModelCaps {
  return CAPS[modelFamily] ?? UNKNOWN;
}

export interface ThinkingSetting {
  thinking?: ThinkingMode | null;
  effort?: EffortLevel | null;
}

/**
 * 기능 설정 → 요청 body 확장. 모델이 지원하지 않는 항목은 조용히 뺀다(400 방지).
 * 반환 { applied } 는 로그 meta 용.
 */
export function buildThinkingParams(modelFamily: string, setting: ThinkingSetting | null | undefined): { body: Record<string, unknown>; applied: Record<string, string> } {
  const caps = modelCaps(modelFamily);
  const body: Record<string, unknown> = {};
  const applied: Record<string, string> = {};
  if (!setting) return { body, applied };
  const effort = setting.effort && caps.effort && caps.effortLevels.includes(setting.effort) ? setting.effort : null;
  if (effort) {
    body.output_config = { effort };
    applied.effort = effort;
  }
  if (setting.thinking === "adaptive" && caps.adaptiveThinking) {
    body.thinking = { type: "adaptive" };
    applied.thinking = "adaptive";
  } else if (setting.thinking === "off" && caps.thinkingDisable) {
    const blocked = caps.disableOnlyUpToHigh && (effort === "xhigh" || effort === "max");
    if (!blocked) {
      body.thinking = { type: "disabled" };
      applied.thinking = "off";
    }
  }
  return { body, applied };
}
