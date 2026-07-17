/**
 * 공공입찰 분류 조건 그룹(match_rule) 평가/SQL 변환 — bid_categories(077).
 * 그룹 내 키워드는 op(AND=모두 포함 / OR=하나라도 포함 / NOR=모두 미포함)로,
 * 그룹 간은 AND 로 결합한다. 예) [통합환경 OR 통합허가] AND [NOR 조성공사, 개선공사]
 * → "통합환경 조성공사" 같은 무관 건 소거.
 */

export type RuleOp = "and" | "or" | "nor";

export interface RuleGroup {
  op: RuleOp;
  keywords: string[];
}

const OPS: RuleOp[] = ["and", "or", "nor"];

/** 저장된 jsonb(match_rule.groups 또는 그룹 배열)를 정제 — 빈 키워드·빈 그룹 제거. */
export function normalizeGroups(raw: unknown): RuleGroup[] {
  const arr = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { groups?: unknown }).groups)
      ? ((raw as { groups: unknown[] }).groups)
      : [];
  const out: RuleGroup[] = [];
  for (const g of arr) {
    if (!g || typeof g !== "object") continue;
    const opRaw = String((g as { op?: unknown }).op ?? "or").toLowerCase();
    const op = (OPS.includes(opRaw as RuleOp) ? opRaw : "or") as RuleOp;
    const kwRaw = (g as { keywords?: unknown }).keywords;
    const keywords = Array.isArray(kwRaw) ? kwRaw.map((k) => String(k).trim()).filter(Boolean) : [];
    if (keywords.length) out.push({ op, keywords: keywords.slice(0, 20) });
  }
  return out.slice(0, 10);
}

/** 분류에서 유효 규칙을 얻는다 — match_rule 우선, 없으면 keywords 를 OR 단일 그룹으로(하위호환). */
export function ruleFromCategory(cat: { rule?: RuleGroup[] | null; keywords: string[] }): RuleGroup[] {
  if (cat.rule?.length) return cat.rule;
  const keywords = cat.keywords.map((k) => k.trim()).filter(Boolean);
  return keywords.length ? [{ op: "or", keywords }] : [];
}

/** 텍스트(사업명)가 조건 그룹 전체(AND)를 만족하는지 — 배치 매칭용. */
export function evaluateGroups(text: string | null | undefined, groups: RuleGroup[]): boolean {
  if (!groups.length) return false;
  const t = (text ?? "").trim();
  if (!t) return false;
  for (const g of groups) {
    const hit = g.keywords.some((k) => t.includes(k));
    if (g.op === "and" && !g.keywords.every((k) => t.includes(k))) return false;
    if (g.op === "or" && !hit) return false;
    if (g.op === "nor" && hit) return false;
  }
  return true;
}

/**
 * 조건 그룹을 SQL WHERE 절로 — 목록 검색 필터용. add 는 파라미터 바인딩 콜백($n 반환).
 * col 은 호출측 상수(식별자 주입 없음). 그룹이 없으면 null.
 */
export function buildRuleWhere(
  groups: RuleGroup[],
  add: (v: unknown) => string,
  col = "title"
): string | null {
  if (!groups.length) return null;
  const parts: string[] = [];
  for (const g of groups) {
    const likes = g.keywords.map((k) => `${col} LIKE ${add(`%${k}%`)}`);
    if (!likes.length) continue;
    if (g.op === "and") parts.push(`(${likes.join(" AND ")})`);
    else if (g.op === "or") parts.push(`(${likes.join(" OR ")})`);
    else parts.push(`NOT (${likes.join(" OR ")})`);
  }
  return parts.length ? `(${parts.join(" AND ")})` : null;
}

/** 규칙 요약 문자열 — UI 표시용. 예: [통합환경∨통합허가] AND [¬(조성공사∨개선공사)] */
export function ruleSummary(groups: RuleGroup[]): string {
  if (!groups.length) return "";
  return groups
    .map((g) => {
      const kw = g.keywords.join(g.op === "and" ? "∧" : "∨");
      return g.op === "nor" ? `[¬(${kw})]` : `[${kw}]`;
    })
    .join(" AND ");
}
