"use client";

import { useEffect, useState } from "react";
import { GitCommitHorizontal, History, UserCog, X } from "lucide-react";
import { cn } from "@/lib/utils";
import ProcessStageTabs from "@/components/contracts/ProcessStageTabs";
import StaffingPanel from "@/components/staffing/StaffingPanel";
import ChangeHistoryPanel from "@/components/staffing/ChangeHistoryPanel";

export default function ContractStaffingModal({
  contractId,
  serviceType,
  currentDeptId,
  onClose,
  onSaved,
}: {
  contractId: string;
  serviceType: string;
  currentDeptId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [tab, setTab] = useState<"process" | "staffing" | "changes">("process");
  const [departments, setDepartments] = useState<{ deptId: string; deptName: string }[]>([]);
  const [deptId, setDeptId] = useState(currentDeptId ?? "");

  useEffect(() => {
    fetch("/api/departments", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => setDepartments([]));
  }, []);

  const changeDept = async (value: string) => {
    // 부서 변경은 즉시 저장하되, 상세 재조회(onSaved)는 호출하지 않는다.
    // 모달을 띄운 채 재조회하면 상세 패널이 잠깐 언마운트되며 모달이 닫히므로,
    // 갱신은 모달을 닫는 시점(onClose)에 한 번만 수행한다.
    setDeptId(value);
    await fetch(`/api/contracts/${contractId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owningDeptId: value || null }),
    }).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative cd-card-bg border cd-border-c rounded-3xl w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b cd-border-c">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTab("process")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold",
                tab === "process" ? "cd-soft-primary" : "cd-text-muted cd-row-hover"
              )}
            >
              <GitCommitHorizontal className="w-4 h-4" /> 용역 공정표
            </button>
            <button
              type="button"
              onClick={() => setTab("staffing")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold",
                tab === "staffing" ? "cd-soft-primary" : "cd-text-muted cd-row-hover"
              )}
            >
              <UserCog className="w-4 h-4" /> 수행부서/인력
            </button>
            <button
              type="button"
              onClick={() => setTab("changes")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold",
                tab === "changes" ? "cd-soft-primary" : "cd-text-muted cd-row-hover"
              )}
            >
              <History className="w-4 h-4" /> 인력 변동
            </button>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg cd-text-faint hover:cd-text" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {tab === "process" ? (
            <ProcessStageTabs contractId={contractId} serviceType={serviceType} />
          ) : tab === "staffing" ? (
            <StaffingPanel
              contractId={contractId}
              departments={departments}
              deptId={deptId}
              onChangeDept={changeDept}
            />
          ) : (
            <ChangeHistoryPanel contractId={contractId} />
          )}
        </div>
      </div>
    </div>
  );
}
