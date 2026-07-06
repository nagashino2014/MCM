// 공시 보고서명(report_nm) 규칙 기반 신호 분류. API & RAG 1차(정형).
// 관심 신호(투자·증설·신설)에 해당하면 유형 반환, 아니면 null(수집 대상 아님).
// 금액 추출은 본문 API(document) 파싱이 필요해 2차로 미룸.

export type IntelSignalType = "investment" | "expansion" | "new_site" | "other";

export const INTEL_SIGNAL_TYPE_LABELS: Record<IntelSignalType, string> = {
  investment: "투자",
  expansion: "증설",
  new_site: "신설",
  other: "기타",
};

// 우선순위 순(위에서부터 매칭). 키워드는 공백 제거 후 비교.
const RULES: { type: IntelSignalType; keywords: string[] }[] = [
  { type: "new_site", keywords: ["공장신설", "신규공장", "신설"] },
  { type: "expansion", keywords: ["증설", "유형자산취득", "유형자산양수", "설비투자"] },
  { type: "investment", keywords: ["신규시설투자", "시설투자", "타법인주식및출자증권취득", "출자"] },
];

/** report_nm이 관심 신호에 해당하면 유형 반환, 아니면 null. */
export function classifySignal(reportName: string): IntelSignalType | null {
  const name = (reportName ?? "").replace(/\s+/g, "");
  for (const rule of RULES) {
    if (rule.keywords.some((k) => name.includes(k))) return rule.type;
  }
  return null;
}
