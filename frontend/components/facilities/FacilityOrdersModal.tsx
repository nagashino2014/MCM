"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderClosed,
  FolderOpen,
  FolderTree,
  X,
} from "lucide-react";
import { resolveServiceTypeStyle, type ServiceTypeStyle } from "@/lib/ieps/contract-tree-style";

interface ContractTreeContractNode {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  serviceSubtype: string | null;
  industryCategory: string | null;
  facilityIndustryName: string | null;
  facilityIndustryCode: string | null;
  currentAmount: number | null;
  contractDate: string | null;
  contractStatus: string;
  isFullyCollected: boolean;
}

interface ContractTreeServiceGroup {
  serviceType: string;
  contracts: ContractTreeContractNode[];
}

interface ContractTreePayload {
  year: string | null;
  totalCount: number;
  availableYears: string[];
  groups: ContractTreeServiceGroup[];
}

interface Props {
  facilityId: string;
  facilityName: string;
  onClose: () => void;
}

export function FacilityOrdersModal({ facilityId, facilityName, onClose }: Props) {
  const [tree, setTree] = useState<ContractTreePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/facilities/${encodeURIComponent(facilityId)}/contracts`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? "HTTP " + res.status);
        }
        const json = (await res.json()) as ContractTreePayload;
        if (cancelled) return;
        setTree(json);
        // 자식 노드가 있는 부모 그룹은 기본적으로 펼쳐서 표시한다.
        const initialExpanded: Record<string, boolean> = {};
        for (const group of json.groups) {
          if (group.contracts.length > 0) initialExpanded[group.serviceType] = true;
        }
        setExpanded(initialExpanded);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [facilityId]);

  const toggleGroup = (serviceType: string) => {
    setExpanded((prev) => ({ ...prev, [serviceType]: !prev[serviceType] }));
  };

  const selected = useMemo(() => {
    if (!tree || !selectedId) return null;
    for (const group of tree.groups) {
      for (const c of group.contracts) {
        if (c.contractId === selectedId) return c;
      }
    }
    return null;
  }, [tree, selectedId]);

  const totalCount = tree?.totalCount ?? 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/20 p-4">
      <div className="glass-panel rounded-3xl w-[min(960px,calc(100vw-32px))] max-h-[min(820px,calc(100vh-32px))] shadow-2xl flex flex-col overflow-hidden">
        <div className="p-5 border-b border-stone-200/70 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-stone-800 flex items-center gap-2">
              <FolderTree className="w-5 h-5 text-primary" />
              수주 현황
            </h3>
            <p className="text-xs text-stone-500 mt-1">{facilityName} · 총 {totalCount.toLocaleString()}건</p>
          </div>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(320px,0.95fr)_minmax(320px,1.05fr)]">
          <div className="min-h-0 flex flex-col border-r border-stone-200/70">
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
              {loading ? (
                <div className="p-10 text-center text-sm text-stone-500">불러오는 중…</div>
              ) : error ? (
                <div className="p-10 text-center text-sm text-rose-600">{error}</div>
              ) : !tree || tree.groups.length === 0 ? (
                <div className="p-10 text-center text-sm text-stone-500">해당 사업장을 대상으로 한 수주 건이 없습니다.</div>
              ) : (
                tree.groups.map((group) => {
                  const style = resolveServiceTypeStyle(group.serviceType);
                  const isOpen = expanded[group.serviceType] === true;
                  return (
                    <div key={group.serviceType}>
                      <TreeGroupHeader
                        serviceType={group.serviceType}
                        count={group.contracts.length}
                        isOpen={isOpen}
                        style={style}
                        onToggle={toggleGroup}
                      />
                      {isOpen &&
                        group.contracts.map((contract, idx) => (
                          <TreeChildRow
                            key={contract.contractId}
                            contract={contract}
                            isSelected={contract.contractId === selectedId}
                            isLastChild={idx === group.contracts.length - 1}
                            childColor={style.childColor}
                            onSelect={setSelectedId}
                          />
                        ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto scrollbar-hide p-5">
            {!selected ? (
              <div className="h-full flex items-center justify-center text-sm text-stone-500">
                좌측에서 수주 건을 선택하세요.
              </div>
            ) : (
              <div className="grid gap-3">
                <div>
                  <p className="text-[11px] text-stone-400 uppercase tracking-wide">계약명</p>
                  <h4 className="text-lg font-bold text-stone-800 mt-0.5">{selected.contractTitle}</h4>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <SummaryItem label="거래처" value={selected.counterpartyName || "-"} />
                  <SummaryItem label="용역세분류" value={selected.serviceSubtype || "-"} />
                  <SummaryItem label="계약일" value={selected.contractDate || "-"} />
                  <SummaryItem label="계약금액" value={formatExactAmount(selected.currentAmount)} highlight />
                  <SummaryItem label="업종" value={selected.industryCategory || "-"} />
                  <SummaryItem label="계약 상태" value={statusLabel(selected.contractStatus)} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-stone-200/70 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="glass-button rounded-xl px-4 py-2 text-sm font-bold text-stone-700"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={"rounded-2xl border p-3 " + (highlight ? "bg-primary/5 border-primary/30" : "bg-white/60 border-stone-200/80")}>
      <p className="text-[11px] text-stone-500">{label}</p>
      <p className={"text-sm mt-1 truncate " + (highlight ? "text-primary" : "text-stone-800")}>{value}</p>
    </div>
  );
}

function TreeGroupHeader({
  serviceType,
  count,
  isOpen,
  style,
  onToggle,
}: {
  serviceType: string;
  count: number;
  isOpen: boolean;
  style: ServiceTypeStyle;
  onToggle: (serviceType: string) => void;
}) {
  const ParentIcon = isOpen ? FolderOpen : Folder;
  return (
    <button
      type="button"
      onClick={() => onToggle(serviceType)}
      className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-stone-50 border-b border-stone-200/70"
    >
      {isOpen ? (
        <ChevronDown className="w-4 h-4 text-stone-500" />
      ) : (
        <ChevronRight className="w-4 h-4 text-stone-500" />
      )}
      <ParentIcon className="w-4 h-4 fill-current transition-transform" style={{ color: style.parentColor }} />
      <span className="text-sm text-stone-800">{serviceType}</span>
      <span className="text-[11px] text-stone-500 ml-auto">{count}건</span>
    </button>
  );
}

function TreeChildRow({
  contract,
  isSelected,
  isLastChild,
  childColor,
  onSelect,
}: {
  contract: ContractTreeContractNode;
  isSelected: boolean;
  isLastChild: boolean;
  childColor: string;
  onSelect: (contractId: string) => void;
}) {
  const ChildIcon = isSelected ? FolderOpen : FolderClosed;
  return (
    <button
      type="button"
      onClick={() => onSelect(contract.contractId)}
      className={
        "relative w-full flex items-center gap-2 pl-12 pr-3 py-2 text-left text-xs bg-white/40 hover:bg-primary/5 " +
        (isSelected ? "bg-primary/10 border-l-4 border-primary" : "border-l-4 border-transparent")
      }
    >
      <span
        aria-hidden
        className={
          "pointer-events-none absolute left-7 w-px bg-stone-300 " +
          (isLastChild ? "top-0 h-1/2" : "top-0 bottom-0")
        }
      />
      <span aria-hidden className="pointer-events-none absolute left-7 top-1/2 w-3 h-px bg-stone-300" />
      <ChildIcon className="w-3.5 h-3.5 fill-current shrink-0" style={{ color: childColor }} />
      <span className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="truncate text-stone-800">{contract.contractTitle}</span>
        {contract.contractStatus === "terminated" && (
          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] text-white" style={{ background: "#FF7171" }}>
            계약해지
          </span>
        )}
        {contract.contractStatus === "suspended" && (
          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] text-stone-800" style={{ background: "#FFD966" }}>
            계약중지
          </span>
        )}
        {contract.isFullyCollected && (
          <span
            aria-label="수금 완료"
            title="수금 완료"
            className="shrink-0 w-1.5 h-1.5 rounded-full"
            style={{ background: childColor }}
          />
        )}
      </span>
      <span className="w-[88px] text-right text-[10px] font-mono text-stone-400 ml-2 shrink-0 tabular-nums">
        {contract.contractDate ?? "-"}
      </span>
      <span className="w-[72px] text-right text-[10px] font-mono text-stone-500 ml-1 shrink-0 tabular-nums">
        {formatMoney(contract.currentAmount)}
      </span>
    </button>
  );
}

function statusLabel(status: string): string {
  if (status === "terminated") return "계약해지";
  if (status === "suspended") return "계약중지";
  return "진행중";
}

function formatMoney(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "-";
  if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, "") + "억";
  if (Math.abs(n) >= 10000) return Math.round(n / 10000).toLocaleString() + "만";
  return n.toLocaleString();
}

function formatExactAmount(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "-";
  return Math.round(n).toLocaleString("en-US");
}
