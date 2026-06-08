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

interface ContractDetailPayload {
  contract: Record<string, unknown>;
  milestones: Array<Record<string, unknown>>;
  outsourcing?: Array<Record<string, unknown>>;
  targetFacilities?: Array<Record<string, unknown>>;
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
  const [detail, setDetail] = useState<ContractDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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
        // 모달이 처음 뜰 때는 모든 부모 노드를 접힌 상태로 표시한다.
        setExpanded({});
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

  // 선택된 수주 건은 계약 상세 API 로 전체 정보를 받아와 계약 관리의 상세 카드와
  // 동일한 KPI 세트와 수금 진척도 차트를 표시한다.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/contracts/${encodeURIComponent(selectedId)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = (await res.json()) as ContractDetailPayload;
        if (!cancelled) setDetail(json);
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // 한 번에 하나의 부모 노드만 펼친다(아코디언). 열려 있는 노드를 다시 누르면 모두 접힌다.
  const toggleGroup = (serviceType: string) => {
    setExpanded((prev) => (prev[serviceType] ? {} : { [serviceType]: true }));
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
  const totalAmount = useMemo(
    () =>
      (tree?.groups ?? []).reduce(
        (acc, group) => acc + group.contracts.reduce((a, c) => a + Number(c.currentAmount ?? 0), 0),
        0
      ),
    [tree]
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/30 p-4">
      <div className="bg-white rounded-3xl w-[min(1120px,calc(100vw-32px))] max-h-[min(880px,calc(100vh-32px))] shadow-2xl flex flex-col overflow-hidden border border-stone-200">
        <div className="p-5 border-b border-stone-200 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold text-stone-800 flex items-center gap-2">
              <FolderTree className="w-5 h-5 text-primary" />
              {facilityName} 수주 현황
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              총 {totalCount.toLocaleString()}건 · {formatMoney(totalAmount)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-5 flex flex-col gap-4">
          <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden flex-1 min-h-[260px] flex flex-col">
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

          <div className="shrink-0 grid grid-cols-1 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,2.2fr)] gap-4 items-stretch">
            <OrdersOverviewCard tree={tree} />
            <div className="rounded-2xl border border-stone-200 bg-white p-4 min-h-[320px] flex flex-col">
              {!selected ? (
                <div className="flex-1 flex items-center justify-center text-sm text-stone-500">
                  위 트리에서 수주 건을 선택하세요.
                </div>
              ) : (
                <ContractSummary
                  node={selected}
                  detail={detail}
                  detailLoading={detailLoading}
                />
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-stone-200 flex justify-end">
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

function ContractSummary({
  node,
  detail,
  detailLoading,
}: {
  node: ContractTreeContractNode;
  detail: ContractDetailPayload | null;
  detailLoading: boolean;
}) {
  const contract = detail?.contract ?? {};
  const milestones = detail?.milestones ?? [];

  const milestoneAmountSum = milestones.reduce((acc, m) => acc + Number(m.amount ?? 0), 0);
  const baseAmount = milestones.length > 0
    ? milestoneAmountSum
    : Number(contract.current_amount ?? contract.contract_amount ?? node.currentAmount ?? 0);
  const collectedAmount = milestones.reduce((acc, m) => acc + Number(m.collected_amount ?? 0), 0);
  const collectionRate = baseAmount > 0 ? Math.min(1, collectedAmount / baseAmount) : 0;

  const contractKindLabel =
    String(contract.contract_kind ?? "standard") === "unit_price" ? "단가 계약" : "일반 계약";
  const statusLabel = detail ? getStatusLabel(detail) : statusLabelFromNode(node.contractStatus);

  return (
    <div className="grid gap-4">
      <div>
        <p className="text-[11px] text-stone-400 uppercase tracking-wide">계약명</p>
        <h4 className="text-lg font-bold text-stone-800 mt-0.5">{node.contractTitle}</h4>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(198px,234px)] gap-3">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <Kpi label="계약일" value={String(contract.contract_date ?? contract.started_at ?? node.contractDate ?? "-")} />
          <Kpi label="계약금액" value={baseAmount ? formatExactAmount(baseAmount) : "-"} accent />
          <Kpi label="업체명" value={String(contract.counterparty_name ?? node.counterpartyName ?? "-")} />
          <Kpi label="계약 종류" value={contractKindLabel} />
          <Kpi label="용역분류" value={String(contract.service_type ?? "-")} />
          <Kpi label="용역세분류" value={String(contract.service_subtype ?? node.serviceSubtype ?? "-")} />
          <Kpi label="준공일" value={String(contract.ended_at ?? "-")} />
          <Kpi label="계약 상태" value={statusLabel} accent={statusLabel !== "진행중"} />
          <Kpi label="업종" value={String(contract.industry_category ?? node.industryCategory ?? "-")} />
        </div>
        <CollectionProgressCard rate={collectionRate} collectedAmount={collectedAmount} baseAmount={baseAmount} />
      </div>

      {detailLoading && <p className="text-[11px] text-stone-400">상세 정보를 불러오는 중…</p>}
    </div>
  );
}

type OrderCategory = {
  label: string;
  keys: string[];
  color: string;
  iconSrc: string;
};

// 트리뷰 노드 아이콘과 동일한 용역별 색상을 그대로 사용한다(contract-tree-style 기준).
// 아이콘은 업로드된 단색 실루엣 PNG 를 CSS mask 로 입혀 색상만 용역색으로 칠한다.
// keys 가 비어 있는 마지막 "기타 용역" 항목은 어디에도 매칭되지 않은 그룹의 폴백 버킷이다.
const ORDER_CATEGORIES: OrderCategory[] = [
  { label: "통합환경허가", keys: ["통합허가", "통합환경허가", "통합"], color: "#ED7D31", iconSrc: "/icons/services/integrated-permit.png" },
  { label: "장외·화관법", keys: ["장외", "화관법", "유해화학"], color: "#FFC000", iconSrc: "/icons/services/chemical.png" },
  { label: "HAPs 용역", keys: ["HAPs"], color: "#70AD47", iconSrc: "/icons/services/haps.png" },
  { label: "ESG·탄소중립", keys: ["ESG", "탄소중립"], color: "#5B9BD5", iconSrc: "/icons/services/esg.png" },
  { label: "기타 용역", keys: [], color: "#7F7F7F", iconSrc: "/icons/services/etc.png" },
];

function OrdersOverviewCard({ tree }: { tree: ContractTreePayload | null }) {
  const rows = useMemo(() => {
    const totals = new Map<string, { count: number; amount: number }>();
    for (const cat of ORDER_CATEGORIES) totals.set(cat.label, { count: 0, amount: 0 });
    const fallback = ORDER_CATEGORIES[ORDER_CATEGORIES.length - 1];
    for (const group of tree?.groups ?? []) {
      const cat =
        ORDER_CATEGORIES.find((c) => c.keys.some((k) => group.serviceType.includes(k))) ?? fallback;
      const t = totals.get(cat.label)!;
      t.count += group.contracts.length;
      t.amount += group.contracts.reduce((acc, c) => acc + Number(c.currentAmount ?? 0), 0);
    }
    return ORDER_CATEGORIES.map((c) => ({ ...c, ...totals.get(c.label)! }));
  }, [tree]);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 flex flex-col">
      <p className="text-[11px] text-stone-400 uppercase tracking-wide">전체 용역 수주 현황</p>
      <div className="mt-3 grid content-start gap-2.5 flex-1">
        {rows.map((row) => {
          return (
            <div
              key={row.label}
              className="flex items-center gap-1.5 rounded-xl border border-stone-200 py-2 px-3"
            >
              <span
                className="shrink-0 inline-flex w-8 h-8 items-center justify-center rounded-lg"
                style={{ background: row.color + "1f" }}
              >
                <span
                  aria-hidden
                  className="w-[18px] h-[18px]"
                  style={{
                    backgroundColor: row.color,
                    maskImage: `url(${row.iconSrc})`,
                    WebkitMaskImage: `url(${row.iconSrc})`,
                    maskRepeat: "no-repeat",
                    WebkitMaskRepeat: "no-repeat",
                    maskPosition: "center",
                    WebkitMaskPosition: "center",
                    maskSize: "contain",
                    WebkitMaskSize: "contain",
                  }}
                />
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-stone-700">{row.label}</span>
              <span className="w-8 shrink-0 text-right text-xs tabular-nums text-stone-500">
                {row.count.toLocaleString()}건
              </span>
              <span className="w-14 shrink-0 text-right text-xs tabular-nums text-stone-800">
                {formatMoney(row.amount)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  const isEmpty = value == null || value === "";
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-3">
      <p className="text-[11px] text-stone-500">{label}</p>
      <p className={"text-sm mt-1 truncate " + (accent ? "text-primary font-bold" : "text-stone-800")}>
        {isEmpty ? "-" : value}
      </p>
    </div>
  );
}

function CollectionProgressCard({
  rate,
  collectedAmount,
  baseAmount,
}: {
  rate: number;
  collectedAmount: number;
  baseAmount: number;
}) {
  const percent = Math.round(rate * 100);
  const today = formatKoreanDate(new Date());
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 min-h-[180px] flex flex-col items-center justify-center relative">
      <p className="absolute left-4 top-3 text-[11px] font-bold text-stone-500">수금 진척도</p>
      <div
        className="w-28 h-28 rounded-full flex items-center justify-center"
        style={{ background: `conic-gradient(#9BC2E6 ${percent}%, #ececec ${percent}% 100%)` }}
      >
        <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center">
          <span className="text-2xl font-bold text-[#9BC2E6]">{percent}%</span>
        </div>
      </div>
      <p className="mt-3 text-xs font-mono text-stone-600">
        {formatExactAmount(collectedAmount)} / {formatExactAmount(baseAmount)}
      </p>
      <p className="absolute right-4 bottom-3 text-[11px] text-stone-500">{today} 기준</p>
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
      <span className="w-[96px] text-right text-[10px] font-mono text-stone-400 ml-2 shrink-0 tabular-nums">
        {contract.contractDate ?? "-"}
      </span>
      <span className="w-[80px] text-right text-[10px] font-mono text-stone-500 ml-1 shrink-0 tabular-nums">
        {formatMoney(contract.currentAmount)}
      </span>
    </button>
  );
}

function statusLabelFromNode(status: string): string {
  if (status === "terminated") return "계약해지";
  if (status === "suspended") return "계약중지";
  return "진행중";
}

function getStatusLabel(detail: ContractDetailPayload): string {
  const contract = detail.contract;
  const status = String(contract.contract_status ?? "active");
  if (status === "terminated" || contract.contract_terminated_at) return "계약해지";
  if (status === "suspended" || contract.contract_suspended_at) return "계약중지";
  const lastMilestone = detail.milestones[detail.milestones.length - 1];
  if (lastMilestone && isMilestoneFullyCollected(lastMilestone)) return "수행 완료";
  if (status === "completed") return "수행 완료";
  if (status === "draft") return "초안";
  return "진행중";
}

function isMilestoneFullyCollected(milestone: Record<string, unknown>): boolean {
  const amount = Number(milestone.amount ?? 0);
  const collectedAmount = Number(milestone.collected_amount ?? 0);
  if (Number(milestone.payment_collected ?? 0) === 1) return true;
  if (Number(milestone.collection_ratio ?? 0) >= 1) return true;
  return amount > 0 && collectedAmount >= amount;
}

function formatKoreanDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}.`;
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
