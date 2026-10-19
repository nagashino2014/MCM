/*
 * 완료 조건 검사(276, 2026-10-14) — 순수 함수. 서버(lib/todo/store.ts completeItem·updateItem)·웹 완료 확인 모달·모바일 완료 시트가 공유한다.
 * 규칙: subtasks = 미완 하위 작업 0건 · note = 완료 메모 입력 · review = 검토 단계 경유(reviewed_at 기록 또는 현재 상태 review).
 * 모바일 복제본: apps/mobile/src/lib/todo-completion.ts(동기화 유지).
 */
import { TODO_COMPLETE_RULE_KEYS, TODO_COMPLETE_RULE_SHORT_LABELS, type TodoCompleteRuleKey, type TodoCompleteRules } from "./types";

/** 입력(jsonb·요청 본문)을 규칙 객체로 — 알 수 없는 키·거짓 값은 버린다. 객체가 아니면 {}. */
export function normalizeCompleteRules(v: unknown): TodoCompleteRules {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: TodoCompleteRules = {};
  const src = v as Record<string, unknown>;
  for (const k of TODO_COMPLETE_RULE_KEYS) {
    const raw = src[k];
    if (raw === true || raw === 1 || raw === "1" || raw === "true") out[k] = true;
  }
  return out;
}

/** 켜진 규칙 키 목록(고정 순서). */
export const activeCompleteRuleKeys = (rules: TodoCompleteRules | null | undefined): TodoCompleteRuleKey[] =>
  rules ? TODO_COMPLETE_RULE_KEYS.filter((k) => rules[k] === true) : [];

export const hasAnyCompleteRule = (rules: TodoCompleteRules | null | undefined): boolean => activeCompleteRuleKeys(rules).length > 0;

/** 검사에 필요한 사실 — 서버는 DB 행, 화면은 목록/상세 응답에서 채운다. */
export interface CompletionFacts {
  status: string;
  /** 미완(status<>done) 하위 작업 수. */
  openSubtasks: number;
  /** 미완료 선행 작업 수(288). 생략 시 0. */
  openDeps?: number;
  /** 입력하려는 완료 메모(없으면 기존 completion_note). */
  completionNote: string | null | undefined;
  reviewedAt: string | null | undefined;
}

export interface CompletionCheck {
  ok: boolean;
  missing: TodoCompleteRuleKey[];
  openSubtasks: number;
  openDeps: number;
}

/** 완료 가능 여부 — 미충족 규칙을 고정 순서로 돌려준다. 규칙이 없으면 항상 ok. */
export function checkCompletion(rules: TodoCompleteRules | null | undefined, facts: CompletionFacts): CompletionCheck {
  const missing: TodoCompleteRuleKey[] = [];
  const openSubtasks = Math.max(0, Math.floor(Number(facts.openSubtasks) || 0));
  const openDeps = Math.max(0, Math.floor(Number(facts.openDeps) || 0));
  if (rules?.subtasks && openSubtasks > 0) missing.push("subtasks");
  if (rules?.note && !(facts.completionNote ?? "").trim()) missing.push("note");
  if (rules?.review && !facts.reviewedAt && facts.status !== "review") missing.push("review");
  if (rules?.deps && openDeps > 0) missing.push("deps");
  return { ok: missing.length === 0, missing, openSubtasks, openDeps };
}

/** 미충족 규칙 안내 문구(모달·시트·409 메시지 공용). */
export function describeMissingRule(key: TodoCompleteRuleKey, openSubtasks = 0, openDeps = 0): string {
  switch (key) {
    case "deps":
      return `선행 작업 ${openDeps}건 미완료 — 선행이 모두 끝나야 합니다`;
    case "subtasks":
      return `하위 작업 ${openSubtasks}건 미완료 — 모두 완료해야 합니다`;
    case "note":
      return "완료 메모를 입력해야 합니다";
    case "review":
      return "검토 단계를 거치지 않았습니다 — 상태를 검토로 바꾼 뒤 완료하세요";
  }
}

/** 409 본문 error 문구 — 첫 미충족 규칙 기준. */
export function completionErrorMessage(check: CompletionCheck): string {
  if (check.ok) return "";
  return `완료 조건을 충족하지 않았습니다. ${describeMissingRule(check.missing[0], check.openSubtasks, check.openDeps)}.`;
}

/** 접힘 요약 "하위 작업·메모" — 켜진 규칙이 없으면 null. */
export function completeRulesSummary(rules: TodoCompleteRules | null | undefined): string | null {
  const keys = activeCompleteRuleKeys(rules);
  return keys.length ? keys.map((k) => TODO_COMPLETE_RULE_SHORT_LABELS[k]).join("·") : null;
}

/** 두 규칙 객체가 같은지(켜진 키 기준). */
export const sameCompleteRules = (a: TodoCompleteRules | null | undefined, b: TodoCompleteRules | null | undefined): boolean =>
  activeCompleteRuleKeys(a).join(",") === activeCompleteRuleKeys(b).join(",");
