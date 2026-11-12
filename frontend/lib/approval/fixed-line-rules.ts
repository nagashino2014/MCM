// 양식별 고정 결재선(335) — 순수 규칙(클라이언트 안전). DB 로더는 lib/approval/fixed-line.ts.
// 설계: docs/approval-fixed-line-plan-2026-11-03.md §3-2.
//   1) 사다리 역할(부서장 < 임원 < 대표이사) 중 기안자 지위 이상인 단계는 뺀다.
//   2) 관리자 단계 담당자가 기안자 본인이면 fallbackRole(없으면 한 칸 위 사다리 역할)로 바꾼다.
//   3) 다 빠져 비면 기안자보다 한 칸 위 사다리 역할을 넣는다 — 대표이사 본인은 본인 1단계.
//   4) 연달아 같은 사람은 한 번만(연구소 부서장=임원 신총식).
//   5) 하나라도 못 풀면(공석·부서장 복수·담당자 미지정·퇴사) 상신 불가 — errors 에 이유를 담는다.
//   6) headDrafterTo(347) — 기안자가 부서장이면 사다리를 그 역할까지 채운다(휴가 등: 부서장 기안 → 임원 → 대표이사).
//   7) 기안자별 추가 결재자(353) — 위 결과에 관리자가 직원별로 정한 결재자를 끼운다(insertDrafterExtras).

export type LineRole = "dept_head" | "exec" | "ceo" | "manager";

export const LINE_ROLES: LineRole[] = ["dept_head", "exec", "ceo", "manager"];

export const LINE_ROLE_LABELS: Record<LineRole, string> = {
  dept_head: "부서장",
  exec: "임원",
  ceo: "대표이사",
  manager: "관리자",
};

/** 사다리 서열 — 관리자(manager)는 사다리 밖(지위와 무관한 지정 담당). */
const LADDER_RANK: Partial<Record<LineRole, number>> = { dept_head: 1, exec: 2, ceo: 3 };
const LADDER: LineRole[] = ["dept_head", "exec", "ceo"];

/** 결재선 단계 표기 역할 — 템플릿 역할 + 기안자별 추가 결재자(353). 템플릿에는 extra 를 쓰지 않는다. */
export type LineStepRole = LineRole | "extra";

export const LINE_STEP_ROLE_LABELS: Record<LineStepRole, string> = { ...LINE_ROLE_LABELS, extra: "추가 결재" };

/** 기안자별 추가 결재자 자리(353) — 맨 앞 · 마지막 결재자 바로 앞 · 맨 뒤(최종 결재) */
export type ExtraPosition = "first" | "before_last" | "last";

export const EXTRA_POSITIONS: ExtraPosition[] = ["first", "before_last", "last"];

export const EXTRA_POSITION_LABELS: Record<ExtraPosition, string> = {
  first: "맨 앞",
  before_last: "최종 결재자 바로 앞",
  last: "맨 뒤(최종 결재)",
};

export function parseExtraPosition(raw: unknown): ExtraPosition {
  return raw === "before_last" || raw === "last" ? raw : "first";
}

/** 기안자별 규칙(353) — 결재자 추가(approve)·참조(ref)·열람(view). formId '*' = 모든 양식. */
export type DrafterRuleKind = "approve" | "ref" | "view";

export const DRAFTER_RULE_KIND_LABELS: Record<DrafterRuleKind, string> = { approve: "결재자 추가", ref: "참조", view: "열람" };

export interface DrafterRuleLite {
  formId: string;
  kind: DrafterRuleKind;
  targetUserId: string;
  position: ExtraPosition | null;
  /** 정렬 기준(등록 순) */
  updatedAt?: string | null;
}

/** 양식에 적용할 기안자별 규칙 — 같은 대상이면 양식 행이 '*' 행을 덮어쓴다. 입력 순서를 지킨다. */
export function pickDrafterRules<T extends DrafterRuleLite>(rules: T[], formId: string): T[] {
  const byTarget = new Map<string, T>();
  for (const r of rules) if (r.formId === "*") byTarget.set(r.targetUserId, r);
  for (const r of rules) if (r.formId === formId) byTarget.set(r.targetUserId, r);
  return rules.filter((r) => byTarget.get(r.targetUserId) === r);
}

