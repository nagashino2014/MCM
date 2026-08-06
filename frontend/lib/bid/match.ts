/**
 * 공공입찰 분류 조건 그룹(match_rule) 평가/SQL 변환 — bid_categories(077).
 * 그룹 내 키워드는 op(AND=모두 포함 / OR=하나라도 포함 / NOT=모두 동시 포함만 제외 / NOR=하나라도 있으면 제외)로,
 * 그룹 간은 AND 로 결합한다. 예) [통합환경 OR 통합허가] AND [NOR 조성공사, 개선공사]
 * → "통합환경 조성공사" 같은 무관 건 소거.
 * NOT 은 AND 의 부정(NAND) — [NOT 하수도, 공사] 는 "하수도 공사"만 제외하고 "하수도 시설"은 통과.
 * 제외 그룹(NOT/NOR)의 except 는 "제외어 검사에서 가릴 문구" — 사업명에서 먼저 지운 뒤 제외어를 찾는다.
 * 예) 제외 [수도시설] + 예외 [하수도시설] → "OO하수도시설 기술진단"은 통과, "OO하수도시설 정비공사"는
 * 마스킹 후에도 '공사'가 남아 정상 제외. 부분문자열 오탐(하수도시설⊃수도시설)만 정확히 무력화한다.
 */

export type RuleOp = "and" | "or" | "not" | "nor";

export interface RuleGroup {
  op: RuleOp;
  keywords: string[];
  /** 제외 그룹(not|nor) 전용 — 제외어 판정 전 사업명에서 가릴 문구. */
  except?: string[];
}

const OPS: RuleOp[] = ["and", "or", "not", "nor"];

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
    const exRaw = (g as { except?: unknown }).except;
    // 예외는 제외 그룹에서만 의미가 있다(포함 그룹에 들어와도 무시).
    const except =
      (op === "not" || op === "nor") && Array.isArray(exRaw)
        ? exRaw.map((k) => String(k).trim()).filter(Boolean).slice(0, 20)
        : [];
    if (keywords.length) {
      out.push({ op, keywords: keywords.slice(0, 20), ...(except.length ? { except } : {}) });
    }
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
    // 제외 그룹은 예외 문구를 지운 사본에서 판정 — 부분문자열 오탐만 무력화.
    const target = g.except?.length ? g.except.reduce((s, e) => s.split(e).join(" "), t) : t;
    const hit = g.keywords.some((k) => target.includes(k));
    const all = g.keywords.every((k) => target.includes(k));
    if (g.op === "and" && !g.keywords.every((k) => t.includes(k))) return false;
    if (g.op === "or" && !g.keywords.some((k) => t.includes(k))) return false;
    if (g.op === "not" && all) return false;
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
    if (!g.keywords.length) continue;
    if (g.op === "and" || g.op === "or") {
      const likes = g.keywords.map((k) => `${col} LIKE ${add(`%${k}%`)}`);
      parts.push(`(${likes.join(g.op === "and" ? " AND " : " OR ")})`);
      continue;
    }
    // 제외 그룹 — 예외 문구를 replace 로 지운 사본에서 제외어를 찾는다(평가기와 동일 규칙).
    const target = (g.except ?? []).reduce((expr, e) => `replace(${expr}, ${add(e)}, ' ')`, col);
    const likes = g.keywords.map((k) => `${target} LIKE ${add(`%${k}%`)}`);
    parts.push(`NOT (${likes.join(g.op === "not" ? " AND " : " OR ")})`);
  }
  return parts.length ? `(${parts.join(" AND ")})` : null;
}

/** 규칙 요약 문자열 — UI 표시용. 예: [통합환경∨통합허가] AND [¬(조성공사∨개선공사)] */
export function ruleSummary(groups: RuleGroup[]): string {
  if (!groups.length) return "";
  return groups
    .map((g) => {
      const kw = g.keywords.join(g.op === "and" || g.op === "not" ? "∧" : "∨");
      if (g.op !== "nor" && g.op !== "not") return `[${kw}]`;
      const ex = g.except?.length ? ` 단 ${g.except.join("∨")} 제외` : "";
      return `[¬(${kw})${ex}]`;
    })
    .join(" AND ");
}
