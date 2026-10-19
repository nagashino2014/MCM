/*
 * 보드 자동화 규칙(296, §29-2) — 순수 모듈(서버·클라이언트 공용): 타입·상수·정규화·문장 설명.
 *   1차 범위(결정 K): 트리거 4종(완료됐을 때 / 상태가 X로 바뀌었을 때 / 마감 N일 전 / 하위 작업 모두 완료) ×
 *   행동 4종(상태 변경 / 담당 지정 / 알림(메신저 방·인앱) / 체크리스트 템플릿 적용). 조건은 선택(우선순위 이상·제목 접두·관련 종류).
 */
import { TODO_LINK_KINDS, TODO_LINK_KIND_LABELS, TODO_STATUSES, TODO_STATUS_LABELS, type TodoLinkKind, type TodoStatus } from "./types";

export const TODO_RULE_TRIGGERS = ["completed", "status", "due_before", "subtasks_done"] as const;
export type TodoRuleTriggerKind = (typeof TODO_RULE_TRIGGERS)[number];
export const TODO_RULE_TRIGGER_LABELS: Record<TodoRuleTriggerKind, string> = {
  completed: "완료됐을 때",
  status: "상태가 바뀌었을 때",
  due_before: "마감 N일 전",
  subtasks_done: "하위 작업이 모두 완료됐을 때",
};

export const TODO_RULE_ACTIONS = ["set_status", "assign", "notify", "apply_template"] as const;
export type TodoRuleActionKind = (typeof TODO_RULE_ACTIONS)[number];
export const TODO_RULE_ACTION_LABELS: Record<TodoRuleActionKind, string> = {
  set_status: "상태 변경",
  assign: "담당 지정",
  notify: "알림 보내기",
  apply_template: "체크리스트 템플릿 적용",
};