export interface LineTemplateStep {
  role: LineRole;
  /** 기안자가 이 단계 담당자 본인일 때 대신 넣을 역할(관리자 양식 → 대표이사, 2026-11-03 확정) */
  fallbackRole?: LineRole | null;
  /** 지정 대결자 — 담당자 부재(부재 등록·승인 휴가) 시 최종 단계라도 이 사람에게 넘긴다(D-2 예외) */
  proxyUserIds?: string[];
}

export interface LineEnforceWhen {
  field: string;
  equals: string;
  /** 필드 값이 없을 때 — enforce(강제) | skip(자유 지정) */
  whenMissing: "enforce" | "skip";
}

export interface LineTemplate {
  formId: string;
  steps: LineTemplateStep[];
  enforceWhen: LineEnforceWhen | null;
  enabled: boolean;
  /** 부서장이 기안하면 사다리를 이 역할까지 채운다(347, 2026-11-09 사용자 확정). 일반 직원·임원 기안에는 영향 없음 */
  headDrafterTo?: "exec" | "ceo" | null;
}

export function parseHeadDrafterTo(raw: unknown): "exec" | "ceo" | null {
  return raw === "exec" || raw === "ceo" ? raw : null;
}

export interface LinePerson {
  userId: string;
  name: string;
  position: string | null;
}

export interface FixedLineStep extends LinePerson {
  role: LineStepRole;
  /** 지정 대결자(기안자 본인 제외) */
  proxies: LinePerson[];
}

export type FixedLineResult =
  | { enforced: false; reason: "no_template" | "disabled" | "condition" | "not_ready" }
  | { enforced: true; ok: true; steps: FixedLineStep[]; enforceField: string | null }
  | { enforced: true; ok: false; steps: FixedLineStep[]; errors: string[]; enforceField: string | null };

/** 규칙 해석에 필요한 사실(DB 로더가 채운다). */
export interface FixedLineFacts {
  drafter: { userId: string; deptId: string | null; deptName: string | null };
  /** 기안 부서의 오늘 유효한 부서장 보직(재직·계정 연결). 직급 근사(fallback)는 쓰지 않는다. */
  deptHeads: LinePerson[];
  /** 기안 부서 기준 역할 담당자(부서 행 우선, 없으면 '*'). 재직·계정이 없으면 null. */
  roleUsers: Partial<Record<"exec" | "ceo" | "manager", LinePerson | null>>;
  /** 기안자가 임원(exec_member 또는 임원 담당 행) / 대표이사 담당자인지 */
  drafterIsExec: boolean;
  drafterIsCeo: boolean;
  /** 지정 대결자 신원(재직·계정 연결된 사람만) */
  people: Record<string, LinePerson>;
}

export function parseTemplateSteps(raw: unknown): LineTemplateStep[] {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const out: LineTemplateStep[] = [];
  for (const s of v as Record<string, unknown>[]) {
    if (!s || !LINE_ROLES.includes(s.role as LineRole)) continue;
    const fb = LINE_ROLES.includes(s.fallbackRole as LineRole) ? (s.fallbackRole as LineRole) : null;
    const proxies = Array.isArray(s.proxyUserIds) ? (s.proxyUserIds as unknown[]).map(String).filter(Boolean) : [];
    out.push({ role: s.role as LineRole, ...(fb ? { fallbackRole: fb } : {}), ...(proxies.length ? { proxyUserIds: proxies } : {}) });
  }
  return out;
}

export function parseEnforceWhen(raw: unknown): LineEnforceWhen | null {
  let v: unknown = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const field = String(o.field ?? "").trim();
  if (!field) return null;
  return { field, equals: String(o.equals ?? ""), whenMissing: o.whenMissing === "skip" ? "skip" : "enforce" };
}

