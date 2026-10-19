"use client";

// 완료 조건 체크박스 3개(276) — 상세 '부가 설정 › 완료 조건' · 보드 생성 '기본 완료 조건' · 보드 ⋯ 메뉴 '기본 완료 조건' 공용.
// 하위 작업 모두 완료 / 완료 메모 입력 / 검토 단계 경유. 값은 TodoCompleteRules(켜진 키만 true).

import { CdCheckbox } from "@/components/cdash";
import { TODO_COMPLETE_RULE_KEYS, TODO_COMPLETE_RULE_LABELS, type TodoCompleteRules } from "@/lib/todo/types";

const RULE_HINTS: Record<(typeof TODO_COMPLETE_RULE_KEYS)[number], string> = {
  subtasks: "미완 하위 작업이 남아 있으면 완료할 수 없습니다",
  note: "완료 확인 창에서 메모를 적어야 완료됩니다",
  review: "상태를 '검토'로 한 번 거쳐야 완료할 수 있습니다",
  deps: "선행 작업(의존 관계)이 모두 완료돼야 완료할 수 있습니다",
};

export function CompleteRulesFields({ value, disabled, hints, onChange }: { value: TodoCompleteRules; disabled?: boolean; hints?: boolean; onChange: (next: TodoCompleteRules) => void }) {
  return (
    <div className="todo-rules" role="group" aria-label="완료 조건">
      {TODO_COMPLETE_RULE_KEYS.map((k) => (
        <div key={k} className="todo-rule">
          <CdCheckbox
            label={TODO_COMPLETE_RULE_LABELS[k]}
            checked={!!value[k]}
            disabled={disabled}
            onChange={(e) => {
              const next: TodoCompleteRules = { ...value };
              if (e.target.checked) next[k] = true;
              else delete next[k];
              onChange(next);
            }}
          />
          {hints && <span className="todo-rule-hint">{RULE_HINTS[k]}</span>}
        </div>
      ))}
    </div>
  );
}