export interface TodoRuleTrigger {
  kind: TodoRuleTriggerKind;
  /** kind=status — 이 상태로 바뀌었을 때 */
  status?: TodoStatus;
  /** kind=due_before — N일 전(0=당일) */
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
  /** "owner" = 작성자, 그 외 userId */
  assignee?: string;
  /** notify — 메신저 방(없으면 인앱만) */
  roomId?: number | null;
  /** notify — 담당자(없으면 작성자)에게 인앱 알림 */
  inApp?: boolean;
  /** notify — 본문 템플릿: {title} {status} {assignee} {board} */
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
export const TODO_RULE_DEFAULT_MESSAGE = "[할 일] {title} — {status} ({assignee})";

const fail = (message: string): Error => Object.assign(new Error(message), { status: 400 });
const isStatus = (v: unknown): v is TodoStatus => typeof v === "string" && (TODO_STATUSES as readonly string[]).includes(v);

export function normalizeTrigger(v: unknown): TodoRuleTrigger {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const kind = String(o.kind ?? "");
  if (!(TODO_RULE_TRIGGERS as readonly string[]).includes(kind)) throw fail("트리거 종류가 올바르지 않습니다.");
  const t: TodoRuleTrigger = { kind: kind as TodoRuleTriggerKind };
  if (t.kind === "status") {
    if (!isStatus(o.status)) throw fail("상태 트리거에는 상태 값이 필요합니다.");
    t.status = o.status;
  }
  if (t.kind === "due_before") {
    const d = Number(o.days ?? 1);
    if (!Number.isInteger(d) || d < 0 || d > 30) throw fail("마감 N일 전의 N은 0~30 사이여야 합니다.");
    t.days = d;
  }
  return t;
}

export function normalizeCondition(v: unknown): TodoRuleCondition {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const c: TodoRuleCondition = {};
  if (o.priorityMin != null && o.priorityMin !== "") {
    const p = Number(o.priorityMin);
    if (![0, 1, 2, 3].includes(p)) throw fail("우선순위 조건이 올바르지 않습니다.");
    if (p > 0) c.priorityMin = p;
  }
  if (typeof o.titlePrefix === "string" && o.titlePrefix.trim()) c.titlePrefix = o.titlePrefix.trim().slice(0, 40);
  if (typeof o.linkKind === "string" && o.linkKind) {
    if (!(TODO_LINK_KINDS as readonly string[]).includes(o.linkKind)) throw fail("관련 종류 조건이 올바르지 않습니다.");
    c.linkKind = o.linkKind as TodoLinkKind;
  }
  return c;
}

export function normalizeAction(v: unknown): TodoRuleAction {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const kind = String(o.kind ?? "");
  if (!(TODO_RULE_ACTIONS as readonly string[]).includes(kind)) throw fail("행동 종류가 올바르지 않습니다.");
  const a: TodoRuleAction = { kind: kind as TodoRuleActionKind };
  switch (a.kind) {
    case "set_status":
      if (!isStatus(o.status)) throw fail("바꿀 상태를 고르세요.");
      a.status = o.status;
      break;
    case "assign": {
      const who = typeof o.assignee === "string" ? o.assignee.trim() : "";
      if (!who) throw fail("담당자를 고르세요.");
      a.assignee = who.slice(0, 80);
      break;
    }
    case "notify": {
      const room = o.roomId == null || o.roomId === "" ? null : Number(o.roomId);
      if (room != null && (!Number.isInteger(room) || room <= 0)) throw fail("메신저 방이 올바르지 않습니다.");
      a.roomId = room;
      a.inApp = o.inApp === undefined ? true : o.inApp === true || o.inApp === 1 || o.inApp === "1" || o.inApp === "true";
      if (!a.roomId && !a.inApp) throw fail("메신저 방 또는 인앱 알림 중 하나는 켜야 합니다.");
      a.message = (typeof o.message === "string" && o.message.trim() ? o.message.trim() : TODO_RULE_DEFAULT_MESSAGE).slice(0, 300);
      break;
    }
    case "apply_template": {
      const id = typeof o.templateId === "string" ? o.templateId.trim() : "";
      if (!id) throw fail("적용할 템플릿을 고르세요.");
      a.templateId = id.slice(0, 40);
      break;
    }
  }
  return a;
}

/** "완료되면 담당자를 홍길동으로 바꿉니다" 같은 한 줄 설명(모달 미리보기·활동 로그). names 는 userId→이름 치환용. */
export function describeRule(
  r: Pick<TodoBoardRule, "trigger" | "condition" | "action">,
  names?: { users?: Record<string, string>; rooms?: Record<string, string>; templates?: Record<string, string> }
): string {
  const t = r.trigger;
  const when =
    t.kind === "completed"
      ? "완료되면"
      : t.kind === "status"
        ? `상태가 '${t.status ? TODO_STATUS_LABELS[t.status] : "?"}'로 바뀌면`
        : t.kind === "due_before"
          ? t.days === 0
            ? "마감 당일에"
            : `마감 ${t.days ?? 1}일 전에`
          : "하위 작업이 모두 완료되면";
  const conds: string[] = [];
  if (r.condition.priorityMin) conds.push(`우선순위 ${r.condition.priorityMin} 이상`);
  if (r.condition.titlePrefix) conds.push(`제목이 '${r.condition.titlePrefix}'로 시작`);
  if (r.condition.linkKind) conds.push(`관련이 ${TODO_LINK_KIND_LABELS[r.condition.linkKind] ?? r.condition.linkKind}`);
  const cond = conds.length ? `(${conds.join(" · ")}인 할 일만) ` : "";
  const a = r.action;
  const act =
    a.kind === "set_status"
      ? `상태를 '${a.status ? TODO_STATUS_LABELS[a.status] : "?"}'로 바꿉니다`
      : a.kind === "assign"
        ? `담당자를 ${a.assignee === "owner" ? "작성자" : (names?.users?.[a.assignee ?? ""] ?? a.assignee ?? "?")}(으)로 지정합니다`
        : a.kind === "notify"
          ? `${a.roomId ? `'${names?.rooms?.[String(a.roomId)] ?? `방 #${a.roomId}`}' 방에 알리고 ` : ""}${a.inApp ? "담당자에게 인앱 알림을 보냅니다" : ""}`.replace(/고 $/, "니다")
          : `'${names?.templates?.[a.templateId ?? ""] ?? "템플릿"}' 체크리스트를 적용합니다`;
  return `${when} ${cond}${act}`.replace(/\s+/g, " ").trim();
}
