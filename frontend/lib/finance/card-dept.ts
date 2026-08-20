// 법인카드 ↔ 부서 매핑 — 카드 별칭에 부서가 적혀 있다는 실데이터 관례를 규칙으로 옮긴 것.
// (실측 별칭: "통합1본부1" · "통합1본부2" · "통합2본부1" · "총괄본부장" · 미기입 2장)
// 기안 화면의 "법인카드 내역 불러오기"에서 **내 부서 카드를 먼저 보여 주기** 위해 쓴다
// — 등록 카드 전체를 한 목록에 늘어놓으면 본인 사용분을 찾기 어렵다(사용자 요구 2026-08-20).
// 별칭이 비어 있으면 매칭되지 않는다 → 연결 관리에서 별칭을 채우면 그때부터 부서로 묶인다.

export interface DeptCardRule {
  deptId: string;
  /** 태그에 쓸 짧은 이름(사용자 지정) */
  short: string;
  /** 별칭에 이 조각이 들어 있으면 그 부서 카드로 본다 */
  patterns: string[];
}

export const DEPT_CARD_RULES: DeptCardRule[] = [
  { deptId: "integrated-env-1", short: "1본부", patterns: ["통합1", "통합환경1"] },
  { deptId: "integrated-env-2", short: "2본부", patterns: ["통합2", "통합환경2"] },
  { deptId: "chemical-safety", short: "화학", patterns: ["화학"] },
  { deptId: "carbon-neutral-lab", short: "연구소", patterns: ["연구소", "탄소"] },
  { deptId: "ulsan-branch", short: "울산", patterns: ["울산"] },
  { deptId: "sales-management", short: "영업", patterns: ["영업"] },
  // 총괄(임원) — 별칭이 직책·성명이라 태그도 별칭을 그대로 쓴다(cardTagLabel 참고).
  { deptId: "exec", short: "총괄", patterns: ["총괄", "대표", "임원"] },
];

const strip = (v: string) => v.replace(/\s+/g, "");

/** 별칭으로 부서를 추정한다 — 못 찾으면 null(미지정 카드로 묶인다). */
export function cardDeptId(alias: string | null | undefined): string | null {
  const a = strip(alias ?? "");
  if (!a) return null;
  return DEPT_CARD_RULES.find((r) => r.patterns.some((p) => a.includes(p)))?.deptId ?? null;
}

/**
 * 카드 태그 문구 — "1본부 7742" 처럼 짧은 이름 + 카드번호 뒤 4자리.
 * 임원 카드(총괄)와 규칙에 안 걸리는 카드는 별칭을 그대로 쓴다("총괄본부장 2259").
 * 별칭조차 없으면 카드사명으로 대신한다("롯데카드 2242" — 연결 관리에서 별칭을 채우면 바뀐다).
 */
export function cardTagLabel(
  alias: string | null | undefined,
  last4: string,
  companyName: string | null | undefined,
): string {
  const a = (alias ?? "").trim();
  const deptId = cardDeptId(a);
  const rule = deptId ? DEPT_CARD_RULES.find((r) => r.deptId === deptId) : undefined;
  const head = rule && rule.deptId !== "exec" ? rule.short : a || (companyName ?? "").trim() || "카드";
  return `${head} ${last4}`.trim();
}
