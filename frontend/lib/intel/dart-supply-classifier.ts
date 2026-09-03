// DART 공급계약(수주) 공시 → 발주처 리드 분류·구조화 추출 (Claude Haiku 4.5).
// news-classifier 패턴 재사용. ANTHROPIC_API_KEY 없으면 null(분류 skip).
// 목적: 공급계약 공시의 공시자는 '수주한 시공·납품사'라 매칭 대상이 아니지만, 원문에는
//       발주처가 어떤 시설(공장·발전소·소각·처리시설 등)의 공사·설비를 발주했는지가 담긴다.
//       통합허가 대상 시설의 건설·증설·설비 계약만 골라 발주처를 신규 리드로 뽑는다.

import type { IntelSignalType } from "./signal-extractor";
import type { IntelIndustryItem } from "./intel-settings";
import type { IndustryRelevance } from "./industry-rules";
import { claudeMessages } from "@/lib/ai/claude-client";

const MODEL = "claude-haiku-4-5-20251001";

export interface SupplyContractClassification {
  isTarget: boolean; // 통합허가 대상 시설의 건설·증설·설비 계약 여부
  ordererName: string | null; // 발주처(계약상대방) — 리드의 주체
  facilityKind: string | null; // 시설 종류(예: 폐수처리장, LNG 발전소, 반도체 공장)
  signalType: IntelSignalType; // new_site/expansion/investment/other
  location: string | null; // 시설 위치(시/군/구/산단)
  scale: string | null; // 계약금액·용량 등 규모 표현
  contractPeriod: string | null; // 계약기간(=공사 기간, 시작~종료) — 영업 적기 판단용
  confidence: "high" | "medium" | "low";
  summary: string | null; // 한 줄 요약(한국어)
  industry: string | null; // 대상 업종 id(설정 목록 매핑)
  industryRelevance: IndustryRelevance | null;
  relevanceNote: string | null;
}

const SYSTEM =
  "당신은 한국 통합환경허가 대행사의 영업 애널리스트입니다. DART 단일판매·공급계약 공시 원문을 읽고, " +
  "계약의 목적물이 '통합환경허가 대상이 될 만한 국내 시설(공장·발전소·소각·폐기물·폐수처리 등)의 " +
  "건설·증설·설비 공급'인지 판별하고, 발주처(계약상대방)를 구조화 추출합니다. " +
  "반드시 JSON 하나만 출력하고 그 외 설명은 쓰지 않습니다.";

function buildPrompt(
  filerName: string,
  reportName: string,
  docExcerpt: string,
  industries?: IntelIndustryItem[]
): string {
  const industryBlock = industries?.length
    ? "- industry: 발주 시설의 업종이 아래 [대상 업종] 중 하나면 그 명칭(정확히), 산업단지 조성 공사면 \"산업단지\", 해당 없으면 null.\n" +
      "- industryRelevance: direct=시설 자체가 대상 업종 / supply_chain=비대상이나 대상 업종의 후속 투자를 유발 / " +
      "low=제조업이지만 대상 업종·규모와 거리 / none=비제조·무관.\n" +
      "- relevanceNote: supply_chain 일 때만 유발 경로 한 줄, 그 외 null.\n" +
      `[대상 업종] ${industries.map((i) => (i.note ? `${i.label}(${i.note})` : i.label)).join(", ")}\n\n`
    : "";
  const industryOut = industries?.length
    ? ', "industry": "업종명 또는 산업단지 또는 null", "industryRelevance": "direct|supply_chain|low|none", "relevanceNote": "유발경로 또는 null"'
    : "";
  return (
    "다음 공급계약 공시가 '국내 통합환경허가 대상급 시설의 건설·증설·설비 공급' 계약인지 판별하고 JSON만 출력하세요.\n" +
    "- isTarget=true 예: 공장·생산시설 신축/증축 공사, 발전소(LNG·바이오매스·열병합) 건설, 소각·매립·폐기물처리·재활용 시설, " +
    "폐수·수처리 설비, 대규모 생산설비(플랜트) 공급·설치 — 목적물 시설이 국내일 때.\n" +
    "- isTarget=false 예: 아파트·오피스·상업시설·물류창고 등 일반 건축, 도로·교량·철도 등 토목 SOC, " +
    "해외 시설, 소프트웨어·용역·유지보수, 단순 제품(완제품·부품) 판매 공급, 방산·관급 물자 납품.\n" +
    "- ordererName: 발주처(계약상대방) 회사·기관명. 공시자(수주사)가 아님에 주의.\n" +
    "- signalType: 시설 신설 공사=new_site, 기존 시설 증설·개조=expansion, 단계 불명 설비투자=investment, 그 외=other.\n" +
    "- contractPeriod: 계약기간(시작일~종료일)이 원문에 있으면 'YYYY-MM-DD ~ YYYY-MM-DD' 형태로, 없으면 null. 공사가 언제 끝나는지가 영업 적기 판단에 중요.\n" +
    "- confidence: 시설 종류·발주처가 명확하면 high, 일부 추정이면 medium, 불명확하면 low.\n" +
    industryBlock +
    `[공시자(수주사)] ${filerName}\n[보고서명] ${reportName}\n[원문 발췌]\n${docExcerpt}\n\n` +
    "출력(JSON만, 코드펜스 없이):\n" +
    '{"isTarget": true, "ordererName": "발주처 또는 null", "facilityKind": "시설 종류 또는 null", ' +
    '"signalType": "new_site|expansion|investment|other", "location": "위치 또는 null", "scale": "규모표현 또는 null", ' +
    '"contractPeriod": "계약기간 또는 null", ' +
    `"confidence": "high|medium|low", "summary": "한국어 한 줄 요약"${industryOut}}`
  );
}

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
const RELEVANCES: IndustryRelevance[] = ["direct", "supply_chain", "low", "none"];
const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== "null" ? s : null;
};

