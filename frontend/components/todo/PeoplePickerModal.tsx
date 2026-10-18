"use client";

// 담당·공유 인원 선택 모달 — 기존 AttendeePicker(조직도 트리) 재사용. employee → users.user_id 는 조직 스냅샷의 userId 로 변환한다.
// candidates 가 오면(담당 지정, §25-1) 조직도 대신 그 목록에서 1명을 고른다 — 담당은 작성자·공유 대상·보드 멤버로 제한.

import { useMemo, useState } from "react";
import { CdButton, CdModal, CdSelect } from "@/components/cdash";
import { AttendeePicker, useOrgSnapshot } from "@/components/calendar/AttendeePicker";
import type { CalendarPerson } from "@/lib/calendar/types";
import { TODO_SHARE_ROLES, TODO_SHARE_ROLE_LABELS, type TodoShareRole } from "@/lib/todo/types";

export interface PickedPerson {
  userId: string;
  name: string;
}

export function PeoplePickerModal({
  open,
  title = "사람 추가",
  withRole = true,
  defaultRole = "watcher",
  excludeUserIds = [],
  candidates,
  currentUserId,
  busy,
  onClose,
  onPick,
}: {
  open: boolean;
  title?: string;
  withRole?: boolean;
  defaultRole?: TodoShareRole;
  excludeUserIds?: string[];
  /** 고정 후보 모드 — 있으면 조직도 검색 없이 이 목록에서 1명 선택(담당 지정). */
  candidates?: PickedPerson[];
  /** 후보 모드에서 현재 담당(표시용 — 선택 불가) */
  currentUserId?: string | null;
  busy?: boolean;
  onClose: () => void;
  onPick: (people: PickedPerson[], role: TodoShareRole) => Promise<void> | void;
}) {
  const [value, setValue] = useState<CalendarPerson[]>([]);
  const [role, setRole] = useState<TodoShareRole>(defaultRole);
  const [chosen, setChosen] = useState<string | null>(null);
  const snapshot = useOrgSnapshot(open && !candidates);

  const picked = useMemo(() => {
    const out: PickedPerson[] = [];
    const missing: string[] = [];
    for (const p of value) {
      const emp = snapshot?.employees.find((e) => e.employeeId === p.employeeId);
      if (emp?.userId && !excludeUserIds.includes(emp.userId)) out.push({ userId: emp.userId, name: emp.name });
      else missing.push(p.name);
    }
    return { out, missing };
  }, [value, snapshot, excludeUserIds]);

  const close = () => {
    setValue([]);
    setChosen(null);
    onClose();
  };
  const candidateMode = !!candidates;
  const chosenPerson = candidateMode ? candidates.find((p) => p.userId === chosen) ?? null : null;

  return (
    <CdModal
      open={open}
      onClose={close}
      title={title}
      size="md"
      closeOnBackdrop={false}
      footer={
        <>
          <CdButton variant="ghost" onClick={close}>
            취소
          </CdButton>
          <CdButton
            variant="primary"
            loading={busy}
            disabled={candidateMode ? !chosenPerson : !picked.out.length}
            onClick={async () => {
              if (candidateMode) {
                if (chosenPerson) await onPick([chosenPerson], role);
                setChosen(null);
                return;
              }
              await onPick(picked.out, role);
              setValue([]);
            }}
          >
            {candidateMode ? "지정" : `추가${picked.out.length ? ` (${picked.out.length})` : ""}`}
          </CdButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {withRole && (
          <CdSelect label="역할" value={role} onChange={(e) => setRole(e.target.value as TodoShareRole)} hint={role === "assignee" ? "담당은 1명만 — 여러 명을 고르면 첫 사람만 담당이 되고 나머지는 협업으로 추가됩니다." : undefined}>
            {TODO_SHARE_ROLES.map((r) => (
              <option key={r} value={r}>
                {TODO_SHARE_ROLE_LABELS[r]}
              </option>
            ))}
          </CdSelect>
        )}
        {candidateMode ? (
          <div className="flex flex-col gap-1" role="radiogroup" aria-label="담당 후보">
            <p className="text-[12px] cd-text-muted">담당은 작성자·공유받은 사람·보드 멤버 중에서 고릅니다. 다른 사람에게 맡기려면 먼저 공유를 추가하세요.</p>
            {candidates.length === 0 && <p className="text-[13px] cd-text-faint py-3">후보가 없습니다.</p>}
            {candidates.map((p) => {
              const isCurrent = p.userId === currentUserId;
              const on = chosen === p.userId;
              return (
                <button
                  key={p.userId}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={isCurrent}
                  onClick={() => setChosen(p.userId)}
                  className="w-full text-left px-3 py-2 rounded-lg border cd-border-c flex items-center justify-between cd-row-hover disabled:opacity-60"
                  style={on ? { borderColor: "var(--cd-primary)", background: "var(--cd-primary-soft)" } : undefined}
                >
                  <span className="text-sm cd-text">{p.name}</span>
                  <span className="text-[11px] cd-text-muted">{isCurrent ? "현재 담당" : on ? "선택됨" : ""}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <AttendeePicker value={value} onChange={setValue} height="40vh" />
        )}
        {!candidateMode && picked.missing.length > 0 && (
          <p className="text-[12px] cd-error-text">계정이 없거나 이미 추가된 사람은 제외됩니다: {picked.missing.join(", ")}</p>
        )}
      </div>
    </CdModal>
  );
}
