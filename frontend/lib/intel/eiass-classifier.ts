// EIASS 협의 건 → 통합환경허가 관련성 판별 (Claude Haiku 4.5).
// news-classifier.ts 의 Anthropic Messages API 직접 호출 패턴 재사용. ANTHROPIC_API_KEY 없으면 null(규칙 폴백).
// 목적: 환경영향평가 대상 대부분은 도로·하천·태양광 등 비제조 개발사업이라, 키워드 1차 필터를 통과한
//       건 중에서도 "통합환경허가(대기 1~2종 등) 대상 사업장으로 이어질 사업"만 정밀 판별한다.
//       (예: 사업구분 "기타[근린생활시설]" 이지만 사업명이 "제2종근린생활시설(제조업소)" 인 케이스)

import type { IntelSignalType } from "./signal-extractor";
import type { IntelIndustryItem } from "./intel-settings";
import { claudeMessages } from "@/lib/ai/claude-client";

const MODEL = "claude-haiku-4-5-20251001";

export interface EiassClassification {
  isTarget: boolean; // 통합환경허가 대상 사업장으로 이어질 개연성
  signalType: IntelSignalType; // 대체로 new_site(신규 조성), 기존 확장이면 expansion
  companyName: string | null; // 실질 사업 주체(민간기업명. 지자체·공사면 그대로)
  confidence: "high" | "medium" | "low";
  summary: string | null; // 한 줄 요약(한국어)
  industry: string | null; // 대상 업종 id(industries 전달 시. isTarget=true 전제라 relevance 는 direct)
}

const SYSTEM =
  "당신은 한국 통합환경허가(환경오염시설법) 영업 분석가입니다. 환경영향평가 협의 사업 정보를 보고, " +
  "그 사업이 통합환경허가 대상 사업장(대기 1~2종: 발전·소각·화학·제철·정유·제지 등 19개 업종의 " +
  "공장·산업시설, 또는 그런 기업이 입주할 산업단지·농공단지)으로 이어질 사업인지 판별합니다. " +
  "도로·철도·하천·태양광·풍력·골프장·주택·관광 개발은 대상이 아닙니다. " +
  "반드시 JSON 하나만 출력하고 그 외 설명은 쓰지 않습니다.";

function buildPrompt(
  input: {
    title: string;
    kindLabel: string;
    bizCategory: string | null;
    operator: string | null;
    region: string | null;
    scaleText: string | null;
    costEokwon: number | null;
  },
  industries?: IntelIndustryItem[],
  feedbackBlock?: string
): string {
  const industryBlock = industries?.length
    ? "- industry: 사업 업종이 아래 [대상 업종] 중 하나면 그 명칭(정확히), 산업단지·농공단지 조성이면 \"산업단지\", 판단 어려우면 null.\n" +
      `[대상 업종] ${industries.map((i) => (i.note ? `${i.label}(${i.note})` : i.label)).join(", ")}\n`
    : "";
  const industryOut = industries?.length ? ', "industry": "업종명 또는 산업단지 또는 null"' : "";
  return (
    "다음 환경영향평가 협의 사업이 통합환경허가 대상으로 이어질 사업인지 판별하고 JSON만 출력하세요.\n" +
    "- isTarget=true 예: 산업단지·농공단지 조성, 제조공장 신·증설 부지조성, 발전소·소각시설·폐기물처리시설 건설.\n" +
    "- isTarget=false 예: 도로·철도·하천정비, 태양광·풍력, 골프장·관광지, 주택·도시개발, 농촌용수개발.\n" +
    "- signalType: 신규 조성/신설=new_site, 기존 시설 증설·확장=expansion, 그 외=other.\n" +
    "- companyName: 실질 사업 주체명(민간기업이면 기업명). 지자체·공공기관이면 그 기관명.\n" +
    (feedbackBlock ?? "") +
    industryBlock +
    "\n" +
    `[사업명] ${input.title}\n` +
    `[평가종류] ${input.kindLabel}\n` +
    `[사업구분] ${input.bizCategory ?? "미상"}\n` +
    `[사업시행자] ${input.operator ?? "미상"}\n` +
    `[소재지] ${input.region ?? "미상"}\n` +
    `[규모] ${input.scaleText ?? "미상"}\n` +
    `[사업비] ${input.costEokwon != null ? `${input.costEokwon}억원` : "미상"}\n\n` +
    "출력(JSON만, 코드펜스 없이):\n" +
    '{"isTarget": true, "signalType": "new_site|expansion|other", "companyName": "주체명 또는 null", ' +
    `"confidence": "high|medium|low", "summary": "한국어 한 줄 요약"${industryOut}}`
  );
}

/** 응답 텍스트에서 첫 JSON 객체를 추출(코드펜스·잡텍스트 방어). */
function extractJson(text: string): Record<string, unknown> | null {
  const fenced = text.replace(/```json\s*|\s*```/g, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const SIGNAL_TYPES: IntelSignalType[] = ["investment", "expansion", "new_site", "other"];
const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== "null" ? s : null;
};

/** LLM 이 답한 업종 라벨 → 설정 목록의 id. "산업단지"는 특수 키. */
function industryIdFromLabel(label: string | null, industries?: IntelIndustryItem[]): string | null {
  if (!label) return null;
  if (/산업단지|산단|농공단지/.test(label)) return "industrial-complex";
  const hit = industries?.find((i) => i.label === label || label.includes(i.label));
  return hit?.id ?? null;
}

function normalize(j: Record<string, unknown>, industries?: IntelIndustryItem[]): EiassClassification {
  const st = String(j.signalType ?? "other") as IntelSignalType;
  const conf = String(j.confidence ?? "low").toLowerCase();
  return {
    isTarget: j.isTarget === true || String(j.isTarget).toLowerCase() === "true",
    signalType: SIGNAL_TYPES.includes(st) ? st : "other",
    companyName: str(j.companyName),
    confidence: conf === "high" || conf === "medium" ? (conf as "high" | "medium") : "low",
    summary: str(j.summary),
    industry: industries?.length ? industryIdFromLabel(str(j.industry), industries) : null,
  };
}

/**
 * EIASS 협의 건을 Haiku 로 판별. 키 없음/오류 시 null(수집측은 규칙 기반 폴백).
 * industries 전달 시 업종 라벨도 판별(isTarget=true 전제라 relevance 는 수집측에서 direct 처리).
 * feedbackBlock: 삭제 피드백 few-shot 블록(intel-feedback.formatFeedbackExamples) — 오인 수집 실례 주입.
 */
export async function classifyEiass(
  input: Parameters<typeof buildPrompt>[0],
  industries?: IntelIndustryItem[],
  feedbackBlock?: string
): Promise<EiassClassification | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const r = await claudeMessages({
      feature: "intel.eiass_classify",
      model: MODEL,
      max_tokens: 450,
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(input, industries, feedbackBlock) }],
      timeoutMs: 20000,
    });
    if (!r.ok) return null;
    const text = r.text;
    const j = extractJson(text);
    return j ? normalize(j, industries) : null;
  } catch {
    return null;
  }
}