/** 조건부 강제(계약서·견적서 최종안) 판정. */
export function isLineEnforced(tpl: LineTemplate, fieldValues: Record<string, unknown>): boolean {
  if (!tpl.enabled || !tpl.steps.length) return false;
  const w = tpl.enforceWhen;
  if (!w) return true;
  const v = fieldValues[w.field];
  if (v == null || String(v).trim() === "") return w.whenMissing === "enforce";
  return String(v) === w.equals;
}

/** 기안자 지위 — 0 직원 · 1 기안 부서 부서장 · 2 임원 · 3 대표이사 */
export function drafterRank(facts: FixedLineFacts): number {
  if (facts.drafterIsCeo) return 3;
  if (facts.drafterIsExec) return 2;
  if (facts.deptHeads.some((h) => h.userId === facts.drafter.userId)) return 1;
  return 0;
}

function resolveRole(role: LineRole, facts: FixedLineFacts, errors: string[]): LinePerson | null {
  if (role === "dept_head") {
    const dept = facts.drafter.deptName ?? "소속 부서";
    if (!facts.drafter.deptId) {
      errors.push("소속 부서가 없어 부서장을 찾을 수 없습니다. 인사 정보에서 소속 부서를 지정하세요.");
      return null;
    }
    if (!facts.deptHeads.length) {
      errors.push(`${dept}에 부서장이 지정돼 있지 않습니다. 직원 상세의 '겸직·부서장 보직'에서 부서장을 지정해야 상신할 수 있습니다.`);
      return null;
    }
    if (facts.deptHeads.length > 1) {
      errors.push(
        `${dept} 부서장 보직이 ${facts.deptHeads.length}명(${facts.deptHeads.map((h) => h.name).join(", ")})입니다. 한 명만 남겨야 상신할 수 있습니다.`
      );
      return null;
    }
    return facts.deptHeads[0];
  }
  const p = facts.roleUsers[role] ?? null;
  if (!p) errors.push(`'${LINE_ROLE_LABELS[role]}' 결재자가 지정돼 있지 않거나 재직 중이 아닙니다(결재 운영 > 고정 결재선에서 지정).`);
  return p;
}

/** 기안자 지위보다 한 칸 위 사다리 역할 — 대표이사 본인이면 null. */
function nextLadderAbove(rank: number): LineRole | null {
  return LADDER.find((r) => (LADDER_RANK[r] ?? 0) > rank) ?? null;
}