function industryIdFromLabel(label: string | null, industries?: IntelIndustryItem[]): string | null {
  if (!label) return null;
  if (/산업단지|산단|농공단지/.test(label)) return "industrial-complex";
  const hit = industries?.find((i) => i.label === label || label.includes(i.label));
  return hit?.id ?? null;
}

function normalize(j: Record<string, unknown>, industries?: IntelIndustryItem[]): SupplyContractClassification {
  const st = String(j.signalType ?? "other") as IntelSignalType;
  const conf = String(j.confidence ?? "low").toLowerCase();
  const rel = str(j.industryRelevance) as IndustryRelevance | null;
  const relevance = industries?.length ? (rel && RELEVANCES.includes(rel) ? rel : null) : null;
  const industry = industries?.length ? industryIdFromLabel(str(j.industry), industries) : null;
  return {
    isTarget: j.isTarget === true || String(j.isTarget).toLowerCase() === "true",
    ordererName: str(j.ordererName),
    facilityKind: str(j.facilityKind),
    signalType: SIGNAL_TYPES.includes(st) ? st : "other",
    location: str(j.location),
    scale: str(j.scale),
    contractPeriod: str(j.contractPeriod),
    confidence: conf === "high" || conf === "medium" ? (conf as "high" | "medium") : "low",
    summary: str(j.summary),
    industry: industry ?? (relevance === "direct" ? "other" : null),
    industryRelevance: relevance,
    relevanceNote: relevance === "supply_chain" ? str(j.relevanceNote) : null,
  };
}

/** 원문에서 계약 정형 표 구간 위주의 발췌(앞부분 — 공급계약 공시는 표가 문서 서두에 있다). */
export function supplyDocExcerpt(fullText: string, maxLen = 2200): string {
  return fullText.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/**
 * 공급계약 공시 원문을 Haiku 로 분류. 키 없음/오류 시 null(수집측은 미분류 skip).
 * industries 전달 시 업종 태깅도 함께 판별한다.
 */
export async function classifySupplyContract(
  filerName: string,
  reportName: string,
  docExcerpt: string,
  industries?: IntelIndustryItem[]
): Promise<SupplyContractClassification | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const r = await claudeMessages({
      feature: "intel.dart_supply_classify",
      model: MODEL,
      max_tokens: 500,
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(filerName, reportName, docExcerpt, industries) }],
      timeoutMs: 20000,
      cacheSystem: true,
    });
    if (!r.ok) return null;
    const text = r.text;
    const j = extractJson(text);
    return j ? normalize(j, industries) : null;
  } catch {
    return null;
  }
}
