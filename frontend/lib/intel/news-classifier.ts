// 뉴스 → 발주 신호 분류·구조화 추출 (Claude Haiku 4.5).
// summarize.ts 의 Anthropic Messages API 직접 호출 패턴 재사용. ANTHROPIC_API_KEY 없으면 null(분류 skip).
// 목적: 네이버 뉴스 검색은 노이즈(해외공장·실적/주가·시황)가 많으므로, '국내 공장 신설/증설/투자'
//       신호만 판별하고 회사명·위치·규모를 뽑아 facilities 매칭·적재에 쓴다.

import type { IntelSignalType } from "./signal-extractor";
import type { IntelIndustryItem } from "./intel-settings";
import type { IndustryRelevance } from "./industry-rules";

const MODEL = "claude-haiku-4-5-20251001";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export interface NewsClassification {
  isSignal: boolean; // 국내 공장 신설/증설/투자 신호 여부
  signalType: IntelSignalType; // new_site/expansion/investment/other
  companyName: string | null; // 사업 주체(발주·투자 기업)
  location: string | null; // 위치(시/군/구/산단)
  scale: string | null; // 규모(투자액·면적 등 원문 표현)
  confidence: "high" | "medium" | "low";
  summary: string | null; // 한 줄 요약(한국어)
  industry: string | null; // 통합허가 대상 업종 id(설정 목록 매핑, 산업단지=industrial-complex)
  industryRelevance: IndustryRelevance | null; // direct/supply_chain/low/none (industries 미전달 시 null)
  relevanceNote: string | null; // supply_chain 일 때 유발 경로 한 줄
}

const SYSTEM =
  "당신은 한국 제조업 설비투자 뉴스 분석가입니다. 통합환경허가 대행 영업을 위해, 기사가 " +
  "'국내(한국) 공장·생산시설의 신설/증설/투자 계획' 신호인지 판별하고 핵심을 구조화 추출합니다. " +
  "반드시 JSON 하나만 출력하고 그 외 설명은 쓰지 않습니다.";

function buildPrompt(title: string, description: string, industries?: IntelIndustryItem[]): string {
  const industryBlock = industries?.length
    ? "- industry: 사업 주체 업종이 아래 [대상 업종] 중 하나면 그 명칭(정확히), 산업단지·농공단지 조성이면 \"산업단지\", 해당 없으면 null.\n" +
      "- industryRelevance: direct=주체 사업 자체가 대상 업종(또는 산업단지 조성) / " +
      "supply_chain=주체는 비대상이나 대상 업종의 후속 투자·입주를 유발(예: EV 완성차 증설→배터리·부품 후속 수요) / " +
      "low=제조업이지만 대상 업종·규모와 거리 / none=비제조·무관.\n" +
      "- relevanceNote: supply_chain 일 때만 유발 경로 한 줄, 그 외 null.\n" +
      `[대상 업종] ${industries.map((i) => (i.note ? `${i.label}(${i.note})` : i.label)).join(", ")}\n\n`
    : "";
  const industryOut = industries?.length
    ? ', "industry": "업종명 또는 산업단지 또는 null", "industryRelevance": "direct|supply_chain|low|none", "relevanceNote": "유발경로 또는 null"'
    : "";
  return (
    "다음 뉴스가 '국내(한국) 공장·생산시설의 신설/증설/투자' 신호인지 판별하고 JSON만 출력하세요.\n" +
    "- isSignal=false 예: 해외공장, 실적/주가/목표가 분석·종목 추천, 단순 시황, 지분·M&A, 정책/행정 일반, 이미 가동 중 단순 소개.\n" +
    "- isSignal=false 추가: 기사 자체의 주제가 투자 발표가 아닌 파생·반응 기사 — 부동산 분양·주택시장 반응, " +
    "지역 개발 기대감, 칼럼·사설·인터뷰·정치 논평, 단순 물품 공급·납품 계약(생산시설 신·증설 없음). " +
    "투자 사실이 배경으로만 언급되면 false 입니다.\n" +
    "- isSignal=true 예: '○○사 ○○공장 증설', '○○산단 신규 공장 건설', '생산라인 신·증설 투자 결정' — " +
    "기사의 주제가 특정 기업·기관의 투자·신증설 발표/진행 그 자체일 때만.\n" +
    "- signalType: 신설/이전신축=new_site, 증설/확장=expansion, 투자결정(단계미상)=investment, 그 외=other.\n" +
    industryBlock +
    `[제목] ${title}\n[본문] ${description}\n\n` +
    "출력(JSON만, 코드펜스 없이):\n" +
    '{"isSignal": true, "signalType": "new_site|expansion|investment|other", "companyName": "회사명 또는 null", ' +
    `"location": "위치 또는 null", "scale": "규모표현 또는 null", "confidence": "high|medium|low", "summary": "한국어 한 줄 요약"${industryOut}}`
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

const RELEVANCES: IndustryRelevance[] = ["direct", "supply_chain", "low", "none"];

/** LLM 이 답한 업종 라벨 → 설정 목록의 id. "산업단지"는 특수 키. 매핑 실패 시 null. */
function industryIdFromLabel(label: string | null, industries?: IntelIndustryItem[]): string | null {
  if (!label) return null;
  if (/산업단지|산단|농공단지/.test(label)) return "industrial-complex";
  const hit = industries?.find((i) => i.label === label || label.includes(i.label));
  return hit?.id ?? null;
}

function normalize(j: Record<string, unknown>, industries?: IntelIndustryItem[]): NewsClassification {
  const st = String(j.signalType ?? "other") as IntelSignalType;
  const conf = String(j.confidence ?? "low").toLowerCase();
  const rel = str(j.industryRelevance) as IndustryRelevance | null;
  const relevance = industries?.length ? (rel && RELEVANCES.includes(rel) ? rel : null) : null;
  const industry = industries?.length ? industryIdFromLabel(str(j.industry), industries) : null;
  return {
    isSignal: j.isSignal === true || String(j.isSignal).toLowerCase() === "true",
    signalType: SIGNAL_TYPES.includes(st) ? st : "other",
    companyName: str(j.companyName),
    location: str(j.location),
    scale: str(j.scale),
    confidence: conf === "high" || conf === "medium" ? (conf as "high" | "medium") : "low",
    summary: str(j.summary),
    // direct 인데 업종 미매핑이면 'other'(대상이나 업종 미상)로 보정
    industry: industry ?? (relevance === "direct" ? "other" : null),
    industryRelevance: relevance,
    relevanceNote: relevance === "supply_chain" ? str(j.relevanceNote) : null,
  };
}

/**
 * 뉴스 제목+본문을 Haiku 로 분류. 키 없음/오류 시 null(수집측은 미분류로 처리).
 * industries 전달 시 업종 태깅(industry/industryRelevance/relevanceNote)도 함께 판별한다.
 */
export async function classifyNews(
  title: string,
  description: string,
  industries?: IntelIndustryItem[]
): Promise<NewsClassification | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system: SYSTEM,
        messages: [{ role: "user", content: buildPrompt(title, description, industries) }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
    const j = extractJson(text);
    return j ? normalize(j, industries) : null;
  } catch {
    return null;
  }
}
