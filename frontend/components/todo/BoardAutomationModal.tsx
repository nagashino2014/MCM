"use client";

/**
 * 보드 자동화 모달(296, §29-2) — 규칙 목록(켜기/끄기·실행 수·삭제) + 빌더 한 줄 "[트리거] [조건] 이면 [행동] [대상]" + 미리보기 문장.
 * 보드 admin 만 편집. 시각 규칙은 todo.css 의 todo-au-* 에만 둔다.
 */

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Zap } from "lucide-react";
import { CdButton, CdModal } from "@/components/cdash";
import { TODO_LINK_KINDS, TODO_LINK_KIND_LABELS, TODO_STATUSES, TODO_STATUS_LABELS, type TodoBoard, type TodoBoardMember, type TodoLinkKind, type TodoStatus } from "@/lib/todo/types";
import {
  TODO_RULE_ACTIONS,
  TODO_RULE_ACTION_LABELS,
  TODO_RULE_DEFAULT_MESSAGE,
  TODO_RULE_MAX_PER_BOARD,
  TODO_RULE_TRIGGERS,
  TODO_RULE_TRIGGER_LABELS,
  describeRule,
  type TodoBoardRule,
  type TodoRuleActionKind,
  type TodoRuleTriggerKind,
} from "@/lib/todo/rules-shared";
import { apiCall } from "./useTodoData";

interface Draft {
  name: string;
  triggerKind: TodoRuleTriggerKind;
  triggerStatus: TodoStatus;
  days: string;
  priorityMin: string;
  titlePrefix: string;
  linkKind: "" | TodoLinkKind;
  actionKind: TodoRuleActionKind;
  status: TodoStatus;
  assignee: string;
  roomId: string;
  inApp: boolean;
  message: string;
  templateId: string;
}

const EMPTY: Draft = { name: "", triggerKind: "completed", triggerStatus: "doing", days: "1", priorityMin: "", titlePrefix: "", linkKind: "", actionKind: "notify", status: "doing", assignee: "owner", roomId: "", inApp: true, message: TODO_RULE_DEFAULT_MESSAGE, templateId: "" };

function toPayload(d: Draft) {
  return {
    name: d.name.trim(),
    trigger: { kind: d.triggerKind, status: d.triggerKind === "status" ? d.triggerStatus : undefined, days: d.triggerKind === "due_before" ? Number(d.days || 0) : undefined },
    condition: { priorityMin: d.priorityMin ? Number(d.priorityMin) : undefined, titlePrefix: d.titlePrefix || undefined, linkKind: d.linkKind || undefined },
    action:
      d.actionKind === "set_status"
        ? { kind: "set_status", status: d.status }
        : d.actionKind === "assign"
          ? { kind: "assign", assignee: d.assignee }
          : d.actionKind === "notify"
            ? { kind: "notify", roomId: d.roomId ? Number(d.roomId) : null, inApp: d.inApp, message: d.message }
            : { kind: "apply_template", templateId: d.templateId },
  };
}

