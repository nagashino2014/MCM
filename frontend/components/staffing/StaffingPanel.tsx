"use client";

import { useEffect, useState } from "react";
import { Plus, Save, Trash2, UserCog } from "lucide-react";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";

const DEFAULT_ROLE_OPTIONS = ["관리자", "실무(정)", "실무(부)", "실무(품질검토)"];

interface ParticipantDraft {
  key: string;
  employeeId: string | null;
  employeeName: string;
  positionName: string | null;
  roleLabel: string;
}

let seq = 0;
const nextKey = () => `pt-${seq++}`;

export default function StaffingPanel({
  contractId,
  participantsUrl,
  roleOptions = DEFAULT_ROLE_OPTIONS,
  departments = [],
  deptId = "",
  onChangeDept,
}: {
  contractId: string;
  /** 참여인력 API 베이스. 미지정 시 계약 기준. (Task 는 /api/work-tasks/${id}/participants) */
  participantsUrl?: string;
  roleOptions?: string[];
  departments?: { deptId: string; deptName: string }[];
  deptId?: string;
  onChangeDept?: (value: string) => void;
}) {
  const ROLE_OPTIONS = roleOptions;
  const defaultRole = roleOptions[1] ?? roleOptions[0] ?? "실무";
  const apiUrl = participantsUrl ?? `/api/contracts/${contractId}/participants`;
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [rows, setRows] = useState<ParticipantDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/organization", { cache: "no-store" })
      .then((r) => r.json())
      .then(setSnapshot)
      .catch(() => setSnapshot(null));
  }, []);

  useEffect(() => {
    if (!contractId) return;
    fetch(apiUrl, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) =>
        setRows(
          (d.participants ?? []).map((p: { employeeId: string; employeeName: string; positionName: string | null; roleLabel: string }) => ({
            key: nextKey(),
            employeeId: p.employeeId,
            employeeName: p.employeeName,
            positionName: p.positionName,
            roleLabel: p.roleLabel,
          }))
        )
      )
      .catch(() => setRows([]));
  }, [contractId]);

  // 조직도에서 인원 선택 → 첫 빈 슬롯을 채우거나, 없으면 새 인력 행 추가.
  // 같은 인물을 다른 역할(관리자·실무 등)로 중복 배치할 수 있도록 중복 방지는 하지 않는다.
  const onPick = (e: OrganizationEmployeeRow) => {
    setRows((prev) => {
      const emptyIdx = prev.findIndex((r) => !r.employeeId);
      if (emptyIdx >= 0) {
        const next = [...prev];
        next[emptyIdx] = { ...next[emptyIdx], employeeId: e.employeeId, employeeName: e.name, positionName: e.positionName };
        return next;
      }
      return [...prev, { key: nextKey(), employeeId: e.employeeId, employeeName: e.name, positionName: e.positionName, roleLabel: defaultRole }];
    });
  };
  // + 버튼 → 빈 인력 슬롯 추가 (조직도에서 선택하면 채워짐).
  const addEmpty = () => setRows((prev) => [...prev, { key: nextKey(), employeeId: null, employeeName: "", positionName: null, roleLabel: defaultRole }]);
  const updateRow = (key: string, patch: Partial<ParticipantDraft>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  const filledCount = rows.filter((r) => r.employeeId).length;

  const save = async () => {
    setSaving(true);
    setSavedMsg(null);
    try {
      const res = await fetch(apiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participants: rows.filter((r) => r.employeeId).map((r) => ({ employeeId: r.employeeId, roleLabel: r.roleLabel })),
        }),
      });
      if (!res.ok) throw new Error("수행 인력 저장에 실패했습니다.");
      setSavedMsg("저장되었습니다.");
    } catch (err) {
      setSavedMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-bold cd-text flex items-center gap-2">
          <UserCog className="w-4 h-4 cd-text-primary" /> 수행부서/인력
          <span className="text-[11px] font-normal cd-text-faint">{filledCount}명</span>
        </h3>
        <div className="flex items-center gap-2">
          {savedMsg && <span className="text-[11px] cd-text-faint">{savedMsg}</span>}
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="rounded-lg px-3 py-1.5 text-xs text-white cd-fill-primary inline-flex items-center gap-1 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" /> {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[5fr_7fr] gap-4 items-start">
        <div className="rounded-2xl border cd-border-c">
          <OrganizationTree snapshot={snapshot} onSelectEmployee={onPick} title="조직도" embedded />
        </div>

        <div className="flex flex-col gap-3 min-w-0">
          {onChangeDept && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold cd-text-faint">수행 부서</span>
              <select className="cd-select text-sm w-full" value={deptId} onChange={(e) => onChangeDept(e.target.value)}>
                <option value="">미지정</option>
                {departments.map((d) => (
                  <option key={d.deptId} value={d.deptId}>{d.deptName}</option>
                ))}
              </select>
            </label>
          )}

          {rows.length === 0 ? (
            <p className="rounded-xl border cd-border-c p-6 text-center text-sm cd-text-faint">
              좌측 조직도에서 인원을 선택하면 수행 인력으로 추가됩니다.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {rows.map((r) => (
                <div key={r.key} className="rounded-xl border cd-border-c p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate text-sm">
                      {r.employeeId ? (
                        <>
                          <span className="cd-text font-medium">{r.employeeName}</span>
                          {r.positionName ? <span className="cd-text-faint text-xs"> {r.positionName}</span> : null}
                        </>
                      ) : (
                        <span className="cd-text-faint">조직도에서 인원을 선택하세요</span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRow(r.key)}
                      className="shrink-0 p-1.5 rounded-lg cd-text-faint hover:cd-error-text"
                      title="인력 삭제"
                      aria-label="인력 삭제"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <select
                    className="cd-select text-xs w-full mt-2"
                    value={r.roleLabel}
                    onChange={(e) => updateRow(r.key, { roleLabel: e.target.value })}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={addEmpty}
            className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs cd-text-muted inline-flex items-center justify-center gap-1 border cd-border-c"
          >
            <Plus className="w-3.5 h-3.5" /> 인력 추가
          </button>
        </div>
      </div>
    </div>
  );
}
