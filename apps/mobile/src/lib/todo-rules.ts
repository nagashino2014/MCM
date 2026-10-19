/*
 * 보드 자동화 규칙(296, §29-2) — 모바일 복제본(원본 frontend/lib/todo/rules-shared.ts 의 상수·타입·설명 문장만, 검증은 서버가 한다. 동기화 유지).
 */
import { TODO_LINK_KIND_LABELS, TODO_STATUS_LABELS, type TodoLinkKind, type TodoStatus } from './todo-types';

export const TODO_RULE_TRIGGERS = ['completed', 'status', 'due_before', 'subtasks_done'] as const;
export type TodoRuleTriggerKind = (typeof TODO_RULE_TRIGGERS)[number];
export const TODO_RULE_TRIGGER_LABELS: Record<TodoRuleTriggerKind, string> = {
  completed: '완료됐을 때',
  status: '상태가 바뀌었을 때',
  due_before: '마감 N일 전',
  subtasks_done: '하위 작업 모두 완료',
};

export const TODO_RULE_ACTIONS = ['set_status', 'assign', 'notify', 'apply_template'] as const;
export type TodoRuleActionKind = (typeof TODO_RULE_ACTIONS)[number];
export const TODO_RULE_ACTION_LABELS: Record<TodoRuleActionKind, string> = {
  set_status: '상태 변경',
  assign: '담당 지정',
  notify: '알림 보내기',
  apply_template: '템플릿 적용',
};

export interface TodoRuleTrigger {
  kind: TodoRuleTriggerKind;
  status?: TodoStatus;
  days?: number;
}
export interface TodoRuleCondition {
  priorityMin?: number;
  titlePrefix?: string;
  linkKind?: TodoLinkKind;
}
export interface TodoRuleAction {
  kind: TodoRuleActionKind;
  status?: TodoStatus;
  assignee?: string;
  roomId?: number | null;
  inApp?: boolean;
  message?: string;
  templateId?: string;
}
export interface TodoBoardRule {
  ruleId: string;
  boardId: string;
  name: string;
  enabled: boolean;
  trigger: TodoRuleTrigger;
  condition: TodoRuleCondition;
  action: TodoRuleAction;
  position: number;
  runCount: number;
  lastRunAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const TODO_RULE_MAX_PER_BOARD = 20;
export const TODO_RULE_DEFAULT_MESSAGE = '[할 일] {title} — {status} ({assignee})';

export function describeRule(
  r: Pick<TodoBoardRule, 'trigger' | 'condition' | 'action'>,
  names?: { users?: Record<string, string>; rooms?: Record<string, string>; templates?: Record<string, string> }
): string {
  const t = r.trigger;
  const when =
    t.kind === 'completed'
      ? '완료되면'
      : t.kind === 'status'
        ? `상태가 '${t.status ? TODO_STATUS_LABELS[t.status] : '?'}'로 바뀌면`
        : t.kind === 'due_before'
          ? t.days === 0
            ? '마감 당일에'
            : `마감 ${t.days ?? 1}일 전에`
          : '하위 작업이 모두 완료되면';
  const conds: string[] = [];
  if (r.condition.priorityMin) conds.push(`우선순위 ${r.condition.priorityMin} 이상`);
  if (r.condition.titlePrefix) conds.push(`제목이 '${r.condition.titlePrefix}'로 시작`);
  if (r.condition.linkKind) conds.push(`관련이 ${TODO_LINK_KIND_LABELS[r.condition.linkKind] ?? r.condition.linkKind}`);
  const cond = conds.length ? `(${conds.join(' · ')}인 할 일만) ` : '';
  const a = r.action;
  const act =
    a.kind === 'set_status'
      ? `상태를 '${a.status ? TODO_STATUS_LABELS[a.status] : '?'}'로 바꿉니다`
      : a.kind === 'assign'
        ? `담당자를 ${a.assignee === 'owner' ? '작성자' : (names?.users?.[a.assignee ?? ''] ?? a.assignee ?? '?')}(으)로 지정합니다`
        : a.kind === 'notify'
          ? `${a.roomId ? `'${names?.rooms?.[String(a.roomId)] ?? `방 #${a.roomId}`}' 방에 알리고 ` : ''}${a.inApp ? '담당자에게 인앱 알림을 보냅니다' : ''}`.replace(/고 $/, '니다')
          : `'${names?.templates?.[a.templateId ?? ''] ?? '템플릿'}' 체크리스트를 적용합니다`;
  return `${when} ${cond}${act}`.replace(/\s+/g, ' ').trim();
}
