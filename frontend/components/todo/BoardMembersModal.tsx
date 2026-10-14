"use client";

// 보드 멤버 관리 모달(§19-8) — GET/POST/DELETE /api/todo/boards/[id]/members. 목록(사진 아바타·이름·역할 select·제거) + 추가(PeoplePickerModal 재사용).
// 역할 변경은 POST(upsert) 로, 제거는 DELETE ?userId= 로. 소유자는 항상 관리자라 목록에서 역할을 바꿀 수 없다.

import { useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { CdAvatar, CdButton, CdModal, useCdToast } from "@/components/cdash";
import { TODO_MEMBER_ROLES, TODO_MEMBER_ROLE_LABELS, type TodoBoard, type TodoBoardMember, type TodoMemberRole } from "@/lib/todo/types";
import { PeoplePickerModal } from "./PeoplePickerModal";
import { apiCall } from "./useTodoData";

export interface BoardMembersModalProps {
  open: boolean;
  board: TodoBoard | null;
  myUserId: string | null;
  onClose: () => void;
  /** 멤버 수가 바뀌면 보드 목록의 memberCount 를 맞추기 위해 부모에 알린다. */
  onChanged?: (members: TodoBoardMember[]) => void;
}

export function BoardMembersModal({ open, board, myUserId, onClose, onChanged }: BoardMembersModalProps) {
  const { toast } = useCdToast();
  const [members, setMembers] = useState<TodoBoardMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addRole, setAddRole] = useState<TodoMemberRole>("member");
  const boardId = board?.boardId ?? null;
  const canManage = board?.myRole === "admin";

  useEffect(() => {
    if (!open || !boardId) return;
    let cancelled = false;
    setMembers(null);
    setError(null);
    apiCall<{ members: TodoBoardMember[] }>(`/api/todo/boards/${encodeURIComponent(boardId)}/members`)
      .then((d) => {
        if (!cancelled) setMembers(d.members ?? []);
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setMembers([]);
          setError(e.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  const apply = (next: TodoBoardMember[]) => {
    setMembers(next);
    onChanged?.(next);
  };

  const setRole = async (m: TodoBoardMember, role: TodoMemberRole) => {
    if (!boardId || role === m.role) return;
    setBusy(true);
    try {
      const d = await apiCall<{ members: TodoBoardMember[] }>(`/api/todo/boards/${encodeURIComponent(boardId)}/members`, { method: "POST", body: JSON.stringify({ userId: m.userId, role }) });
      apply(d.members);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: TodoBoardMember) => {
    if (!boardId) return;
    setBusy(true);
    try {
      const d = await apiCall<{ members: TodoBoardMember[] }>(`/api/todo/boards/${encodeURIComponent(boardId)}/members?userId=${encodeURIComponent(m.userId)}`, { method: "DELETE" });
      if (m.userId === myUserId) {
        // 본인 탈퇴 — 더는 멤버 목록을 볼 수 없다
        onChanged?.([]);
        onClose();
        toast("보드에서 나왔습니다", "success");
        return;
      }
      apply(d.members);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const add = async (people: { userId: string; name: string }[]) => {
    if (!boardId) return;
    setBusy(true);
    try {
      let last: TodoBoardMember[] | null = null;
      for (const p of people) {
        const d = await apiCall<{ members: TodoBoardMember[] }>(`/api/todo/boards/${encodeURIComponent(boardId)}/members`, { method: "POST", body: JSON.stringify({ userId: p.userId, role: addRole }) });
        last = d.members;
      }
      if (last) apply(last);
      setPickerOpen(false);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const title = board ? `멤버 관리 · ${board.projectName ?? board.name}` : "멤버 관리";

  return (
    <>
      <CdModal
        open={open}
        onClose={onClose}
        title={title}
        size="md"
        footer={
          <>
            {canManage && (
              <>
                <label className="todo-field-lb inline-flex items-center gap-2 mr-auto">
                  추가 역할
                  <select className="cd-select todo-w-sel" aria-label="추가할 멤버 역할" value={addRole} onChange={(e) => setAddRole(e.target.value as TodoMemberRole)}>
                    {TODO_MEMBER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {TODO_MEMBER_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </label>
                <CdButton variant="soft" icon={<UserPlus className="w-4 h-4" aria-hidden="true" />} disabled={busy} onClick={() => setPickerOpen(true)}>
                  사람 추가
                </CdButton>
              </>
            )}
            <CdButton variant="ghost" onClick={onClose}>
              닫기
            </CdButton>
          </>
        }
      >
        <div className="todo-vars todo-modal">
          {board && (
            <p className="todo-field-hint">
              관리자는 열·멤버를 바꿀 수 있고, 멤버는 할 일을 만들고 옮길 수 있으며, 열람은 보기만 합니다.
              {board.kind === "project" && board.contractId ? " 계약관리 수행인력은 보드를 만들 때 멤버로 자동 추가됩니다." : ""}
            </p>
          )}
          {error && <p className="todo-field-err">{error}</p>}
          {members == null ? (
            <div className="todo-loading">불러오는 중…</div>
          ) : members.length === 0 ? (
            <p className="todo-field-hint">아직 멤버가 없습니다.</p>
          ) : (
            <div className="todo-mem" aria-label="멤버 목록">
              {members.map((m) => {
                const isOwner = m.userId === board?.ownerUserId;
                return (
                  <div key={m.userId} className="todo-mem-row">
                    <CdAvatar name={m.name || "?"} src={m.photoUrl} size="sm" />
                    <span className="todo-mem-n">
                      {m.name || m.userId}
                      {isOwner && <small>소유자</small>}
                      {m.userId === myUserId && !isOwner && <small>나</small>}
                    </span>
                    {canManage && !isOwner ? (
                      <select className="cd-select" aria-label={`${m.name} 역할`} value={m.role} disabled={busy} onChange={(e) => void setRole(m, e.target.value as TodoMemberRole)}>
                        {TODO_MEMBER_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {TODO_MEMBER_ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="todo-chip-role text-[12px]">{TODO_MEMBER_ROLE_LABELS[m.role]}</span>
                    )}
                    {!isOwner && (canManage || m.userId === myUserId) && (
                      <button type="button" className="cd-icon-button cd-icon-button-sm inline-flex items-center justify-center" aria-label={m.userId === myUserId ? "보드 나가기" : `${m.name} 제거`} disabled={busy} onClick={() => void remove(m)}>
                        <X className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CdModal>

      <PeoplePickerModal open={pickerOpen} title="멤버 추가" withRole={false} excludeUserIds={(members ?? []).map((m) => m.userId)} busy={busy} onClose={() => setPickerOpen(false)} onPick={(people) => add(people)} />
    </>
  );
}