export function BoardAutomationModal({ board, onClose }: { board: TodoBoard; onClose: () => void }) {
  const canEdit = board.myRole === "admin";
  const [rules, setRules] = useState<TodoBoardRule[] | null>(null);
  const [members, setMembers] = useState<TodoBoardMember[]>([]);
  const [rooms, setRooms] = useState<{ roomId: number; name: string }[]>([]);
  const [templates, setTemplates] = useState<{ templateId: string; name: string }[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  useEffect(() => {
    let alive = true;
    const bid = encodeURIComponent(board.boardId);
    apiCall<{ rules: TodoBoardRule[] }>(`/api/todo/boards/${bid}/rules`)
      .then((d) => alive && setRules(d.rules ?? []))
      .catch((e) => alive && setError((e as Error).message));
    if (board.kind !== "personal") apiCall<{ members: TodoBoardMember[] }>(`/api/todo/boards/${bid}/members`).then((d) => alive && setMembers(d.members ?? [])).catch(() => {});
    apiCall<{ rooms: { roomId: number; name: string }[] }>("/api/chat/rooms").then((d) => alive && setRooms(d.rooms ?? [])).catch(() => {});
    apiCall<{ templates: { templateId: string; name: string }[] }>(`/api/todo/templates${board.kind !== "personal" ? `?boardId=${bid}` : ""}`).then((d) => alive && setTemplates(d.templates ?? [])).catch(() => {});
    return () => {
      alive = false;
    };
  }, [board.boardId, board.kind]);

  const names = useMemo(
    () => ({
      users: Object.fromEntries(members.map((m) => [m.userId, m.name])),
      rooms: Object.fromEntries(rooms.map((r) => [String(r.roomId), r.name])),
      templates: Object.fromEntries(templates.map((t) => [t.templateId, t.name])),
    }),
    [members, rooms, templates]
  );
  const preview = useMemo(() => {
    try {
      const p = toPayload(draft);
      return describeRule({ trigger: p.trigger as TodoBoardRule["trigger"], condition: p.condition as TodoBoardRule["condition"], action: p.action as TodoBoardRule["action"] }, names);
    } catch {
      return "";
    }
  }, [draft, names]);

  const save = async () => {
    if (!canEdit) return;
    setBusy(true);
    setError(null);
    try {
      const bid = encodeURIComponent(board.boardId);
      const payload = toPayload(draft);
      if (editing) {
        const d = await apiCall<{ rule: TodoBoardRule }>(`/api/todo/boards/${bid}/rules/${encodeURIComponent(editing)}`, { method: "PATCH", body: JSON.stringify(payload) });
        setRules((rs) => (rs ?? []).map((r) => (r.ruleId === editing ? d.rule : r)));
      } else {
        const d = await apiCall<{ rule: TodoBoardRule }>(`/api/todo/boards/${bid}/rules`, { method: "POST", body: JSON.stringify(payload) });
        setRules((rs) => [...(rs ?? []), d.rule]);
      }
      setDraft(EMPTY);
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (r: TodoBoardRule) => {
    if (!canEdit) return;
    try {
      const d = await apiCall<{ rule: TodoBoardRule }>(`/api/todo/boards/${encodeURIComponent(board.boardId)}/rules/${encodeURIComponent(r.ruleId)}`, { method: "PATCH", body: JSON.stringify({ enabled: !r.enabled }) });
      setRules((rs) => (rs ?? []).map((x) => (x.ruleId === r.ruleId ? d.rule : x)));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (r: TodoBoardRule) => {
    if (!canEdit || !window.confirm(`'${r.name}' 규칙을 삭제할까요?`)) return;
    try {
      await apiCall(`/api/todo/boards/${encodeURIComponent(board.boardId)}/rules/${encodeURIComponent(r.ruleId)}`, { method: "DELETE" });
      setRules((rs) => (rs ?? []).filter((x) => x.ruleId !== r.ruleId));
      if (editing === r.ruleId) {
        setEditing(null);
        setDraft(EMPTY);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const edit = (r: TodoBoardRule) => {
    setEditing(r.ruleId);
    setDraft({
      name: r.name,
      triggerKind: r.trigger.kind,
      triggerStatus: r.trigger.status ?? "doing",
      days: String(r.trigger.days ?? 1),
      priorityMin: r.condition.priorityMin ? String(r.condition.priorityMin) : "",
      titlePrefix: r.condition.titlePrefix ?? "",
      linkKind: r.condition.linkKind ?? "",
      actionKind: r.action.kind,
      status: r.action.status ?? "doing",
      assignee: r.action.assignee ?? "owner",
      roomId: r.action.roomId ? String(r.action.roomId) : "",
      inApp: r.action.inApp !== false,
      message: r.action.message ?? TODO_RULE_DEFAULT_MESSAGE,
      templateId: r.action.templateId ?? "",
    });
  };

  const full = (rules?.length ?? 0) >= TODO_RULE_MAX_PER_BOARD && !editing;

  return (
    <CdModal
      open
      onClose={() => (busy ? undefined : onClose())}
      title={`자동화 — ${board.name}`}
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <CdButton variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            닫기
          </CdButton>
          {canEdit && (
            <>
              {editing && (
                <CdButton
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setDraft(EMPTY);
                  }}
                  disabled={busy}
                >
                  새 규칙으로
                </CdButton>
              )}
              <CdButton variant="primary" size="sm" onClick={() => void save()} loading={busy} disabled={!draft.name.trim() || full}>
                {editing ? "규칙 저장" : "규칙 추가"}
              </CdButton>
            </>
          )}
        </div>
      }
    >
      <div className="todo-vars todo-au">
        <p className="text-[12px] cd-text-muted">
          할 일이 바뀔 때 보드가 대신 처리합니다. 규칙이 일으킨 변경은 다른 규칙을 다시 타지 않고, 같은 사건에 두 번 실행되지 않습니다.{!canEdit && " (보드 관리자만 편집할 수 있습니다)"}
        </p>

        <ul className="todo-au-list" aria-label="규칙 목록">
          {rules === null ? (
            <li className="cd-text-faint text-[12px]">불러오는 중…</li>
          ) : rules.length === 0 ? (
            <li className="cd-text-faint text-[12px]">아직 규칙이 없습니다. 아래에서 첫 규칙을 만드세요.</li>
          ) : (
            rules.map((r) => (
              <li key={r.ruleId} className="todo-au-row" data-off={r.enabled ? undefined : "1"} data-editing={editing === r.ruleId ? "1" : undefined}>
                <Zap className="todo-au-ic" aria-hidden="true" />
                <button type="button" className="todo-au-name" onClick={() => (canEdit ? edit(r) : undefined)} title={canEdit ? "편집" : undefined}>
                  <b>{r.name}</b>
                  <span>{describeRule(r, names)}</span>
                </button>
                <span className="todo-au-meta" title={r.lastRunAt ? `마지막 실행 ${r.lastRunAt.slice(0, 16).replace("T", " ")}` : "아직 실행되지 않음"}>
                  {r.runCount}회
                </span>
                {canEdit && (
                  <>
                    <label className="todo-au-sw" title={r.enabled ? "끄기" : "켜기"}>
                      <input type="checkbox" checked={r.enabled} onChange={() => void toggle(r)} />
                      <span>{r.enabled ? "켬" : "끔"}</span>
                    </label>
                    <button type="button" className="todo-au-x" title="삭제" aria-label={`${r.name} 삭제`} onClick={() => void remove(r)}>
                      <Trash2 aria-hidden="true" />
                    </button>
                  </>
                )}
              </li>
            ))
          )}
        </ul>

        {canEdit && (
          <div className="todo-au-builder" aria-label={editing ? "규칙 편집" : "새 규칙"}>
            <div className="todo-au-grid">
              <label>
                <span className="cd-label">규칙 이름</span>
                <input className="cd-input" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="예: 완료되면 검토 요청" maxLength={80} />
              </label>
              <label>
                <span className="cd-label">트리거</span>
                <select className="cd-select" value={draft.triggerKind} onChange={(e) => set({ triggerKind: e.target.value as TodoRuleTriggerKind })}>
                  {TODO_RULE_TRIGGERS.map((k) => (
                    <option key={k} value={k}>
                      {TODO_RULE_TRIGGER_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              {draft.triggerKind === "status" && (
                <label>
                  <span className="cd-label">이 상태로</span>
                  <select className="cd-select" value={draft.triggerStatus} onChange={(e) => set({ triggerStatus: e.target.value as TodoStatus })}>
                    {TODO_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {TODO_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {draft.triggerKind === "due_before" && (
                <label>
                  <span className="cd-label">며칠 전(0=당일)</span>
                  <input className="cd-input" type="number" min={0} max={30} value={draft.days} onChange={(e) => set({ days: e.target.value })} />
                </label>
              )}
            </div>
            <div className="todo-au-grid">
              <label>
                <span className="cd-label">조건 · 우선순위 이상</span>
                <select className="cd-select" value={draft.priorityMin} onChange={(e) => set({ priorityMin: e.target.value })}>
                  <option value="">제한 없음</option>
                  <option value="1">1 이상</option>
                  <option value="2">2 이상</option>
                  <option value="3">3(긴급)</option>
                </select>
              </label>
              <label>
                <span className="cd-label">조건 · 제목 접두</span>
                <input className="cd-input" value={draft.titlePrefix} onChange={(e) => set({ titlePrefix: e.target.value })} placeholder="예: [긴급]" maxLength={40} />
              </label>
              <label>
                <span className="cd-label">조건 · 관련 종류</span>
                <select className="cd-select" value={draft.linkKind} onChange={(e) => set({ linkKind: e.target.value as Draft["linkKind"] })}>
                  <option value="">제한 없음</option>
                  {TODO_LINK_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {TODO_LINK_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="todo-au-grid">
              <label>
                <span className="cd-label">행동</span>
                <select className="cd-select" value={draft.actionKind} onChange={(e) => set({ actionKind: e.target.value as TodoRuleActionKind })}>
                  {TODO_RULE_ACTIONS.map((k) => (
                    <option key={k} value={k}>
                      {TODO_RULE_ACTION_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              {draft.actionKind === "set_status" && (
                <label>
                  <span className="cd-label">바꿀 상태</span>
                  <select className="cd-select" value={draft.status} onChange={(e) => set({ status: e.target.value as TodoStatus })}>
                    {TODO_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {TODO_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {draft.actionKind === "assign" && (
                <label>
                  <span className="cd-label">담당자</span>
                  <select className="cd-select" value={draft.assignee} onChange={(e) => set({ assignee: e.target.value })}>
                    <option value="owner">작성자</option>
                    {members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {draft.actionKind === "apply_template" && (
                <label>
                  <span className="cd-label">템플릿</span>
                  <select className="cd-select" value={draft.templateId} onChange={(e) => set({ templateId: e.target.value })}>
                    <option value="">선택</option>
                    {templates.map((t) => (
                      <option key={t.templateId} value={t.templateId}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {draft.actionKind === "notify" && (
                <>
                  <label>
                    <span className="cd-label">메신저 방</span>
                    <select className="cd-select" value={draft.roomId} onChange={(e) => set({ roomId: e.target.value })}>
                      <option value="">보내지 않음</option>
                      {rooms.map((r) => (
                        <option key={r.roomId} value={String(r.roomId)}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="todo-au-chk">
                    <input type="checkbox" checked={draft.inApp} onChange={(e) => set({ inApp: e.target.checked })} /> 담당자 인앱 알림
                  </label>
                </>
              )}
            </div>
            {draft.actionKind === "notify" && (
              <label>
                <span className="cd-label">메시지 — {"{title} {status} {assignee} {board}"} 치환</span>
                <input className="cd-input" value={draft.message} onChange={(e) => set({ message: e.target.value })} maxLength={300} />
              </label>
            )}
            <p className="todo-au-preview" aria-live="polite">
              {preview ? `→ ${preview}` : ""}
              {full && <span className="cd-text-faint"> · 보드당 {TODO_RULE_MAX_PER_BOARD}개까지</span>}
            </p>
          </div>
        )}
        {error && (
          <p className="text-[12px]" style={{ color: "var(--cd-error)" }} role="alert">
            {error}
          </p>
        )}
      </div>
    </CdModal>
  );
}
