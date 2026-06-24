"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileSignature, Search, X } from "lucide-react";

interface ContractNode {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  serviceSubtype: string | null;
  contractStatus: string;
  contractDate: string | null;
}
interface ServiceGroup {
  serviceType: string;
  contracts: ContractNode[];
}
interface TreePayload {
  groups: ServiceGroup[];
  totalCount: number;
}

interface ContractPickerModalProps {
  deptId: string;
  deptName?: string;
  open: boolean;
  onClose: () => void;
  onSelect: (node: { contractId: string; contractTitle: string }) => void;
}

export default function ContractPickerModal({
  deptId,
  deptName,
  open,
  onClose,
  onSelect,
}: ContractPickerModalProps) {
  const [payload, setPayload] = useState<TreePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open || !deptId) return;
    setLoading(true);
    fetch(`/api/contracts/tree?dept=${encodeURIComponent(deptId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: TreePayload) => {
        setPayload(d);
        const exp: Record<string, boolean> = {};
        (d.groups ?? []).forEach((g) => (exp[g.serviceType] = true));
        setExpanded(exp);
      })
      .finally(() => setLoading(false));
  }, [open, deptId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (payload?.groups ?? [])
      .map((g) => ({
        ...g,
        contracts: g.contracts.filter(
          (c) =>
            !q ||
            c.contractTitle.toLowerCase().includes(q) ||
            c.counterpartyName.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.contracts.length > 0);
  }, [payload, search]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative cd-card rounded-3xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <div className="p-4 border-b cd-border-c flex items-center justify-between">
          <div>
            <h2 className="font-bold cd-text flex items-center gap-2">
              <FileSignature className="w-4 h-4 cd-text-primary" /> 용역(계약) 선택
            </h2>
            <p className="text-[11px] cd-text-faint">
              {deptName ? `${deptName} 수행 계약` : "수행 부서로 지정된 계약"} 중에서 선택하세요.
            </p>
          </div>
          <button type="button" className="p-1.5 rounded-lg cd-text-faint hover:cd-text" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 border-b cd-border-c flex items-center gap-2">
          <Search className="w-4 h-4 cd-text-faint shrink-0" />
          <input
            className="cd-input text-sm flex-1"
            placeholder="계약명 / 거래처 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          {!deptId ? (
            <div className="p-8 text-center text-sm cd-text-faint">먼저 수행 부서를 선택하세요.</div>
          ) : loading ? (
            <div className="p-8 text-center text-sm cd-text-faint">계약 목록을 불러오는 중…</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm cd-text-faint">
              이 부서로 수행 부서가 지정된 계약이 없습니다.
              <br />
              (계약 관리에서 해당 계약의 수행 부서를 먼저 지정하세요.)
            </div>
          ) : (
            filtered.map((group) => {
              const isOpen = expanded[group.serviceType] !== false;
              return (
                <div key={group.serviceType}>
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [group.serviceType]: !isOpen }))}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left border-b cd-border-c cd-row-hover"
                  >
                    {isOpen ? <ChevronDown className="w-4 h-4 cd-text-faint" /> : <ChevronRight className="w-4 h-4 cd-text-faint" />}
                    <span className="text-sm font-semibold cd-text">{group.serviceType}</span>
                    <span className="text-[11px] cd-text-faint ml-auto">{group.contracts.length}건</span>
                  </button>
                  {isOpen &&
                    group.contracts.map((c) => (
                      <button
                        key={c.contractId}
                        type="button"
                        onClick={() => {
                          onSelect({ contractId: c.contractId, contractTitle: c.contractTitle });
                          onClose();
                        }}
                        className="w-full flex items-center gap-2 pl-9 pr-4 py-2 text-left text-xs cd-row-hover border-b cd-border-c last:border-b-0"
                      >
                        <FileSignature className="w-3.5 h-3.5 cd-text-primary shrink-0" />
                        <span className="truncate cd-text">{c.contractTitle}</span>
                        <span className="ml-auto shrink-0 text-[10px] cd-text-faint truncate max-w-[40%]">{c.counterpartyName}</span>
                        <span className="shrink-0 text-[10px] font-mono cd-text-faint">{c.contractDate ?? ""}</span>
                      </button>
                    ))}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