/** 고정 결재선 해석(템플릿 강제 여부는 호출부가 isLineEnforced 로 먼저 판정). */
export function resolveLineSteps(tpl: LineTemplate, facts: FixedLineFacts): { steps: FixedLineStep[]; errors: string[] } {
  const rank = drafterRank(facts);
  const me = facts.drafter.userId;
  const errors: string[] = [];
  const raw: Array<{ role: LineRole; person: LinePerson; proxyUserIds: string[] }> = [];

  const pushRole = (role: LineRole, proxyUserIds: string[] = []) => {
    const ladder = LADDER_RANK[role];
    // 사다리 역할이 기안자 지위 이하이면 그 단계는 뺀다(본인 자리 → 다음 단계로 올림)
    if (ladder != null && ladder <= rank) return;
    const person = resolveRole(role, facts, errors);
    if (!person || person.userId === me) return;
    raw.push({ role, person, proxyUserIds });
  };

  for (const step of tpl.steps) {
    if (step.role === "manager") {
      const person = resolveRole("manager", facts, errors);
      if (!person) continue;
      if (person.userId === me) {
        const fb = step.fallbackRole && step.fallbackRole !== "manager" ? step.fallbackRole : nextLadderAbove(rank);
        if (fb) pushRole(fb);
        continue;
      }
      raw.push({ role: "manager", person, proxyUserIds: step.proxyUserIds ?? [] });
      continue;
    }
    pushRole(step.role, step.proxyUserIds ?? []);
  }

  // 부서장 기안 — 템플릿이 정한 역할까지 빠진 사다리 단계를 뒤에 채운다(이미 있는 역할은 다시 넣지 않음)
  const headTo = tpl.headDrafterTo ? LADDER_RANK[tpl.headDrafterTo] ?? 0 : 0;
  if (rank === 1 && headTo > 1 && !errors.length) {
    for (const r of LADDER) {
      const lr = LADDER_RANK[r] ?? 0;
      if (lr <= rank || lr > headTo || raw.some((x) => x.role === r)) continue;
      pushRole(r);
    }
  }

  if (!raw.length && !errors.length) {
    const up = nextLadderAbove(rank);
    if (up) pushRole(up);
    // 대표이사 본인 기안 — 본인 1단계(2026-11-03 확정: 관리자 양식 외에는 본인만 결재선에)
    else raw.push({ role: "ceo", person: facts.roleUsers.ceo ?? { userId: me, name: "", position: null }, proxyUserIds: [] });
  }

  const steps: FixedLineStep[] = [];
  for (const r of raw) {
    const proxies = r.proxyUserIds
      .filter((id) => id !== me && id !== r.person.userId)
      .map((id) => facts.people[id])
      .filter((p): p is LinePerson => !!p);
    const last = steps[steps.length - 1];
    if (last && last.userId === r.person.userId) {
      // 같은 사람이 연달아 — 위 역할로 한 번만
      steps[steps.length - 1] = { ...last, role: r.role, proxies: proxies.length ? proxies : last.proxies };
      continue;
    }
    steps.push({ ...r.person, role: r.role, proxies });
  }
  return { steps, errors };
}

/**
 * 기안자별 추가 결재자(353)를 해석된 고정 결재선에 끼운다. 기안자 본인·이미 결재선에 있는 사람·중복은 건너뛴다.
 * 같은 자리의 추가 결재자는 입력 순서대로. 결재선이 비어 있으면(해석 실패) 그대로 둔다.
 * 순서: 맨 앞 → 고정 결재선 → 맨 뒤 추가분 순으로 이은 뒤, 그 줄의 최종 결재자 바로 앞에 '최종 결재자 바로 앞' 추가분을 넣는다.
 * '맨 뒤'가 있으면 최종 결재자는 마지막으로 등록된 맨 뒤 추가 결재자다(2026-11-12 결함 수정 — 종전엔 고정 결재선의 마지막 앞에 넣었다).
 */
export function insertDrafterExtras(
  steps: FixedLineStep[],
  extras: Array<{ person: LinePerson; position: ExtraPosition }>,
  drafterUserId: string
): FixedLineStep[] {
  if (!steps.length || !extras.length) return steps;
  const seen = new Set<string>([drafterUserId, ...steps.map((s) => s.userId)]);
  const groups: Record<ExtraPosition, FixedLineStep[]> = { first: [], before_last: [], last: [] };
  for (const e of extras) {
    if (!e.person?.userId || seen.has(e.person.userId)) continue;
    seen.add(e.person.userId);
    groups[e.position].push({ ...e.person, role: "extra", proxies: [] });
  }
  const tail = [...steps, ...groups.last];
  const final = tail[tail.length - 1];
  return [...groups.first, ...tail.slice(0, -1), ...groups.before_last, final];
}

/** 결재선 비교 — 승인 단계 결재자 순서가 같은가(합의·병렬 없음). */
export function sameLineAssignees(a: Array<{ assigneeUserId: string; stepType?: string }>, b: Array<{ userId: string }>): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.assigneeUserId === b[i].userId && (s.stepType ?? "approve") === "approve");
}

/** 결재선 표기 — "한도경(부서장) → 정득종(임원) → 이유억(대표이사)" */
export function describeFixedLine(steps: FixedLineStep[]): string {
  return steps.map((s) => `${s.name}(${LINE_STEP_ROLE_LABELS[s.role]})`).join(" → ");
}
