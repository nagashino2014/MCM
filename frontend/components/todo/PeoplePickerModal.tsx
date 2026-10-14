"use client";

// 담당·공유 인원 선택 모달 — 기존 AttendeePicker(조직도 트리) 재사용. employee → users.user_id 는 조직 스냅샷의 userId 로 변환한다.

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
  busy,
  onClose,
  onPick,
}: {
  open: boolean;
  title?: string;
  withRole?: boolean;
  defaultRole?: TodoShareRole;
  excludeUserIds?: string[];
  busy?: boolean;
  onClose: () => void;
  onPick: (people: PickedPerson[], role: TodoShareRole) => Promise<void> | void;
}) {
  const [value, setValue] = useState<CalendarPerson[]>([]);
  const [role, setRole] = useState<TodoShareRole>(defaultRole);
  const snapshot = useOrgSnapshot(open);

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
    onClose();
  };

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
            disabled={!picked.out.length}
            onClick={async () => {
              await onPick(picked.out, role);
              setValue([]);
            }}
          >
            추가{picked.out.length ? ` (${picked.out.length})` : ""}
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
        <AttendeePicker value={value} onChange={setValue} height="40vh" />
        {picked.missing.length > 0 && (
          <p className="text-[12px] cd-error-text">계정이 없거나 이미 추가된 사람은 제외됩니다: {picked.missing.join(", ")}</p>
        )}
      </div>
    </CdModal>
  );
}
