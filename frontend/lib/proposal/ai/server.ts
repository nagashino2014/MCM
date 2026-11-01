// 용역 제안서 AI 수정 — 실제 연결(게이트웨이·회사 원장). 라우트만 import 한다.
import { AI_FEATURES } from "@/lib/ai/features";
import { hasClaudeApiKey } from "@/lib/ai/claude-client";
import { LlmError, anthropicChatJson } from "@/lib/ai/llm-json";
import { createProposalAi, type CallJson } from "./service";

const callJson: CallJson = async <T,>(feature: Parameters<CallJson>[0], system: string, user: string, opts: Parameters<CallJson>[3]): Promise<T> => {
  if (!hasClaudeApiKey()) throw new LlmError("llm_not_configured");
  // anthropicChatJson 의 기본 모델(Haiku)보다 기능 기본값이 우선하도록 명시한다(관리 화면 재지정은 게이트웨이가 적용).
  return anthropicChatJson<T>({ feature, model: AI_FEATURES[feature].defaultModel, system, user, cacheSystem: true, maxTokens: opts.maxTokens, timeoutMs: opts.timeoutMs, userId: opts.userId, subject: opts.subject });
};

export const proposalAi = createProposalAi({
  callJson,
  // 회사 수치 원장 = 회사소개서 지표 사전(같은 계산·기준일)
  loadLedger: async () => {
    const { computeCatalogMetrics } = await import("@/lib/catalog/metrics");
    const bundle = await computeCatalogMetrics();
    return bundle.metrics.map((m) => ({ id: m.id, label: m.label, value: m.value, unit: m.unit, asOf: m.asOf }));
  },
});
