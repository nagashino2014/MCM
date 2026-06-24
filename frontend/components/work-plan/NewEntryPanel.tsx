"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileSignature, FolderPlus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MyServiceRow } from "@/lib/work-plan/workspace";
import type { TaskCategoryRow } from "@/lib/work-plan/tasks";
import type { LeftTab } from "@/components/work-plan/ServiceListPanel";

export default function NewEntryPanel({
  tab,
  onTabChange,
  services,
  categories,
  selectedContractId,
  onPickContract,
  selectedCategoryId,
  onPickCategory,
  onAddCategory,
}: {
  tab: LeftTab;
  onTabChange: (t: LeftTab) => void;
  services: MyServiceRow[];
  categories: TaskCategoryRow[];
  selectedContractId: string | null;
  onPickContract: (s: MyServiceRow) => void;
  selectedCategoryId: string | null;
  onPickCategory: (c: TaskCategoryRow) => void;
  onAddCategory: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // 내 용역을 용역분류(serviceType)로 그룹 — 부모 노드 보존.
  const groups = useMemo(() => {
    const map = new Map<string, MyServiceRow[]>();
    for (const s of services) {
      const key = s.serviceType || "기타";
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return Array.from(map.entries()).map(([serviceType, contracts]) => ({ serviceType, contracts }));
  }, [services]);

  return (
    <section className="cd-card rounded-3xl p-3 cd-reveal delay-1 flex flex-col min-h-0">
      <div className="flex items-end gap-1 px-1 mb-3">
        {(["service", "task"] as LeftTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTabChange(t)}
            className={cn(
              "rounded-t-xl px-4 py-2 text-sm font-semibold border-b-2",
              tab === t ? "cd-text-primary border-current cd-tint-primary" : "cd-text-faint border-transparent cd-row-hover"
            )}
          >
            {t === "service" ? "용역" : "Task"}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-1 pb-1">
        {tab === "service" ? (
          <>
            <p className="text-[11px] font-semibold cd-text-faint px-1 mb-2">용역 선택 (내 수행 용역)</p>
            {groups.length === 0 ? (
              <div className="p-8 text-center text-xs cd-text-faint">
                수행 중인 용역이 없습니다.<br />(로그인 계정이 직원과 연결돼 있어야 표시됩니다.)
              </div>
            ) : (
              groups.map((g) => {
                const open = expanded[g.serviceType] !== false;
                return (
                  <div key={g.serviceType} className="mb-1">
                    <button
                      type="button"
                      onClick={() => setExpanded((p) => ({ ...p, [g.serviceType]: !open }))}
                      className="w-full flex items-center gap-2 px-2 py-2 rounded-xl cd-row-hover text-left"
                    >
                      {open ? <ChevronDown className="w-4 h-4 cd-text-faint" /> : <ChevronRight className="w-4 h-4 cd-text-faint" />}
                      <span className="text-sm font-semibold cd-text">{g.serviceType}</span>
                      <span className="text-[11px] cd-text-faint ml-auto">{g.contracts.length}</span>
                    </button>
                    {open &&
                      g.contracts.map((c) => {
                        const active = c.contractId === selectedContractId;
                        return (
                          <button
                            key={c.contractId}
                            type="button"
                            onClick={() => onPickContract(c)}
                            className={cn(
                              "w-full flex items-center gap-2 pl-8 pr-2 py-2 rounded-xl text-left text-xs border-l-2",
                              active ? "cd-tint-primary border-current cd-text-primary" : "border-transparent cd-row-hover"
                            )}
                          >
                            <FileSignature className="w-3.5 h-3.5 cd-text-primary shrink-0" />
                            <span className="truncate cd-text flex-1">{c.contractTitle}</span>
                            <span className="shrink-0 text-[10px] cd-text-faint truncate max-w-[35%]">{c.counterpartyName}</span>
                          </button>
                        );
                      })}
                  </div>
                );
              })
            )}
          </>
        ) : (
          <>
            <p className="text-[11px] font-semibold cd-text-faint px-1 mb-2">업무분류 / 표준공정 선택</p>
            <div className="grid grid-cols-3 gap-2.5">
              {categories.map((c) => {
                const active = c.categoryId === selectedCategoryId;
                return (
                  <button
                    key={c.categoryId}
                    type="button"
                    onClick={() => onPickCategory(c)}
                    className={cn(
                      "rounded-2xl border aspect-square flex flex-col items-center justify-center gap-1 p-3 text-center",
                      active ? "cd-tint-primary border-current cd-text-primary" : "cd-border-c cd-row-hover"
                    )}
                  >
                    <span className="text-[10px] cd-text-faint">업무분류</span>
                    <span className="text-sm font-semibold cd-text">{c.categoryName}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={onAddCategory}
                className="rounded-2xl border cd-border-c aspect-square flex flex-col items-center justify-center gap-1.5 cd-row-hover cd-text-muted"
              >
                <FolderPlus className="w-5 h-5" />
                <span className="text-xs">업무분류 추가</span>
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
