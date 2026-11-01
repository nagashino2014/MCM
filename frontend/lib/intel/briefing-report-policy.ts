/** 저장·화면·PDF에 공통으로 적용하는 보고서 표시 규칙. */
import type { BriefingReport } from "./rag-queries";

export const BRIEFING_ITEM_LIMIT = 15;
const AMBIGUOUS_PROJECT_NOTE = "여러 사업이 같은 수집 근거에 연결되어 있습니다. 사업별 프로젝트를 확인한 뒤 영업에 연결하세요.";

/** 여러 투자 항목이 같은 업무 프로젝트를 가리키면 사업별 확인 전까지 파생 정보·링크만 보류한다. */
export function separateAmbiguousProjectLinks(companies: BriefingReport["companies"]): BriefingReport["companies"] {
  const count = new Map<string, number>();
  for (const company of companies) if (company.projectId) count.set(company.projectId, (count.get(company.projectId) ?? 0) + 1);
  return companies.map(company => {
    if (!company.projectId || (count.get(company.projectId) ?? 0) < 2) return company;
    const prior = company.note?.text.trim() ?? "";
    const preserved = prior && company.note?.kind && company.note.kind !== "확인 필요" ? `[${company.note.kind}] ${prior}` : prior;
    return { ...company, projectId: null, status: null, facts: [], note: { kind: "확인 필요", text: prior.includes(AMBIGUOUS_PROJECT_NOTE) ? preserved : [preserved, AMBIGUOUS_PROJECT_NOTE].filter(Boolean).join("\n") } };
  });
}

const BADGES: Record<string, string> = { "우선 검토": "우선 검토", "우선 접촉": "우선 검토", "확인 필요": "확인 필요", "차순위": "확인 필요", "타이밍": "확인 필요", "한계": "확인 필요", "참고": "참고" };
const RANK: Record<string, number> = { "우선 검토": 0, "확인 필요": 1, "참고": 2 };
export function sortBriefingInsights<T extends { badge: string; importance?: number }>(items: T[]): T[] {
  return items.map((item, index) => ({ item: { ...item, badge: BADGES[item.badge] ?? "참고" }, index }))
    .sort((a, b) => RANK[a.item.badge] - RANK[b.item.badge] || (b.item.importance ?? 0) - (a.item.importance ?? 0) || a.index - b.index)
    .map(({ item }) => item);
}
