"use client";

import { Suspense, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Virtuoso } from "react-virtuoso";
import type { ServiceTypeStyle } from "@/lib/ieps/contract-tree-style";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  FileSignature,
  FileText,
  Folder,
  FolderClosed,
  FolderOpen,
  GitCommitHorizontal,
  GripVertical,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  WalletCards,
  X,
} from "lucide-react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";
import { resolveServiceTypeStyle } from "@/lib/ieps/contract-tree-style";
import ContractChangeModal from "@/components/contracts/ContractChangeModal";
import ContractStaffingModal from "@/components/contracts/ContractStaffingModal";
import TaxInvoiceIssueModal from "@/components/contracts/TaxInvoiceIssueModal";
import FacilityInfoModal from "@/components/contracts/FacilityInfoModal";
import { IndustryOptionsEditorButton, useContractIndustryOptions } from "@/components/contracts/IndustryOptionsEditor";
import { CONTRACT_SERVICE_OPTIONS } from "@/lib/contracts/service-options";
import { RateCardEditor, type RateCardData } from "@/components/contracts/RateCardEditor";
import { createRateCard, rateCardHasContent, rateCardStageOptions, upgradeRateCard } from "@/lib/contracts/rate-card";
import {
  ORDERING_SUBJECT_OPTIONS,
  ORDERING_SUBJECT_SITE_DIRECT,
  ORDERING_SUBJECT_PARENT_CORP,
  ORDERING_SUBJECT_CONSIGNED_OPERATOR,
  findFacilityByBusinessRegistrationNo,
  getOrderingSubjectLabel,
  validateOrderingTargetFacility,
} from "@/lib/ieps/ordering-subject";

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
  /** 완료 건 — 완료일(허가일) 혹은 완료일(발행일)이 존재(서버 판정, 트리 하단 집계용). */
  isCompleted: boolean;
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

interface ContractDetail {
  contract: Record<string, unknown>;
  milestones: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  changes: Array<Record<string, unknown>>;
  outsourcing: Array<Record<string, unknown>>;
  targetFacilities: Array<Record<string, unknown>>;
}

interface InvoiceModalState {
  milestoneId: string;
  stageLabel: string;
  baseAmount: number;
  issueDate: string;
  invoiceAmount: string;
  paymentCollected: boolean;
  paymentCollectedAt: string;
  collectionRatio: string;
  collectedAmount: string;
  paymentTerms: string;
  partialPaymentMemo: string;
  memo: string;
  /** 실적 정산을 반영한 실제 청구액. 최종 대금 지급 단계에서만 입력한다. */
  settlementAmount: string;
  /** 이 단계가 실적 정산 입력 대상인지(최종 단계 + 준공금/잔금 계열 단계명) */
  settlementEligible: boolean;
}

interface ContractMilestoneDraft {
  id: string;
  stageLabel: string;
  amount: string;
  paymentTerms: string;
}

interface OutsourcingDraft {
  outsourcingTitle: string;
  counterpartyQuery: string;
  counterpartyFacilityId: string;
  counterpartyName: string;
  serviceType: string;
  contractDate: string;
  endedAt: string;
  amount: string;
  memo: string;
}

interface NewContractModalState {
  contractTitle: string;
  counterpartyQuery: string;
  counterpartyFacilityId: string;
  counterpartyName: string;
  counterpartyBusinessRegistrationNo: string | null;
  facilityQuery: string;
  selectedFacilities: FacilitySearchItem[];
  serviceType: string;
  serviceSubtype: string;
  contractKind: "standard" | "unit_price";
  paymentMethod: string;
  orderingSubjectType: string;
  contractDate: string;
  startedAt: string;
  endedAt: string;
  currentAmount: string;
  industryCategory: string;
  memo: string;
  milestones: ContractMilestoneDraft[];
  /** 단가 계약(contractKind='unit_price') 전용 — 단가 기준표(항목 마스터 + 차수별 수량). */
  rateCard: RateCardData;
  outsourcing: OutsourcingDraft;
}

interface NewStageModalState {
  stageLabel: string;
  amount: string;
  paymentTerms: string;
}

interface EditMilestoneModalState {
  milestoneId: string;
  stageLabel: string;
  baseAmount: number;
  amount: string;
  paymentTerms: string;
  issueDate: string;
  invoiceAmount: string;
  paymentCollected: boolean;
  paymentCollectedAt: string;
  collectedAmount: string;
  collectionRatio: string;
  partialPaymentMemo: string;
}

interface FacilitySearchItem {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
  integratedPermitTarget?: string | null;
}

interface PdfViewerState {
  title: string;
  url: string;
}

const DEFAULT_OUTSOURCING_TYPES = ["도면 작성", "산업안전 관련", "측정/분석", "디자인", "번역"];
const PAYMENT_METHOD_OPTIONS = ["현금", "어음 : 1개월 이하", "어음 : 2개월 이하", "어음 : 2개월 이상"];

// 실적 정산(출장 경비·인쇄비 등의 차액 정산)은 준공금 성격의 최종 대금 지급 단계에만
// 적용된다. 단계명이 아래 목록에 해당하면서 청구·수금 단계의 마지막 행일 때만 노출.
const SETTLEMENT_STAGE_LABELS = ["준공금", "잔금", "준공 기성금"];

function isSettlementStage(stageLabel: unknown, index: number, total: number): boolean {
  if (index !== total - 1) return false;
  return SETTLEMENT_STAGE_LABELS.includes(String(stageLabel ?? "").trim());
}

export default function ContractsPage() {
  return (
    <ToastProvider>
      <Suspense fallback={null}>
        <ContractsInner />
      </Suspense>
    </ToastProvider>
  );
}

function ContractsInner() {
  const toast = useToast();
  const { theme, toggleTheme } = useCdashTheme();
  const router = useRouter();
  const searchParams = useSearchParams();
  // 외부 메뉴(수주 현황 등)에서 ?contract=&year= 로 진입 시 해당 계약을 자동 선택한다.
  const pendingContractRef = useRef<string | null>(searchParams.get("contract"));
  // 미발행 현황에서 ?milestone= 로 진입 시 상세 로드 후 발행/수금 모달을 자동으로 연다.
  const pendingMilestoneRef = useRef<string | null>(searchParams.get("milestone"));
  // 수주 현황 리스트에서 진입한 경우 상세 헤더에 "돌아가기" 버튼을 노출한다.
  const fromBillingOrdersRef = useRef(searchParams.get("from") === "billing-orders");
  const [tree, setTree] = useState<ContractTreePayload | null>(null);
  const [year, setYear] = useState<string>(() => {
    const fromQuery = searchParams.get("year");
    return fromQuery && /^\d{4}$/.test(fromQuery) ? fromQuery : String(new Date().getFullYear());
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [, startSearchTransition] = useTransition();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [invoiceModal, setInvoiceModal] = useState<InvoiceModalState | null>(null);
  // 전자세금계산서 발행(P4) — 수기 기록(InvoiceUploadModal)과 병존한다.
  const [taxInvoiceTarget, setTaxInvoiceTarget] = useState<{ milestoneId: string } | null>(null);
  const [newContractModal, setNewContractModal] = useState<NewContractModalState | null>(null);
  const [newStageModal, setNewStageModal] = useState<NewStageModalState | null>(null);
  const [editMilestoneModal, setEditMilestoneModal] = useState<EditMilestoneModalState | null>(null);
  const [pdfViewer, setPdfViewer] = useState<PdfViewerState | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [changeModalOpen, setChangeModalOpen] = useState(false);

  const reloadTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (year) params.set("year", year);
      const res = await fetch("/api/contracts/tree?" + params.toString(), { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as ContractTreePayload;
      setTree(json);
      setExpanded((prev) => {
        const next = { ...prev };
        for (const group of json.groups) {
          if (next[group.serviceType] === undefined) next[group.serviceType] = false;
        }
        return next;
      });
      const pending = pendingContractRef.current;
      const pendingGroup = pending
        ? json.groups.find((g) => g.contracts.some((c) => c.contractId === pending))
        : undefined;
      if (pending && pendingGroup) {
        // 딥링크 계약 선택 + 해당 용역 그룹만 펼침 (아코디언 동작과 동일)
        pendingContractRef.current = null;
        setExpanded(() => {
          const next: Record<string, boolean> = {};
          for (const group of json.groups) next[group.serviceType] = group.serviceType === pendingGroup.serviceType;
          return next;
        });
        setSelectedId(pending);
      } else {
        setSelectedId((current) => {
          if (current && json.groups.some((g) => g.contracts.some((c) => c.contractId === current))) return current;
          return null;
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [year]);

  const loadDetail = useCallback(async (contractId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch("/api/contracts/" + encodeURIComponent(contractId), { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      setDetail((await res.json()) as ContractDetail);
    } catch (err) {
      toast.show("상세 조회 실패: " + (err as Error).message, "error");
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    reloadTree();
  }, [reloadTree]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // 미발행 현황 딥링크: 상세 로드 후 해당 청구·수금 단계의 발행/수금 모달을 자동으로 연다
  useEffect(() => {
    const milestoneId = pendingMilestoneRef.current;
    if (!milestoneId || !detail) return;
    const milestoneIndex = detail.milestones.findIndex((m) => String(m.milestone_id ?? "") === milestoneId);
    if (milestoneIndex < 0) return;
    const milestone = detail.milestones[milestoneIndex];
    pendingMilestoneRef.current = null;
    setInvoiceModal({
      milestoneId,
      stageLabel: String(milestone.stage_label ?? ""),
      baseAmount: Number(milestone.amount ?? 0),
      issueDate: String(milestone.invoice_issued_at ?? new Date().toISOString().slice(0, 10)),
      invoiceAmount: String(milestone.invoice_amount ?? milestone.amount ?? ""),
      paymentCollected: Number(milestone.payment_collected ?? 0) === 1,
      paymentCollectedAt: String(milestone.payment_collected_at ?? ""),
      collectionRatio: String(milestone.collection_ratio ?? "1"),
      collectedAmount: String(milestone.collected_amount ?? milestone.amount ?? ""),
      paymentTerms: String(milestone.payment_terms ?? ""),
      partialPaymentMemo: "",
      memo: "",
      settlementAmount: String(milestone.settlement_amount ?? ""),
      settlementEligible: isSettlementStage(milestone.stage_label, milestoneIndex, detail.milestones.length),
    });
  }, [detail]);

  const selectContract = useCallback((id: string) => setSelectedId(id), []);
  // Accordion behavior: opening a group automatically collapses all other
  // open groups so that the user only ever scrolls within a single service
  // section at a time.
  const toggleGroup = useCallback((serviceType: string) => {
    setExpanded((prev) => {
      const wasOpen = prev[serviceType] === true;
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(prev)) next[key] = false;
      next[serviceType] = !wasOpen;
      return next;
    });
  }, []);

  const filteredGroups = useMemo(() => {
    if (!tree) return [];
    const q = search.trim().toLowerCase();
    if (!q) return tree.groups;
    return tree.groups
      .map((group) => ({
        serviceType: group.serviceType,
        contracts: group.contracts.filter((c) =>
          c.contractTitle.toLowerCase().includes(q) ||
          c.counterpartyName.toLowerCase().includes(q) ||
          (c.serviceSubtype ?? "").toLowerCase().includes(q)
        ),
      }))
      .filter((group) => group.contracts.length > 0);
  }, [tree, search]);

  const totalCount = useMemo(
    () => filteredGroups.reduce((acc, g) => acc + g.contracts.length, 0),
    [filteredGroups]
  );

  // 트리 하단 집계(2026-08-24) — 해지 > 중지 > 완료(허가일·발행일 존재) > 수행 순의 배타 분류.
  const treeStats = useMemo(() => {
    const stats = { total: 0, active: 0, completed: 0, suspended: 0, terminated: 0 };
    for (const g of tree?.groups ?? []) {
      for (const c of g.contracts) {
        stats.total += 1;
        if (c.contractStatus === "terminated") stats.terminated += 1;
        else if (c.contractStatus === "suspended") stats.suspended += 1;
        else if (c.isCompleted) stats.completed += 1;
        else stats.active += 1;
      }
    }
    return stats;
  }, [tree]);

  /**
   * Flatten the tree into a single ordered list of rows for the virtual
   * scroller. Group headers are always emitted; child rows are emitted only
   * when the group is currently expanded. Per-row `style` is precomputed once
   * so that the row component does not redo the lookup on every render.
   */
  const flatRows = useMemo<TreeFlatRow[]>(() => {
    const rows: TreeFlatRow[] = [];
    for (const group of filteredGroups) {
      const style = resolveServiceTypeStyle(group.serviceType);
      const isOpen = expanded[group.serviceType] === true;
      rows.push({
        kind: "group",
        serviceType: group.serviceType,
        count: group.contracts.length,
        isOpen,
        style,
      });
      if (isOpen) {
        for (let i = 0; i < group.contracts.length; i++) {
          rows.push({
            kind: "child",
            contract: group.contracts[i],
            isLastChild: i === group.contracts.length - 1,
            style,
          });
        }
      }
    }
    return rows;
  }, [filteredGroups, expanded]);

  // Defer the heavy child portion of the list to keep group toggle / search
  // input feeling instantaneous; the headers are still computed synchronously.
  const deferredFlatRows = useDeferredValue(flatRows);

  const selected = useMemo(() => {
    if (!tree) return null;
    for (const group of tree.groups) {
      for (const c of group.contracts) {
        if (c.contractId === selectedId) return c;
      }
    }
    return null;
  }, [tree, selectedId]);

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<FileSignature className="w-5 h-5" />}
        eyebrow="Contract · Ledger"
        title="계약 관리"
        subtitle="신규/변경 계약 입력, 계산서 및 수금 정보 등록"
        actions={
          <>
            <button
              type="button"
              onClick={() => setNewContractModal(createEmptyContractState())}
              className="cd-btn cd-btn-primary cd-btn-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              신규 계약
            </button>
            <button type="button" onClick={reloadTree} className="cd-btn cd-btn-ghost cd-btn-sm">
              <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
              새로고침
            </button>
          </>
        }
      />

      {error ? (
        <div className="cd-card rounded-2xl p-6 text-sm text-rose-600">
          계약 데이터를 불러오지 못했습니다. <code>infra/aws/005_contract_management_round2.sql</code> 적용 여부와 DB 연결을 확인하세요.
          <div className="mt-2 font-mono text-xs cd-text-muted">{error}</div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(360px,0.9fr)_minmax(560px,1.4fr)] gap-5">
          <section className="cd-card rounded-3xl overflow-hidden cd-reveal delay-2 flex min-h-0 flex-col">
            <div className="p-4 border-b cd-border-c flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold cd-text flex items-center gap-2">
                  <WalletCards className="w-4 h-4 cd-text-primary" />
                  계약 원장
                </h2>
                <p className="text-xs cd-text-faint">총 {totalCount.toLocaleString()}건</p>
              </div>
            </div>
            <div className="px-4 py-3 border-b cd-border-c flex items-center gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Search className="w-4 h-4 cd-text-faint shrink-0" />
                <input
                  type="text"
                  className="cd-input text-xs"
                  placeholder="계약명 / 거래처 / 세분류 검색"
                  value={searchInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSearchInput(value);
                    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                    searchDebounceRef.current = setTimeout(() => {
                      startSearchTransition(() => setSearch(value));
                    }, 180);
                  }}
                />
              </div>
              <select
                className="cd-select text-xs shrink-0"
                style={{ width: "17ch" }}
                value={year}
                onChange={(e) => setYear(e.target.value)}
              >
                <option value="">전체 연도</option>
                {(tree?.availableYears ?? []).map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-h-0">
              {filteredGroups.length === 0 && !loading ? (
                <div className="h-full p-10 text-center text-sm cd-text-faint">조건에 맞는 계약이 없습니다.</div>
              ) : (
                <Virtuoso
                  style={{ height: "100%", minHeight: 0 }}
                  data={deferredFlatRows}
                  increaseViewportBy={400}
                  computeItemKey={(_, row) =>
                    row.kind === "group" ? "g:" + row.serviceType : "c:" + row.contract.contractId
                  }
                  itemContent={(_, row) =>
                    row.kind === "group" ? (
                      <TreeGroupHeader
                        serviceType={row.serviceType}
                        count={row.count}
                        isOpen={row.isOpen}
                        style={row.style}
                        onToggle={toggleGroup}
                      />
                    ) : (
                      <TreeChildRow
                        contract={row.contract}
                        isSelected={row.contract.contractId === selectedId}
                        isLastChild={row.isLastChild}
                        childColor={row.style.childColor}
                        onSelect={selectContract}
                      />
                    )
                  }
                />
              )}
            </div>
            {/* 왼쪽 정렬 + 수행/완료(+조건부 중지/해지) 집계(2026-08-24 사용자 요청) */}
            <div className="p-3 text-xs cd-text-faint border-t cd-border-c flex items-center gap-3 flex-wrap">
              <span>계약 건수: {treeStats.total.toLocaleString()}</span>
              <span>수행: {treeStats.active.toLocaleString()}</span>
              <span>완료: {treeStats.completed.toLocaleString()}</span>
              {treeStats.suspended > 0 && <span>중지: {treeStats.suspended.toLocaleString()}</span>}
              {treeStats.terminated > 0 && <span>해지: {treeStats.terminated.toLocaleString()}</span>}
            </div>
          </section>

          <section className="cd-card rounded-3xl p-5 cd-reveal delay-3 min-h-0 overflow-y-auto scrollbar-hide">
            {!selected ? (
              <div className="h-full flex items-center justify-center text-sm cd-text-faint">계약을 선택하세요.</div>
            ) : detailLoading || !detail ? (
              <div className="h-full flex items-center justify-center text-sm cd-text-faint">상세 정보를 불러오는 중입니다.</div>
            ) : (
              <ContractDetailPanel
                detail={detail}
                onBackToBilling={
                  fromBillingOrdersRef.current
                    ? () => router.push("/contracts/billing?tab=orders&restore=1")
                    : undefined
                }
                onOpenInvoice={setInvoiceModal}
                onOpenTaxInvoice={(milestoneId) => setTaxInvoiceTarget({ milestoneId })}
                onOpenNewStage={() => setNewStageModal({ stageLabel: "", amount: "", paymentTerms: "" })}
                onOpenEditStage={setEditMilestoneModal}
                onOpenChange={() => setChangeModalOpen(true)}
                onOpenPdf={setPdfViewer}
                onReloadDetail={() => selected && loadDetail(selected.contractId)}
                onDeleteContract={() => setDeleteModalOpen(true)}
                onDeleteStage={async (milestoneId) => {
                  if (!selected) return;
                  if (!confirm("해당 청구·수금 단계를 삭제할까요? 단계 삭제는 휴지통으로 이동하지 않고 즉시 삭제됩니다.")) return;
                  try {
                    const res = await fetch(
                      `/api/contracts/${encodeURIComponent(selected.contractId)}/milestones/${encodeURIComponent(milestoneId)}`,
                      { method: "DELETE" }
                    );
                    if (!res.ok) {
                      const body = await res.json().catch(() => ({}));
                      throw new Error(body?.error ?? "HTTP " + res.status);
                    }
                    toast.show("단계가 삭제되었습니다.", "success");
                    loadDetail(selected.contractId);
                  } catch (err) {
                    toast.show("삭제 실패: " + (err as Error).message, "error");
                  }
                }}
                onReorderStages={async (orderedIds) => {
                  if (!selected) return;
                  try {
                    const res = await fetch(
                      `/api/contracts/${encodeURIComponent(selected.contractId)}/milestones/reorder`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ order: orderedIds }),
                      }
                    );
                    if (!res.ok) {
                      const body = await res.json().catch(() => ({}));
                      throw new Error(body?.error ?? "HTTP " + res.status);
                    }
                    toast.show("단계 순서가 변경되었습니다.", "success");
                    loadDetail(selected.contractId);
                  } catch (err) {
                    toast.show("순서 변경 실패: " + (err as Error).message, "error");
                    loadDetail(selected.contractId);
                  }
                }}
              />
            )}
          </section>
        </div>
      )}

      {taxInvoiceTarget && selectedId && (
        <TaxInvoiceIssueModal
          contractId={selectedId}
          milestoneId={taxInvoiceTarget.milestoneId}
          onClose={() => setTaxInvoiceTarget(null)}
          onIssued={() => {
            setTaxInvoiceTarget(null);
            if (selectedId) loadDetail(selectedId);
            reloadTree();
          }}
        />
      )}

      {invoiceModal && selectedId && (
        <InvoiceUploadModal
          contractId={selectedId}
          state={invoiceModal}
          onChange={setInvoiceModal}
          onClose={() => setInvoiceModal(null)}
          onSaved={() => {
            setInvoiceModal(null);
            if (selectedId) loadDetail(selectedId);
            reloadTree();
          }}
        />
      )}

      {newStageModal && selectedId && (
        <NewStageModal
          contractId={selectedId}
          contractKind={String(detail?.contract.contract_kind ?? "standard")}
          state={newStageModal}
          onChange={setNewStageModal}
          onClose={() => setNewStageModal(null)}
          onSaved={() => {
            setNewStageModal(null);
            if (selectedId) loadDetail(selectedId);
          }}
        />
      )}

      {editMilestoneModal && selectedId && (
        <EditMilestoneModal
          contractId={selectedId}
          state={editMilestoneModal}
          onChange={setEditMilestoneModal}
          onClose={() => setEditMilestoneModal(null)}
          onSaved={() => {
            setEditMilestoneModal(null);
            if (selectedId) loadDetail(selectedId);
            reloadTree();
          }}
        />
      )}

      {newContractModal && (
        <NewContractModal
          state={newContractModal}
          onChange={setNewContractModal}
          onClose={() => setNewContractModal(null)}
          onSaved={(contractId) => {
            setNewContractModal(null);
            setSelectedId(contractId);
            reloadTree();
            loadDetail(contractId);
          }}
        />
      )}

      {changeModalOpen && selected && detail && (
        <ContractChangeModal
          contractId={selected.contractId}
          contractTitle={selected.contractTitle}
          counterpartyName={selected.counterpartyName}
          counterpartyBusinessRegistrationNo={
            detail.contract.counterparty_business_registration_no != null
              ? String(detail.contract.counterparty_business_registration_no)
              : null
          }
          contractDate={selected.contractDate}
          contractKind={String(detail.contract.contract_kind ?? "standard")}
          initialMilestones={detail.milestones.map((m) => ({
            stageLabel: String(m.stage_label ?? ""),
            amount: Number(m.amount ?? 0),
            paymentTerms: String(m.payment_terms ?? ""),
          }))}
          initialServiceType={String(detail.contract.service_type ?? "") || ""}
          initialServiceSubtype={String(detail.contract.service_subtype ?? "") || ""}
          initialIndustryCategory={String(detail.contract.industry_category ?? "") || ""}
          initialPaymentMethod={String(detail.contract.payment_method ?? "") || ""}
          initialTargetFacilities={detail.targetFacilities.map((facility) => ({
            facilityId: String(facility.facility_id ?? ""),
            companyName: String(facility.company_name ?? ""),
            businessRegistrationNo: facility.business_registration_no != null ? String(facility.business_registration_no) : null,
            siteAddress: facility.site_address != null ? String(facility.site_address) : null,
            integratedPermitTarget: facility.integrated_permit_target != null ? String(facility.integrated_permit_target) : null,
          })).filter((facility) => facility.facilityId && facility.companyName)}
          initialOrderingSubjectType={detail.contract.ordering_subject_type != null ? String(detail.contract.ordering_subject_type) : null}
          initialEndedAt={String(detail.contract.ended_at ?? "") || null}
          initialCurrentAmount={selected.currentAmount}
          onClose={() => setChangeModalOpen(false)}
          onSaved={() => {
            setChangeModalOpen(false);
            if (selectedId) loadDetail(selectedId);
            reloadTree();
          }}
        />
      )}

      {deleteModalOpen && selected && (
        <ContractDeleteModal
          contractTitle={selected.contractTitle}
          onClose={() => setDeleteModalOpen(false)}
          onDelete={async (deleteReason) => {
            try {
              const res = await fetch(`/api/contracts/${encodeURIComponent(selected.contractId)}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deleteReason }),
              });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body?.error ?? "HTTP " + res.status);
              }
              toast.show("계약이 삭제되었습니다.", "success");
              setDeleteModalOpen(false);
              setSelectedId(null);
              setDetail(null);
              reloadTree();
            } catch (err) {
              toast.show("계약 삭제 실패: " + (err as Error).message, "error");
            }
          }}
        />
      )}

      {pdfViewer && (
        <DraggablePdfViewer
          title={pdfViewer.title}
          url={pdfViewer.url}
          onClose={() => setPdfViewer(null)}
        />
      )}
    </div>
  );
}

function ContractDetailPanel({
  detail,
  onBackToBilling,
  onOpenInvoice,
  onOpenTaxInvoice,
  onOpenNewStage,
  onOpenEditStage,
  onOpenChange,
  onOpenPdf,
  onDeleteContract,
  onDeleteStage,
  onReorderStages,
  onReloadDetail,
}: {
  detail: ContractDetail;
  /** 수주 현황에서 진입한 경우에만 전달 — 헤더에 돌아가기 버튼 노출 */
  onBackToBilling?: () => void;
  onOpenInvoice: (state: InvoiceModalState) => void;
  onOpenTaxInvoice: (milestoneId: string) => void;
  onOpenNewStage: () => void;
  onOpenEditStage: (state: EditMilestoneModalState) => void;
  onOpenChange: () => void;
  onOpenPdf: (state: PdfViewerState) => void;
  onDeleteContract: () => void;
  onDeleteStage: (milestoneId: string) => void;
  onReorderStages: (orderedIds: string[]) => void;
  /** 허가 정보 저장 등 패널 내부 갱신 후 상세 재조회 */
  onReloadDetail: () => void;
}) {
  const contract = detail.contract;
  // 용역(계약) 금액은 청구·수금 단계 각 항목 금액의 합을 기준으로 한다.
  // 단계가 하나도 없을 때만 계약에 기록된 금액으로 폴백한다.
  const milestoneAmountSum = detail.milestones.reduce(
    (acc, m) => acc + Number(m.amount ?? 0),
    0
  );
  const baseAmount = detail.milestones.length > 0
    ? milestoneAmountSum
    : Number(contract.current_amount ?? contract.contract_amount ?? 0);
  const collectedAmount = detail.milestones.reduce(
    (acc, m) => acc + Number(m.collected_amount ?? 0),
    0
  );
  const collectionRate = baseAmount > 0 ? Math.min(1, collectedAmount / baseAmount) : 0;
  const contractKindLabel = String(contract.contract_kind ?? "standard") === "unit_price" ? "단가 계약" : "일반 계약";
  const statusLabel = getContractStatusLabel(detail);
  const outsourcingCount = detail.outsourcing?.length ?? 0;
  const targetFacilities = detail.targetFacilities ?? [];
  const targetFacilityLabel = buildTargetFacilityLabel(contract.service_type);
  // 업체명·대상사업장 KPI에서 여는 사업장 정보 팝업. 대상은 계약상대 업체 또는 대상사업장 목록.
  const [facilityInfoModal, setFacilityInfoModal] = useState<{
    title: string;
    facilities: Array<{ facilityId: string; companyName: string }>;
  } | null>(null);

  // 공정표/수행인력 모달 + 수행 부서·인력 요약(KPI 표시용).
  const [staffingModalOpen, setStaffingModalOpen] = useState(false);
  const [participants, setParticipants] = useState<{ employeeName: string }[]>([]);
  const reloadParticipants = useCallback(() => {
    fetch(`/api/contracts/${String(contract.contract_id)}/participants`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setParticipants(d.participants ?? []))
      .catch(() => setParticipants([]));
  }, [contract.contract_id]);
  useEffect(() => {
    reloadParticipants();
  }, [reloadParticipants]);

  const owningDeptName = contract.owning_dept_name ? String(contract.owning_dept_name) : null;
  const staffSummary =
    participants.length === 0
      ? null
      : participants.slice(0, 2).map((p) => p.employeeName).join(", ") +
        (participants.length > 2 ? ` 외 ${participants.length - 2}명` : "");

  // 계산서 발행 후 아직 수금이 완료되지 않은 대금지급조건이 하나라도 있으면
  // 경과 기간 태그를 노출한다. 색상은 "가장 오래 경과한" 미수금 건 기준.
  const overdueTag = getOverdueCollectionTag(detail.milestones);

  // 완료일(발행일) = 최종 대금지급단위(stage_order 마지막)의 계산서 발행일
  const lastMilestone = detail.milestones[detail.milestones.length - 1];
  const completionInvoiceDate =
    lastMilestone && Number(lastMilestone.invoice_issued ?? 0) === 1 && lastMilestone.invoice_issued_at
      ? String(lastMilestone.invoice_issued_at).slice(0, 10)
      : null;
  // 허가 정보 섹션/완료일(허가일) KPI는 용역분류가 통합허가 계열일 때만 노출
  const isIntegratedPermit = String(contract.service_type ?? "").includes("통합");
  const permitIssuedAt = contract.permit_issued_at ? String(contract.permit_issued_at).slice(0, 10) : null;

  // Local copy of the milestone rows so drag reordering feels instant; it is
  // re-synced whenever the parent reloads the contract detail (which happens
  // after the reorder is persisted).
  const [orderedMilestones, setOrderedMilestones] = useState(detail.milestones);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    setOrderedMilestones(detail.milestones);
  }, [detail.milestones]);

  // 실적 정산은 최종 대금 지급 단계(준공금/잔금/준공 기성금)에만 적용된다.
  // 열 노출 여부와, 정산을 반영한 총 청구액(= 계약금액 - 차감액) 비율을 계산한다.
  const hasSettlementStage = orderedMilestones.some((m, idx) =>
    isSettlementStage(m.stage_label, idx, orderedMilestones.length)
  );
  const settlementDeduction = orderedMilestones.reduce((acc, m, idx) => {
    if (!isSettlementStage(m.stage_label, idx, orderedMilestones.length)) return acc;
    if (m.settlement_amount == null || m.settlement_amount === "") return acc;
    return acc + Math.max(0, Number(m.amount ?? 0) - Number(m.settlement_amount ?? 0));
  }, 0);
  const settlementRate =
    settlementDeduction > 0 && baseAmount > 0 ? (baseAmount - settlementDeduction) / baseAmount : null;

  const handleStageDrop = (dropIndex: number) => {
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null || from === dropIndex) return;
    const next = [...orderedMilestones];
    const [moved] = next.splice(from, 1);
    next.splice(dropIndex, 0, moved);
    setOrderedMilestones(next);
    onReorderStages(next.map((m) => String(m.milestone_id ?? "")));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-bold cd-text">{String(contract.contract_title ?? "")}</h2>
            {overdueTag && (
              <span
                className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold cd-text shadow-sm"
                style={{ backgroundColor: overdueTag.color }}
                title={overdueTag.tooltip}
              >
                {overdueTag.label}
              </span>
            )}
            {onBackToBilling && (
              <button
                type="button"
                onClick={onBackToBilling}
                className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold border cd-border-c cd-text-muted hover:bg-[color:var(--cd-surface)] inline-flex items-center gap-1 shadow-sm"
                title="수주 현황 화면으로 돌아갑니다"
              >
                <Undo2 className="w-3 h-3" />
                수주 현황으로 돌아가기
              </button>
            )}
          </div>
          <p className="text-sm cd-text-faint mt-2">
            {String(contract.counterparty_name ?? "")} · 업체ID {String(contract.legacy_company_id ?? "-")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs cd-text-muted flex items-center gap-1"
            onClick={() => {
              // Prefer the most recent contract/amendment PDF stored in
              // contract_documents; the legacy fallback to invoice[0] is kept
              // only for the very small number of imports that pre-date the
              // documents table.
              const docs = (detail.documents ?? []) as Array<{ document_type?: unknown; public_path?: unknown }>;
              const contractDoc =
                docs.find((d) => String(d.document_type ?? "") === "contract") ??
                docs.find((d) => String(d.document_type ?? "") === "amendment");
              const path =
                String(contractDoc?.public_path ?? "") ||
                String((detail.invoices?.[0] as { public_path?: unknown } | undefined)?.public_path ?? "");
              if (!path) {
                alert("등록된 계약서 PDF가 없습니다. 먼저 계약서 PDF를 업로드해 주세요.");
                return;
              }
              onOpenPdf({
                title: String(contract.contract_title ?? "계약서 PDF"),
                url: path,
              });
            }}
          >
            <span className="inline-flex items-center justify-center rounded-md bg-red-600 px-1.5 py-0.5 text-[9px] font-black tracking-tight text-white shadow-sm">
              PDF
            </span>
            계약서 보기
          </button>
          <button
            type="button"
            onClick={() => setStaffingModalOpen(true)}
            className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs cd-text-muted flex items-center gap-1"
          >
            <GitCommitHorizontal className="w-3.5 h-3.5" />
            공정표/수행인력
          </button>
          <button
            type="button"
            onClick={onOpenChange}
            className="rounded-xl px-3 py-2 text-xs text-white cd-fill-primary shadow-sm flex items-center gap-1"
          >
            <Pencil className="w-3.5 h-3.5" />
            변경계약 입력
          </button>
          <button
            type="button"
            onClick={onDeleteContract}
            className="rounded-xl px-3 py-2 text-xs text-white bg-rose-500 hover:bg-rose-600 shadow-sm flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            계약 삭제
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,4fr)_minmax(220px,1fr)] gap-3">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Info label="계약일" value={String(contract.contract_date ?? contract.started_at ?? "-")} />
          <Info
            label="계약금액"
            value={baseAmount ? formatExactAmount(baseAmount) : "-"}
            highlight
          />
          <Info
            label="업체명"
            value={
              contract.counterparty_facility_id ? (
                <button
                  type="button"
                  className="text-left underline decoration-dotted underline-offset-2 cd-text-primary hover:opacity-70"
                  onClick={() =>
                    setFacilityInfoModal({
                      title: String(contract.counterparty_name ?? "업체 정보"),
                      facilities: [
                        {
                          facilityId: String(contract.counterparty_facility_id),
                          companyName: String(contract.counterparty_name ?? ""),
                        },
                      ],
                    })
                  }
                  title="사업장 정보 보기"
                >
                  {String(contract.counterparty_name ?? "-")}
                </button>
              ) : (
                String(contract.counterparty_name ?? "-")
              )
            }
          />
          <Info label="계약 종류" value={contractKindLabel} />
          <Info label="용역분류" value={String(contract.service_type ?? "-")} />
          <Info label="용역세분류" value={String(contract.service_subtype ?? "-")} />
          <Info label="준공일" value={String(contract.ended_at ?? "-")} />
          <Info label="계약 상태" value={statusLabel} highlight={statusLabel !== "진행중"} />
          <Info label="업종" value={String(contract.industry_category ?? "-")} />
          <Info
            label={targetFacilityLabel}
            value={
              <span className="inline-flex items-center gap-1">
                {targetFacilities.length > 0 ? `${targetFacilities.length}개` : "-"}
                {targetFacilities.length > 0 && (
                  <button
                    type="button"
                    className="rounded-full p-0.5 cd-text-primary hover:bg-[color:var(--cd-primary-soft)]"
                    onClick={() =>
                      setFacilityInfoModal({
                        title: targetFacilityLabel,
                        facilities: targetFacilities.map((facility) => ({
                          facilityId: String(facility.facility_id),
                          companyName: String(facility.company_name ?? ""),
                        })),
                      })
                    }
                    aria-label={`${targetFacilityLabel} 정보 보기`}
                  >
                    <Search className="w-3.5 h-3.5" />
                  </button>
                )}
              </span>
            }
          />
          <Info label="대금 지급 방식" value={String(contract.payment_method ?? "-")} />
          <Info label="발주 주체 구분" value={getOrderingSubjectLabel(contract.ordering_subject_type)} />
          <Info label="외주 용역" value={outsourcingCount > 0 ? `${outsourcingCount}건 등록` : "없음"} />
          <Info label="완료일(발행일)" value={completionInvoiceDate ?? "-"} highlight={!!completionInvoiceDate} />
          <Info
            label="완료일(허가일)"
            value={isIntegratedPermit ? (permitIssuedAt ?? "-") : "-"}
            highlight={isIntegratedPermit && !!permitIssuedAt}
          />
          <Info
            label="수행 부서"
            highlight={!!contract.owning_dept_id}
            value={
              <span className="flex flex-col">
                <span>{owningDeptName ?? "미지정"}</span>
                {staffSummary && <span className="text-[11px] cd-text-faint font-normal">{staffSummary}</span>}
              </span>
            }
          />
        </div>
        <CollectionProgressCard
          rate={collectionRate}
          collectedAmount={collectedAmount}
          baseAmount={baseAmount}
          settlementRate={settlementRate}
        />
      </div>

      {facilityInfoModal && facilityInfoModal.facilities.length > 0 && (
        <FacilityInfoModal
          title={facilityInfoModal.title}
          facilities={facilityInfoModal.facilities}
          onClose={() => setFacilityInfoModal(null)}
        />
      )}

      {staffingModalOpen && (
        <ContractStaffingModal
          contractId={String(contract.contract_id)}
          serviceType={String(contract.service_type ?? "")}
          currentDeptId={String(contract.owning_dept_id ?? "")}
          onClose={() => {
            setStaffingModalOpen(false);
            onReloadDetail();
            reloadParticipants();
          }}
          onSaved={() => {
            onReloadDetail();
            reloadParticipants();
          }}
        />
      )}

      {outsourcingCount > 0 && (
        <div className="rounded-2xl border cd-border-c cd-surface-bg p-4">
          <h3 className="font-bold cd-text mb-3">외주 용역</h3>
          <div className="grid gap-2">
            {detail.outsourcing.map((item) => (
              <div key={String(item.outsourcing_id)} className="rounded-xl border cd-border-c cd-surface-bg px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="cd-text">{String(item.outsourcing_title ?? "-")}</span>
                  <span className="font-mono text-xs cd-text-faint">
                    {item.amount ? formatExactAmount(item.amount) : ""}
                  </span>
                </div>
                <p className="text-xs cd-text-faint mt-1">
                  {String(item.counterparty_facility_name ?? item.counterparty_name ?? "-")}
                  {item.contract_date ? ` · 계약일 ${String(item.contract_date)}` : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-baseline gap-2">
            <h3 className="font-bold cd-text">청구·수금 단계</h3>
            <span className="text-[11px] cd-text-faint">행을 드래그해 순서 변경</span>
          </div>
          <button
            type="button"
            onClick={onOpenNewStage}
            className="rounded-lg px-3 py-1.5 text-xs text-white cd-fill-primary shadow-sm flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            단계 추가
          </button>
        </div>
        <div className="overflow-hidden rounded-2xl border cd-border-c">
          <table className="w-full text-xs">
            <thead className="cd-surface-bg cd-text-muted text-[11px]">
              <tr>
                <th className="text-left p-2.5">차수</th>
                <th className="text-left p-2.5">단계명</th>
                <th className="text-right p-2.5">청구금액</th>
                {hasSettlementStage && <th className="text-right p-2.5">실적 정산</th>}
                {hasSettlementStage && <th className="text-right p-2.5">차감액</th>}
                <th className="text-left p-2.5">대금 지급 조건</th>
                <th className="text-center p-2.5">발행일</th>
                <th className="text-center p-2.5">수금일</th>
                <th className="text-right p-2.5">수금비율</th>
                <th className="text-right p-2.5">수금금액</th>
                <th className="text-right p-2.5">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--cd-border)]">
              {orderedMilestones.map((milestone, idx) => {
                const milestoneId = String(milestone.milestone_id ?? "");
                const stageAmount = Number(milestone.amount ?? 0);
                const settlementEligible = isSettlementStage(milestone.stage_label, idx, orderedMilestones.length);
                const hasSettlement =
                  settlementEligible && milestone.settlement_amount != null && milestone.settlement_amount !== "";
                const settlementAmount = hasSettlement ? Number(milestone.settlement_amount ?? 0) : 0;
                const deductionAmount = hasSettlement ? Math.max(0, stageAmount - settlementAmount) : 0;
                const collectionRatio = Number(milestone.collection_ratio ?? 0);
                const ratioLabel = collectionRatio > 0
                  ? `${Math.round(collectionRatio * 1000) / 10}%`
                  : Number(milestone.payment_collected ?? 0) === 1 ? "100%" : "-";
                const isDragging = dragIndex === idx;
                const isDropTarget = overIndex === idx && dragIndex !== null && dragIndex !== idx;
                return (
                  <tr
                    key={milestoneId}
                    draggable
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (overIndex !== idx) setOverIndex(idx);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleStageDrop(idx);
                    }}
                    className={
                      "transition-colors " +
                      (isDragging ? "opacity-50 " : "") +
                      (isDropTarget ? "cd-tint-primary " : "")
                    }
                  >
                    <td className="p-2.5 font-mono cd-text-muted">
                      <span className="flex items-center gap-1.5" title="드래그하여 순서 변경">
                        <GripVertical className="w-3.5 h-3.5 cd-text-faint cursor-grab active:cursor-grabbing" />
                        {idx + 1}
                      </span>
                    </td>
                    <td className="p-2.5 cd-text">{String(milestone.stage_label ?? "")}</td>
                    <td className="p-2.5 text-right font-mono tabular-nums">{formatExactAmount(stageAmount)}</td>
                    {hasSettlementStage && (
                      <td className="p-2.5 text-right font-mono tabular-nums">
                        {hasSettlement ? formatExactAmount(settlementAmount) : "-"}
                      </td>
                    )}
                    {hasSettlementStage && (
                      <td className="p-2.5 text-right font-mono tabular-nums">
                        {hasSettlement ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-rose-600">{formatExactAmount(deductionAmount)}</span>
                            <span className="rounded-md border cd-border-c px-1 py-0.5 text-[10px] cd-text-faint">
                              {stageAmount > 0 ? `${Math.round((deductionAmount / stageAmount) * 1000) / 10}%` : "-"}
                            </span>
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                    )}
                    <td className="p-2.5 cd-text-muted max-w-[220px] truncate" title={String(milestone.payment_terms ?? "")}>
                      {String(milestone.payment_terms ?? "-") || "-"}
                    </td>
                    <td className="p-2.5 text-center cd-text-muted">{String(milestone.invoice_issued_at ?? "-") || "-"}</td>
                    <td className="p-2.5 text-center cd-text-muted">{String(milestone.payment_collected_at ?? "-") || "-"}</td>
                    <td className="p-2.5 text-right font-mono">{ratioLabel}</td>
                    <td className="p-2.5 text-right font-mono tabular-nums">{formatExactAmount(milestone.collected_amount)}</td>
                    <td className="p-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1 text-[11px] text-white cd-fill-primary shadow-sm inline-flex items-center gap-1"
                          onClick={() =>
                            onOpenInvoice({
                              milestoneId,
                              stageLabel: String(milestone.stage_label ?? ""),
                              baseAmount: stageAmount,
                              issueDate: String(milestone.invoice_issued_at ?? new Date().toISOString().slice(0, 10)),
                              invoiceAmount: String(milestone.invoice_amount ?? milestone.amount ?? ""),
                              paymentCollected: Number(milestone.payment_collected ?? 0) === 1,
                              paymentCollectedAt: String(milestone.payment_collected_at ?? ""),
                              collectionRatio: String(milestone.collection_ratio ?? "1"),
                              collectedAmount: String(milestone.collected_amount ?? milestone.amount ?? ""),
                              paymentTerms: String(milestone.payment_terms ?? ""),
                              partialPaymentMemo: "",
                              memo: "",
                              settlementAmount: String(milestone.settlement_amount ?? ""),
                              settlementEligible,
                            })
                          }
                        >
                          <Paperclip className="w-3 h-3" />
                          발행/수금
                        </button>
                        {/* 전자발행(P4) — 바로빌로 실제 계산서를 끊는다. 수기 기록은 왼쪽 발행/수금 그대로.
                            노란색 강조(2026-08-24 사용자 요청 — 무채색 아웃라인이라 눈에 안 띄던 문제) */}
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1 text-[11px] border border-amber-400 bg-amber-400 text-amber-950 font-semibold shadow-sm hover:bg-amber-300 inline-flex items-center gap-1"
                          onClick={() => onOpenTaxInvoice(milestoneId)}
                          title="전자세금계산서 발행(바로빌)"
                        >
                          <FileText className="w-3 h-3" />
                          전자발행
                        </button>
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1 text-[11px] border cd-border-c cd-text-muted hover:bg-[color:var(--cd-surface)]"
                          onClick={() =>
                            onOpenEditStage({
                              milestoneId,
                              stageLabel: String(milestone.stage_label ?? ""),
                              baseAmount: stageAmount,
                              amount: String(milestone.amount ?? ""),
                              paymentTerms: String(milestone.payment_terms ?? ""),
                              issueDate: String(milestone.invoice_issued_at ?? ""),
                              invoiceAmount: String(milestone.invoice_amount ?? milestone.amount ?? ""),
                              paymentCollected: Number(milestone.payment_collected ?? 0) === 1,
                              paymentCollectedAt: String(milestone.payment_collected_at ?? ""),
                              collectedAmount: String(milestone.collected_amount ?? ""),
                              collectionRatio: String(milestone.collection_ratio ?? ""),
                              partialPaymentMemo: firstPartialPaymentMemo(milestone.partial_payments_json),
                            })
                          }
                          title="단계 수정"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-1 text-[11px] text-rose-600 hover:bg-rose-50"
                          onClick={() => onDeleteStage(milestoneId)}
                          title="단계 삭제"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {orderedMilestones.length === 0 && (
                <tr>
                  <td className="p-6 text-center cd-text-faint" colSpan={9}>
                    등록된 청구 단계가 없습니다. 우상단의 `단계 추가` 버튼으로 추가하세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isIntegratedPermit && (
        <PermitInfoSection
          contractId={String(contract.contract_id ?? "")}
          serviceSubtype={String(contract.service_subtype ?? "")}
          permitIssuedAt={permitIssuedAt ?? ""}
          permitNo={contract.permit_no != null ? String(contract.permit_no) : ""}
          permitNote={contract.permit_note != null ? String(contract.permit_note) : ""}
          onSaved={onReloadDetail}
        />
      )}

      <div>
        <h3 className="font-bold cd-text mb-3">세금계산서 파일</h3>
        <div className="grid gap-2">
          {detail.invoices.map((invoice) => {
            const title = String(invoice.document_display_name ?? invoice.invoice_id);
            const url = String(invoice.public_path ?? "");
            return (
            <button
              key={String(invoice.invoice_id)}
              type="button"
              disabled={!url}
              onClick={() => url && onOpenPdf({ title, url })}
              className="rounded-xl border cd-border-c cd-surface-bg px-3 py-2 text-sm hover:bg-[color:var(--cd-surface)] flex items-center justify-between gap-3"
            >
              <span>{title}</span>
              <span className="text-xs cd-text-faint">{String(invoice.issue_date ?? "")}</span>
            </button>
          );
          })}
          {detail.invoices.length === 0 && <p className="text-sm cd-text-faint">등록된 세금계산서 PDF가 없습니다.</p>}
        </div>
      </div>
    </div>
  );
}

/** 허가번호 입력이 가능한 용역세분류 */
const PERMIT_NO_SUBTYPES = new Set(["최초허가", "변경허가", "재검토"]);

/**
 * 허가 정보 — 용역분류가 통합허가 계열인 계약에서만 표시.
 * 해당 계약 건으로 진행된 허가 완료 내역(허가일/허가번호/비고)을 입력한다.
 * 허가일은 완료 현황 탭의 완료일(허가일)과 계약 상세 KPI에 사용된다.
 */
function PermitInfoSection({
  contractId,
  serviceSubtype,
  permitIssuedAt,
  permitNo,
  permitNote,
  onSaved,
}: {
  contractId: string;
  serviceSubtype: string;
  permitIssuedAt: string;
  permitNo: string;
  permitNote: string;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [issuedAt, setIssuedAt] = useState(permitIssuedAt);
  const [no, setNo] = useState(permitNo);
  const [note, setNote] = useState(permitNote);
  const [saving, setSaving] = useState(false);
  // 검토결과서 업로드(2026-08-24) — S3 저장 + Claude 파싱으로 허가번호·허가일·종규모·생산품을
  // 계약(여기)과 대상사업장 허가 정보에 자동 기입한다.
  const [uploading, setUploading] = useState(false);
  const reviewFileRef = useRef<HTMLInputElement | null>(null);

  const uploadReview = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/permit-review`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        parsed?: { permitNo?: string; permitDate?: string; products?: unknown[] } | null;
        facilityApplied?: boolean;
        facilityVia?: "target" | "counterparty" | null;
        facilityName?: string;
        skippedReason?: string;
      };
      if (!res.ok) throw new Error(data?.error ?? "HTTP " + res.status);
      if (!data.parsed) {
        toast.show("검토결과서를 저장했습니다. 자동 인식에 실패해 허가 정보는 직접 입력해 주세요.", "error");
        return;
      }
      if (data.parsed.permitDate) setIssuedAt(data.parsed.permitDate);
      if (data.parsed.permitNo) setNo(data.parsed.permitNo);
      const facilityMsg = data.facilityApplied
        ? data.facilityVia === "counterparty"
          ? ` 대상사업장 연결이 없어 발주처 사업장(${data.facilityName || "발주처"})의 허가 정보에 반영했습니다.`
          : ` 사업장(${data.facilityName || "대상사업장"}) 허가 정보에도 반영했습니다.`
        : data.skippedReason === "no-facility"
          ? " (대상사업장·발주처 사업장이 없어 사업장 반영은 생략)"
          : data.skippedReason === "no-permit-no"
            ? " (허가번호 인식 실패로 사업장 반영은 생략)"
            : "";
      toast.show(`검토결과서를 저장하고 허가 정보를 자동 기입했습니다.${facilityMsg}`, "success");
      onSaved();
    } catch (err) {
      toast.show("검토결과서 업로드 실패: " + (err as Error).message, "error");
    } finally {
      setUploading(false);
      if (reviewFileRef.current) reviewFileRef.current.value = "";
    }
  };

  // 다른 계약 선택/저장 후 재조회 시 폼을 서버 값으로 동기화
  useEffect(() => {
    setIssuedAt(permitIssuedAt);
    setNo(permitNo);
    setNote(permitNote);
  }, [contractId, permitIssuedAt, permitNo, permitNote]);

  const permitNoEnabled = PERMIT_NO_SUBTYPES.has(serviceSubtype.trim());
  const dirty = issuedAt !== permitIssuedAt || no !== permitNo || note !== permitNote;

  const save = async () => {
    if (saving || !dirty) return;
    if (issuedAt && !/^\d{4}-\d{2}-\d{2}$/.test(issuedAt)) {
      toast.show("허가일은 8자리(YYYYMMDD)로 입력해 주세요.", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permitIssuedAt: issuedAt || null,
          permitNo: no.trim() || null,
          permitNote: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      toast.show("허가 정보를 저장했습니다.", "success");
      onSaved();
    } catch (err) {
      toast.show("저장 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border cd-border-c p-4">
      <div className="flex items-baseline gap-2 mb-3">
        <h3 className="font-bold cd-text">허가 정보</h3>
        <span className="text-[11px] cd-text-faint">해당 계약 건으로 진행된 허가 완료 내역</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[220px_220px_minmax(0,1fr)_auto_auto] gap-3 items-end">
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">허가일</span>
          <DateInput value={issuedAt} onChange={setIssuedAt} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">허가번호</span>
          <input
            type="text"
            className="cd-input disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder={permitNoEnabled ? "허가번호 입력" : "최초허가·변경허가·재검토만 입력"}
            value={no}
            disabled={!permitNoEnabled}
            onChange={(e) => setNo(e.target.value)}
            title={permitNoEnabled ? undefined : "용역세분류가 최초허가, 변경허가, 재검토인 경우에만 입력할 수 있습니다."}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">비고</span>
          <input
            type="text"
            className="cd-input"
            placeholder="비고 입력"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-xl px-4 py-2 text-xs text-white cd-fill-primary shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
        <button
          type="button"
          onClick={() => reviewFileRef.current?.click()}
          disabled={uploading}
          className="rounded-xl border cd-border-c px-4 py-2 text-xs cd-text-muted hover:cd-soft-primary disabled:opacity-50 inline-flex items-center gap-1.5 whitespace-nowrap"
          title="허가 검토결과서 PDF 를 업로드하면 허가번호·허가일·종규모·생산품을 자동 인식해 계약·사업장 허가 정보에 기입합니다"
        >
          <Paperclip className="w-3.5 h-3.5" />
          {uploading ? "분석 중…" : "검토결과서 업로드"}
        </button>
        <input
          ref={reviewFileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadReview(f);
          }}
        />
      </div>
    </div>
  );
}

function InvoiceUploadModal({
  contractId,
  state,
  onChange,
  onClose,
  onSaved,
}: {
  contractId: string;
  state: InvoiceModalState;
  onChange: (state: InvoiceModalState) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState("");

  const submit = async () => {
    const selectedFile = fileRef.current;
    if (!selectedFile && !state.paymentCollected) {
      toast.show("계산서를 첨부해 주세요.", "error");
      return;
    }
    setSaving(true);
    try {
      if (!selectedFile && state.paymentCollected) {
        const res = await fetch(
          `/api/contracts/${encodeURIComponent(contractId)}/milestones/${encodeURIComponent(state.milestoneId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              invoiceIssued: Boolean(state.issueDate || state.invoiceAmount),
              invoiceIssuedAt: state.issueDate || null,
              invoiceAmount: state.invoiceAmount || null,
              paymentCollected: true,
              paymentCollectedAt: state.paymentCollectedAt || null,
              collectionRatio: state.collectionRatio || null,
              collectedAmount: state.collectedAmount || null,
              paymentTerms: state.paymentTerms || null,
              partialPaymentMemo: state.partialPaymentMemo || "",
              ...(state.settlementEligible ? { settlementAmount: state.settlementAmount || null } : {}),
            }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? "HTTP " + res.status);
        }
        toast.show("수금 정보를 등록했습니다.", "success");
        onSaved();
        return;
      }

      if (!selectedFile) {
        throw new Error("세금계산서 PDF 파일을 선택해 주세요.");
      }

      const form = new FormData();
      form.set("milestoneId", state.milestoneId);
      form.set("issueDate", state.issueDate);
      form.set("invoiceAmount", state.invoiceAmount);
      form.set("paymentCollected", state.paymentCollected ? "1" : "0");
      form.set("paymentCollectedAt", state.paymentCollectedAt);
      form.set("collectionRatio", state.collectionRatio);
      form.set("collectedAmount", state.collectedAmount);
      form.set("paymentTerms", state.paymentTerms);
      form.set("partialPaymentMemo", state.partialPaymentMemo);
      form.set("memo", state.memo);
      if (state.settlementEligible) form.set("settlementAmount", state.settlementAmount);
      form.set("file", selectedFile);
      const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/invoices`, { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      toast.show("세금계산서 정보를 등록했습니다.", "success");
      onSaved();
    } catch (err) {
      toast.show("등록 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`${state.stageLabel} 발행/수금 정보 입력`} onClose={onClose}>
      <div className="p-5 grid gap-3 grid-cols-2">
        <label className="grid gap-1 text-sm col-span-2">
          <span className="font-bold cd-text-muted">계산서 발행일</span>
          <DateInput value={state.issueDate} onChange={(issueDate) => onChange({ ...state, issueDate })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">발행금액</span>
          <input
            type="text"
            inputMode="numeric"
            className="cd-input tabular-nums"
            value={formatThousands(state.invoiceAmount)}
            onChange={(e) => onChange({ ...state, invoiceAmount: stripDigits(e.target.value) })}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">대금 지급 조건</span>
          <input type="text" className="cd-input" placeholder="예: 세금계산서 발행 후 30일 이내 지급"
            value={state.paymentTerms} onChange={(e) => onChange({ ...state, paymentTerms: e.target.value })} />
        </label>
        {state.settlementEligible && (
          <>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">실적 정산</span>
              <input
                type="text"
                inputMode="numeric"
                className="cd-input tabular-nums"
                placeholder="정산 반영 실제 청구액"
                value={formatThousands(state.settlementAmount)}
                onChange={(e) => {
                  // 실적 정산액(= 정산 반영 실제 청구액)을 입력하면 발행금액과 수금금액을 함께 맞춘다.
                  // 실제로 받는 돈이 정산액이므로 수금금액이 원 청구액으로 남으면 수금 합계·자동대조가 어긋난다.
                  // 차감액은 (단계 원 금액 - 실적 정산액)으로 자동 산출되어 옆 칸에 표시된다.
                  const digits = stripDigits(e.target.value);
                  onChange({
                    ...state,
                    settlementAmount: digits,
                    invoiceAmount: digits || state.invoiceAmount,
                    collectedAmount: digits || state.collectedAmount,
                  });
                }}
              />
              <span className="text-[11px] cd-text-faint">
                출장 경비·인쇄비 등 정산 반영 실제 청구액 (원 금액 {formatExactAmount(state.baseAmount)})
              </span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">차감액</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  className="cd-input tabular-nums flex-1"
                  value={
                    state.settlementAmount
                      ? formatThousands(String(Math.max(0, state.baseAmount - Number(state.settlementAmount || "0"))))
                      : ""
                  }
                />
                <span className="shrink-0 rounded-lg border cd-border-c px-2 py-2 text-[11px] font-bold cd-text-muted tabular-nums">
                  {state.settlementAmount && state.baseAmount > 0
                    ? `${Math.round((Math.max(0, state.baseAmount - Number(state.settlementAmount || "0")) / state.baseAmount) * 1000) / 10}%`
                    : "-"}
                </span>
              </div>
              <span className="text-[11px] cd-text-faint">단계 원 금액 대비 차감 비율</span>
            </label>
          </>
        )}
        <div className="grid gap-1 text-sm col-span-2">
          <span className="font-bold cd-text-muted">계산서 PDF 첨부</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const nextFile = e.target.files?.[0] ?? null;
              fileRef.current = nextFile;
              setFileName(nextFile?.name ?? "");
            }}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg cd-fill-primary px-3 py-2 text-xs font-bold text-white shadow-sm"
            >
              파일 선택
            </button>
            <span className="text-xs cd-text-faint">{fileName ? `선택됨: ${fileName}` : "선택된 파일 없음"}</span>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-bold cd-text-muted col-span-2">
          <input type="checkbox" checked={state.paymentCollected} onChange={(e) => onChange({ ...state, paymentCollected: e.target.checked })} />
          수금 정보 등록
        </label>
        {state.paymentCollected && (
          <>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">수금일</span>
              <DateInput value={state.paymentCollectedAt} onChange={(paymentCollectedAt) => onChange({ ...state, paymentCollectedAt })} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">수금금액</span>
              <input
                type="text"
                inputMode="numeric"
                className="cd-input tabular-nums"
                value={formatThousands(state.collectedAmount)}
                onChange={(e) => {
                  const digits = stripDigits(e.target.value);
                  // 발행금액 대비 자동 산출. 수금비율 입력란을 따로 두지 않고
                  // 수금금액으로부터 0~1 사이로 클램프된 값을 저장한다.
                  const collected = Number(digits || "0");
                  const ratio = state.baseAmount > 0
                    ? Math.min(1, Math.max(0, Math.round((collected / state.baseAmount) * 10000) / 10000))
                    : 0;
                  onChange({ ...state, collectedAmount: digits, collectionRatio: String(ratio) });
                }}
              />
            </label>
            <label className="grid gap-1 text-sm col-span-2">
              <span className="font-bold cd-text-muted">부분입금 사유</span>
              <textarea
                className="cd-input min-h-[84px]"
                placeholder="예: 업체 자금 사정으로 일부만 입금, 착오입금 후 잔액 추후 입금 예정 등"
                value={state.partialPaymentMemo}
                onChange={(e) => onChange({ ...state, partialPaymentMemo: e.target.value })}
              />
            </label>
          </>
        )}
        <p className="text-xs cd-text-faint col-span-2">
          저장 경로는 발행일 기준 <code>매출계산서/년도/분기</code> 논리 경로로 생성됩니다.
        </p>
      </div>
      <div className="p-5 pt-0 border-t cd-border-c flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-xl px-4 py-2 text-sm font-bold cd-text-muted">닫기</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-bold text-white cd-fill-primary shadow-sm disabled:opacity-60">
          {saving ? "저장 중..." : "입력"}
        </button>
      </div>
    </ModalShell>
  );
}

function NewContractModal({
  state,
  onChange,
  onClose,
  onSaved,
}: {
  state: NewContractModalState;
  onChange: (state: NewContractModalState) => void;
  onClose: () => void;
  onSaved: (contractId: string) => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"basic" | "ratecard" | "milestones" | "outsourcing" | "document">("basic");
  const [entityOptions, setEntityOptions] = useState<FacilitySearchItem[]>([]);
  const [facilityOptions, setFacilityOptions] = useState<FacilitySearchItem[]>([]);
  const [outsourcingEntityOptions, setOutsourcingEntityOptions] = useState<FacilitySearchItem[]>([]);
  const [outsourcingTypeOptions, setOutsourcingTypeOptions] = useState(DEFAULT_OUTSOURCING_TYPES);
  const { industryOptions, setIndustryOptions } = useContractIndustryOptions();
  const documentFileRef = useRef<File | null>(null);
  const [documentFileName, setDocumentFileName] = useState("");
  const outsourcingFileRef = useRef<File | null>(null);
  const [outsourcingFileName, setOutsourcingFileName] = useState("");
  const subtypeOptions = useMemo(
    () => CONTRACT_SERVICE_OPTIONS.find((item) => item.type === state.serviceType)?.subtypes ?? [],
    [state.serviceType]
  );

  useEffect(() => {
    const q = state.counterpartyQuery.trim();
    if (q.length < 2) {
      setEntityOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "20", sort: "name" });
        const res = await fetch(`/api/facilities?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: FacilitySearchItem[] };
        setEntityOptions(json.items ?? []);
      } catch {
        if (!controller.signal.aborted) setEntityOptions([]);
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state.counterpartyQuery]);

  useEffect(() => {
    const q = state.facilityQuery.trim();
    if (q.length < 2) {
      setFacilityOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q,
          limit: "10",
          sort: "name",
        });
        const res = await fetch(`/api/facilities?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: FacilitySearchItem[] };
        setFacilityOptions(json.items ?? []);
      } catch {
        if (!controller.signal.aborted) setFacilityOptions([]);
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state.facilityQuery]);

  useEffect(() => {
    const q = state.outsourcing.counterpartyQuery.trim();
    if (q.length < 2) {
      setOutsourcingEntityOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "20", sort: "name" });
        const res = await fetch(`/api/facilities?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: FacilitySearchItem[] };
        setOutsourcingEntityOptions(json.items ?? []);
      } catch {
        if (!controller.signal.aborted) setOutsourcingEntityOptions([]);
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state.outsourcing.counterpartyQuery]);

  const updateMilestone = (id: string, patch: Partial<ContractMilestoneDraft>) => {
    onChange({
      ...state,
      milestones: state.milestones.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  };

  // 계약금액 = 청구·수금 단계 금액 합계(2026-08-24 사용자 확정 — 이중 입력 제거).
  // basic 탭의 계약금액 란은 읽기 전용 표시이며, 저장도 이 합계를 쓴다.
  const milestoneSum = useMemo(
    () => state.milestones.reduce((acc, m) => acc + (Number(m.amount) || 0), 0),
    [state.milestones]
  );

  // 단가 계약 — 단계명 옵션: 차수 미사용이면 구분 소계, 차수 사용이면 차수별 선급금/준공금(2026-08-25).
  const rateStageOptions = useMemo(() => rateCardStageOptions(state.rateCard), [state.rateCard]);

  const [checkingTitle, setCheckingTitle] = useState(false);
  /**
   * 계약명 중복확인(2026-08-24) — 중복이면 규칙대로 자동 수정한다.
   * ① 연도 표기 없음 → "계약명 (YYYY년)" ② "(YYYY년)"/"(YYYY년 N차)" → 차수를 올린다.
   * 수정 후보가 또 중복이면 차수를 계속 올려 재확인한다(최대 30회).
   */
  const checkTitle = async () => {
    const base = state.contractTitle.trim();
    if (!base) {
      toast.show("계약명을 먼저 입력하세요.", "error");
      return;
    }
    setCheckingTitle(true);
    try {
      const isDup = async (t: string): Promise<boolean> => {
        const res = await fetch(`/api/contracts/check-title?title=${encodeURIComponent(t)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        return Boolean(((await res.json()) as { duplicate?: boolean }).duplicate);
      };
      if (!(await isDup(base))) {
        toast.show("사용 가능한 계약명입니다.", "success");
        return;
      }
      const fallbackYear = (state.contractDate || "").slice(0, 4) || String(new Date().getFullYear());
      const m = base.match(/^(.*?)\s*\((\d{4})년(?:\s*(\d+)차)?\)$/);
      const stem = m ? m[1].trim() : base;
      const year = m ? m[2] : fallbackYear;
      let nth = m ? (m[3] ? Number(m[3]) + 1 : 2) : 1;
      let candidate = base;
      for (let i = 0; i < 30; i++) {
        candidate = nth <= 1 ? `${stem} (${year}년)` : `${stem} (${year}년 ${nth}차)`;
        if (!(await isDup(candidate))) break;
        nth += 1;
      }
      onChange({ ...state, contractTitle: candidate });
      toast.show(`동일한 계약명이 있어 '${candidate}' 로 수정했습니다.`, "success");
    } catch (err) {
      toast.show("중복 확인 실패: " + (err as Error).message, "error");
    } finally {
      setCheckingTitle(false);
    }
  };

  // 발주 주체 = 대상사업장 본인: 계약상대 업체의 사업자등록번호와 일치하는
  // 사업장을 자동으로 찾아 대상사업장으로 채운다. 매칭 실패 시 경고만 표시한다.
  useEffect(() => {
    if (state.orderingSubjectType !== ORDERING_SUBJECT_SITE_DIRECT) return;
    const brn = (state.counterpartyBusinessRegistrationNo ?? "").replace(/[^0-9]/g, "");
    if (!state.counterpartyFacilityId || !brn) {
      if (state.selectedFacilities.length > 0) onChange({ ...state, selectedFacilities: [] });
      return;
    }
    const alreadyMatched =
      state.selectedFacilities.length === 1 &&
      (state.selectedFacilities[0].businessRegistrationNo ?? "").replace(/[^0-9]/g, "") === brn;
    if (alreadyMatched) return;
    const controller = new AbortController();
    (async () => {
      try {
        const match = await findFacilityByBusinessRegistrationNo(
          state.counterpartyBusinessRegistrationNo,
          controller.signal,
          { facilityId: state.counterpartyFacilityId, companyName: state.counterpartyName }
        );
        if (match) {
          onChange({ ...state, selectedFacilities: [match], facilityQuery: "" });
        } else {
          onChange({ ...state, selectedFacilities: [] });
          toast.show("계약상대 업체와 일치하는 사업장을 찾지 못했습니다. 대상사업장을 직접 확인하세요.", "error");
        }
      } catch {
        if (!controller.signal.aborted) {
          /* 네트워크 오류는 조용히 무시하고 다음 변경 시 재시도 */
        }
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.orderingSubjectType, state.counterpartyFacilityId, state.counterpartyBusinessRegistrationNo]);

  // 발주 주체 구분에 따른 대상사업장 추가. 소속 법인·모회사 / 위탁운영사는
  // 사업장 상세 정보를 받아 관계를 검증한 뒤에만 추가한다.
  const addTargetFacility = async (facility: FacilitySearchItem) => {
    if (
      state.orderingSubjectType === ORDERING_SUBJECT_PARENT_CORP ||
      state.orderingSubjectType === ORDERING_SUBJECT_CONSIGNED_OPERATOR
    ) {
      try {
        const res = await fetch(`/api/facilities/${encodeURIComponent(facility.facilityId)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const facilityDetail = await res.json();
        const result = validateOrderingTargetFacility(
          state.orderingSubjectType,
          facilityDetail,
          state.counterpartyBusinessRegistrationNo
        );
        if (!result.ok) {
          toast.show(result.message ?? "대상사업장 검증에 실패했습니다.", "error");
          return;
        }
      } catch (err) {
        toast.show("대상사업장 검증 실패: " + (err as Error).message, "error");
        return;
      }
    }
    onChange({
      ...state,
      facilityQuery: "",
      selectedFacilities: [...state.selectedFacilities, facility],
    });
  };

  const submit = async () => {
    if (!state.contractTitle.trim()) {
      toast.show("계약명을 입력하세요.", "error");
      setTab("basic");
      return;
    }
    if (!state.counterpartyFacilityId) {
      toast.show("계약상대 업체를 선택하세요.", "error");
      setTab("basic");
      return;
    }
    if (!state.contractDate) {
      toast.show("계약일을 입력하세요.", "error");
      setTab("basic");
      return;
    }
    let selectedFacilities = state.selectedFacilities;
    if (state.orderingSubjectType === ORDERING_SUBJECT_SITE_DIRECT && selectedFacilities.length === 0) {
      const match = await findFacilityByBusinessRegistrationNo(state.counterpartyBusinessRegistrationNo, undefined, {
        facilityId: state.counterpartyFacilityId,
        companyName: state.counterpartyName,
      });
      if (!match) {
        toast.show("계약상대 업체와 일치하는 사업장을 찾지 못했습니다. 사업장 마스터의 사업자번호를 확인하세요.", "error");
        setTab("basic");
        return;
      }
      selectedFacilities = [match];
      onChange({ ...state, selectedFacilities, facilityQuery: "" });
    }
    const validMilestones = state.milestones.filter((m) => m.stageLabel.trim());
    setSaving(true);
    try {
      const createRes = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractTitle: state.contractTitle,
          counterpartyFacilityId: state.counterpartyFacilityId,
          serviceType: state.serviceType || null,
          serviceSubtype: state.serviceSubtype || null,
          contractKind: state.contractKind,
          industryCategory: state.industryCategory || null,
          paymentMethod: state.paymentMethod || null,
          orderingSubjectType: state.orderingSubjectType || null,
          facilityIds: selectedFacilities.map((facility) => facility.facilityId),
          contractDate: state.contractDate,
          startedAt: state.startedAt || state.contractDate,
          endedAt: state.endedAt || null,
          // 계약금액 = 청구·수금 단계 합계(이중 입력 제거, 2026-08-24)
          contractAmount: milestoneSum > 0 ? milestoneSum : null,
          originalAmount: milestoneSum > 0 ? milestoneSum : null,
          currentAmount: milestoneSum > 0 ? milestoneSum : null,
          memo: state.memo || null,
        }),
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + createRes.status);
      }
      const { contractId } = (await createRes.json()) as { contractId: string };

      // 단가 계약 — 단가 기준표 저장(청구·수금 단계보다 먼저, 단계명이 구분명을 참조하므로).
      if (state.contractKind === "unit_price" && rateCardHasContent(state.rateCard)) {
        const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/rate-card`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ card: state.rateCard }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? "단가 기준표 저장 실패");
        }
      }

      for (let i = 0; i < validMilestones.length; i++) {
        const m = validMilestones[i];
        const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/milestones`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stageLabel: m.stageLabel,
            stageOrder: i + 1,
            amount: m.amount ? Number(m.amount) : null,
            paymentTerms: m.paymentTerms || null,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? "단계 저장 실패");
        }
      }

      const documentFile = documentFileRef.current;
      if (documentFile) {
        const form = new FormData();
        form.set("documentType", "contract");
        form.set("documentDate", state.contractDate);
        form.set("file", documentFile);
        const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/documents`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? "계약서 업로드 실패");
        }
      }

      if (state.outsourcing.outsourcingTitle.trim()) {
        const outsourcingForm = new FormData();
        outsourcingForm.set("outsourcingTitle", state.outsourcing.outsourcingTitle);
        outsourcingForm.set("counterpartyFacilityId", state.outsourcing.counterpartyFacilityId);
        outsourcingForm.set("counterpartyName", state.outsourcing.counterpartyName || state.outsourcing.counterpartyQuery);
        outsourcingForm.set("serviceType", state.outsourcing.serviceType);
        outsourcingForm.set("contractDate", state.outsourcing.contractDate);
        outsourcingForm.set("endedAt", state.outsourcing.endedAt);
        outsourcingForm.set("amount", state.outsourcing.amount);
        outsourcingForm.set("memo", state.outsourcing.memo);
        const outsourcingFile = outsourcingFileRef.current;
        if (outsourcingFile) outsourcingForm.set("file", outsourcingFile);
        const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/outsourcing`, {
          method: "POST",
          body: outsourcingForm,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? "외주 용역 저장 실패");
        }
      }

      toast.show("신규 계약이 등록되었습니다.", "success");
      onSaved(contractId);
    } catch (err) {
      toast.show("등록 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="신규 계약 입력" onClose={onClose} wide>
      <div className="border-b cd-border-c px-5 pt-4 flex gap-2">
        {([
          ["basic", "계약 상세정보"],
          // 단가 계약일 때만 단가 기준표 탭 노출(청구·수금 단계가 구분명을 참조하므로 그 앞에 둔다)
          ...(state.contractKind === "unit_price" ? ([["ratecard", "단가 계약"]] as const) : []),
          ["milestones", "청구·수금 단계"],
          ["outsourcing", "외주 용역"],
          ["document", "계약서 PDF"],
        ] as ReadonlyArray<readonly [string, string]>).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key as typeof tab)}
            className={
              "rounded-t-xl px-3 py-2 text-xs border border-b-0 " +
              (tab === key ? "cd-card-bg cd-text-primary border-[color:var(--cd-primary)]" : "cd-surface-bg cd-text-faint cd-border-c")
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className="p-5 min-h-[520px]">
        {tab === "basic" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm col-span-2">
              <span className="font-bold cd-text-muted">계약명</span>
              <div className="flex items-center gap-2">
                <input className="cd-input min-w-0 flex-1" value={state.contractTitle} onChange={(e) => onChange({ ...state, contractTitle: e.target.value })} />
                <button
                  type="button"
                  className="rounded-xl border cd-border-c px-3 py-2 text-xs cd-text-muted whitespace-nowrap hover:cd-soft-primary disabled:opacity-50"
                  disabled={checkingTitle || !state.contractTitle.trim()}
                  title="같은 계약명이 있으면 (YYYY년)·(YYYY년 N차)를 붙여 자동 수정합니다"
                  onClick={() => void checkTitle()}
                >
                  {checkingTitle ? "확인 중…" : "중복확인"}
                </button>
              </div>
            </label>
            <label className="grid gap-1 text-sm col-span-2 relative">
              <span className="font-bold cd-text-muted">계약상대 업체</span>
              <input
                className="cd-input"
                placeholder="업체명 또는 사업자번호 검색"
                value={state.counterpartyQuery}
                onChange={(e) => onChange({ ...state, counterpartyQuery: e.target.value, counterpartyFacilityId: "", counterpartyName: "", counterpartyBusinessRegistrationNo: null })}
              />
              {state.counterpartyName && <p className="text-xs cd-text-primary">선택됨: {state.counterpartyName}</p>}
              {entityOptions.length > 0 && !state.counterpartyFacilityId && (
                <div className="absolute z-10 top-[70px] left-0 right-0 rounded-xl border cd-border-c cd-card-bg shadow-lg max-h-56 overflow-y-auto">
                  {entityOptions.map((entity) => (
                    <button
                      key={entity.facilityId}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-[color:var(--cd-surface)]"
                      onClick={() =>
                        onChange({
                          ...state,
                          counterpartyFacilityId: entity.facilityId,
                          counterpartyName: entity.companyName,
                          counterpartyQuery: entity.companyName,
                          counterpartyBusinessRegistrationNo: entity.businessRegistrationNo ?? null,
                        })
                      }
                    >
                      <span className="cd-text">{entity.companyName}</span>
                      <span className="ml-2 text-xs cd-text-faint">{entity.businessRegistrationNo ?? ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </label>
            <label className="grid gap-1 text-sm relative">
              <span className="font-bold cd-text-muted">{buildTargetFacilityLabel(state.serviceType)}</span>
              <input
                className="cd-input disabled:opacity-60"
                placeholder={
                  state.orderingSubjectType === ORDERING_SUBJECT_SITE_DIRECT
                    ? "계약상대 업체 기준 자동 입력"
                    : "사업장명, 주소, 사업자번호 검색"
                }
                disabled={state.orderingSubjectType === ORDERING_SUBJECT_SITE_DIRECT}
                value={state.facilityQuery}
                onChange={(e) => onChange({ ...state, facilityQuery: e.target.value })}
              />
              {state.selectedFacilities.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {state.selectedFacilities.map((facility) => (
                    <span key={facility.facilityId} className="inline-flex items-center gap-1 rounded-full cd-tint-primary px-2.5 py-1 text-xs cd-text-primary">
                      {facility.companyName}
                      <button
                        type="button"
                        className="cd-text-primary hover:text-[color:var(--cd-primary)]"
                        onClick={() =>
                          onChange({
                            ...state,
                            selectedFacilities: state.selectedFacilities.filter((item) => item.facilityId !== facility.facilityId),
                          })
                        }
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {state.orderingSubjectType !== ORDERING_SUBJECT_SITE_DIRECT && facilityOptions.length > 0 && (
                <div className="absolute z-10 top-[70px] left-0 right-0 rounded-xl border cd-border-c cd-card-bg shadow-lg max-h-56 overflow-y-auto">
                  {facilityOptions
                    .filter((facility) => !state.selectedFacilities.some((selected) => selected.facilityId === facility.facilityId))
                    .map((facility) => (
                      <button
                        key={facility.facilityId}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-[color:var(--cd-surface)]"
                        onClick={() => addTargetFacility(facility)}
                      >
                        <span className="cd-text">{facility.companyName}</span>
                        <span className="ml-2 text-xs cd-text-faint">{facility.businessRegistrationNo ?? ""}</span>
                        {facility.siteAddress && <p className="text-xs cd-text-faint mt-0.5 truncate">{facility.siteAddress}</p>}
                      </button>
                    ))}
                </div>
              )}
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">발주 주체 구분</span>
              <select
                className="cd-select"
                value={state.orderingSubjectType}
                onChange={(e) => onChange({ ...state, orderingSubjectType: e.target.value, facilityQuery: "", selectedFacilities: [] })}
              >
                {ORDERING_SUBJECT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <span className="text-[11px] cd-text-faint">
                대상사업장 기준, 실제 계약 체결 주체와의 관계
              </span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">용역분류</span>
              <select
                className="cd-select"
                value={state.serviceType}
                onChange={(e) => {
                  const nextType = e.target.value;
                  const nextSubtypes = CONTRACT_SERVICE_OPTIONS.find((item) => item.type === nextType)?.subtypes ?? [];
                  onChange({
                    ...state,
                    serviceType: nextType,
                    serviceSubtype: nextSubtypes.some((subtype) => subtype === state.serviceSubtype)
                      ? state.serviceSubtype
                      : nextSubtypes[0] ?? "",
                  });
                }}
              >
                {CONTRACT_SERVICE_OPTIONS.map((option) => (
                  <option key={option.type} value={option.type}>{option.type}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">용역세분류</span>
              <select
                className="cd-select"
                value={state.serviceSubtype}
                onChange={(e) => onChange({ ...state, serviceSubtype: e.target.value })}
              >
                {subtypeOptions.map((subtype) => (
                  <option key={subtype} value={subtype}>{subtype}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">계약 종류</span>
              <select className="cd-select" value={state.contractKind} onChange={(e) => onChange({ ...state, contractKind: e.target.value as "standard" | "unit_price" })}>
                <option value="standard">일반 계약</option>
                <option value="unit_price">단가 계약</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">대금 지급 방식</span>
              <select className="cd-select" value={state.paymentMethod} onChange={(e) => onChange({ ...state, paymentMethod: e.target.value })}>
                {PAYMENT_METHOD_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <div className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">업종</span>
              <div className="flex items-center gap-2">
                <select className="cd-select min-w-0 flex-1" value={state.industryCategory} onChange={(e) => onChange({ ...state, industryCategory: e.target.value })}>
                  <option value="">업종 선택</option>
                  {industryOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                <IndustryOptionsEditorButton options={industryOptions} onOptionsChange={setIndustryOptions} />
              </div>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">계약금액</span>
              {/* 청구·수금 단계 금액 합계가 자동 반영된다(이중 입력 제거, 2026-08-24) — 직접 입력 불가 */}
              <input
                className="cd-input tabular-nums opacity-70 cursor-not-allowed"
                inputMode="numeric"
                readOnly
                value={milestoneSum > 0 ? milestoneSum.toLocaleString("ko-KR") : ""}
                placeholder="청구·수금 단계 합계 자동 반영"
                title="청구·수금 단계 탭의 금액 합계가 자동으로 채워집니다."
              />
              <span className="text-[11px] cd-text-faint">청구·수금 단계 탭의 금액 합계가 자동 반영됩니다.</span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">계약일</span>
              <DateInput value={state.contractDate} onChange={(contractDate) => onChange({ ...state, contractDate, startedAt: state.startedAt || contractDate })} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">준공일</span>
              <DateInput value={state.endedAt} onChange={(endedAt) => onChange({ ...state, endedAt })} />
            </label>
            <label className="grid gap-1 text-sm col-span-2">
              <span className="font-bold cd-text-muted">메모</span>
              <textarea className="cd-input min-h-[90px]" value={state.memo} onChange={(e) => onChange({ ...state, memo: e.target.value })} />
            </label>
          </div>
        )}

        {tab === "ratecard" && state.contractKind === "unit_price" && (
          <RateCardEditor data={state.rateCard} onChange={(rateCard) => onChange({ ...state, rateCard })} />
        )}

        {tab === "milestones" && (
          <div className="grid gap-3">
            {state.contractKind === "unit_price" && rateStageOptions.length === 0 && (
              <p className="rounded-xl border cd-border-c p-3 text-xs cd-text-muted">
                단가 계약은 <b>단가 계약</b> 탭에서 단가 기준표와 차수표(산정 수량)를 먼저 작성하세요. 차수별
                선급금/준공금(선급률을 비운 단일 차수는 구분 소계)이 아래 단계명 목록으로 나오고, 선택하면 금액이
                자동 적용됩니다.
              </p>
            )}
            {state.contractKind === "unit_price" && rateStageOptions.length > 0 && (
              <button
                type="button"
                className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-primary justify-self-start"
                title="단가 기준표에서 파생된 단계 전체로 아래 목록을 다시 구성합니다."
                onClick={() =>
                  onChange({
                    ...state,
                    milestones: rateStageOptions.map((o) => ({
                      ...createMilestoneDraft(),
                      stageLabel: o.label,
                      amount: o.amount > 0 ? String(o.amount) : "",
                    })),
                  })
                }
              >
                단가표 기준으로 단계 자동 구성 ({rateStageOptions.length}단계)
              </button>
            )}
            {state.milestones.map((m, idx) => (
              <div key={m.id} className="grid grid-cols-[56px_1fr_150px_1.2fr_40px] gap-2 items-end rounded-2xl border cd-border-c cd-surface-bg p-3">
                <div className="text-xs cd-text-faint pb-2">{idx + 1}차</div>
                <label className="grid gap-1 text-xs">
                  <span className="cd-text-faint">단계명</span>
                  {state.contractKind === "unit_price" ? (
                    // 단가 계약 — 단계명은 단가 기준표 파생 옵션에서 고른다(직접 입력 대신, 2026-08-24).
                    // 선택하면 해당 소계(차수형은 선급/준공 분해액)가 청구금액으로 자동 적용된다.
                    <select
                      className="cd-select"
                      value={m.stageLabel}
                      onChange={(e) => {
                        const label = e.target.value;
                        const option = rateStageOptions.find((o) => o.label === label);
                        updateMilestone(m.id, {
                          stageLabel: label,
                          ...(option && option.amount > 0 ? { amount: String(option.amount) } : {}),
                        });
                      }}
                    >
                      <option value="">단계 선택</option>
                      {rateStageOptions.map((o) => (
                        <option key={o.label} value={o.label}>{o.label}</option>
                      ))}
                      {m.stageLabel && !rateStageOptions.some((o) => o.label === m.stageLabel) && (
                        <option value={m.stageLabel}>{m.stageLabel}</option>
                      )}
                    </select>
                  ) : (
                    <input className="cd-input" value={m.stageLabel} onChange={(e) => updateMilestone(m.id, { stageLabel: e.target.value })} placeholder="선급금 / 중도금1 / 준공금" />
                  )}
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="cd-text-faint">청구금액</span>
                  <input className="cd-input tabular-nums" inputMode="numeric" value={formatThousands(m.amount)} onChange={(e) => updateMilestone(m.id, { amount: stripDigits(e.target.value) })} />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="cd-text-faint">대금 지급 조건</span>
                  <input className="cd-input" value={m.paymentTerms} onChange={(e) => updateMilestone(m.id, { paymentTerms: e.target.value })} placeholder="세금계산서 발행 후 30일 이내" />
                </label>
                <button type="button" className="rounded-lg p-2 text-rose-600 hover:bg-rose-50" onClick={() => onChange({ ...state, milestones: state.milestones.filter((item) => item.id !== m.id) })}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-sm cd-text-muted inline-flex items-center gap-2 justify-center"
              onClick={() => onChange({ ...state, milestones: [...state.milestones, createMilestoneDraft()] })}
            >
              <Plus className="w-4 h-4" />
              단계 추가
            </button>
          </div>
        )}

        {tab === "outsourcing" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm col-span-2">
              <span className="font-bold cd-text-muted">외주 계약명</span>
              <input
                className="cd-input"
                value={state.outsourcing.outsourcingTitle}
                onChange={(e) => onChange({ ...state, outsourcing: { ...state.outsourcing, outsourcingTitle: e.target.value } })}
              />
            </label>
            <label className="grid gap-1 text-sm col-span-2 relative">
              <span className="font-bold cd-text-muted">계약상대 업체</span>
              <input
                className="cd-input"
                placeholder="업체명 또는 사업자번호 검색"
                value={state.outsourcing.counterpartyQuery}
                onChange={(e) => onChange({
                  ...state,
                  outsourcing: {
                    ...state.outsourcing,
                    counterpartyQuery: e.target.value,
                    counterpartyFacilityId: "",
                    counterpartyName: "",
                  },
                })}
              />
              {state.outsourcing.counterpartyName && <p className="text-xs cd-text-primary">선택됨: {state.outsourcing.counterpartyName}</p>}
              {outsourcingEntityOptions.length > 0 && !state.outsourcing.counterpartyFacilityId && (
                <div className="absolute z-10 top-[70px] left-0 right-0 rounded-xl border cd-border-c cd-card-bg shadow-lg max-h-56 overflow-y-auto">
                  {outsourcingEntityOptions.map((entity) => (
                    <button
                      key={entity.facilityId}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-[color:var(--cd-surface)]"
                      onClick={() =>
                        onChange({
                          ...state,
                          outsourcing: {
                            ...state.outsourcing,
                            counterpartyFacilityId: entity.facilityId,
                            counterpartyName: entity.companyName,
                            counterpartyQuery: entity.companyName,
                          },
                        })
                      }
                    >
                      <span className="cd-text">{entity.companyName}</span>
                      <span className="ml-2 text-xs cd-text-faint">{entity.businessRegistrationNo ?? ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">용역분류</span>
              <select
                className="cd-select max-w-[220px]"
                value={state.outsourcing.serviceType}
                onChange={(e) => onChange({ ...state, outsourcing: { ...state.outsourcing, serviceType: e.target.value } })}
              >
                {outsourcingTypeOptions.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end justify-start">
              <button
                type="button"
                className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs cd-text-muted"
                onClick={() => {
                  const next = prompt("추가할 외주 용역 분류명을 입력하세요.");
                  if (!next?.trim()) return;
                  setOutsourcingTypeOptions((prev) => prev.includes(next.trim()) ? prev : [...prev, next.trim()]);
                  onChange({ ...state, outsourcing: { ...state.outsourcing, serviceType: next.trim() } });
                }}
              >
                분류 추가
              </button>
              <button
                type="button"
                className="ml-2 cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs text-rose-600"
                onClick={() => {
                  if (outsourcingTypeOptions.length <= 1) return;
                  const next = outsourcingTypeOptions.filter((type) => type !== state.outsourcing.serviceType);
                  setOutsourcingTypeOptions(next);
                  onChange({ ...state, outsourcing: { ...state.outsourcing, serviceType: next[0] ?? "" } });
                }}
              >
                삭제
              </button>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">계약금액</span>
              <input
                className="cd-input tabular-nums"
                inputMode="numeric"
                value={formatThousands(state.outsourcing.amount)}
                onChange={(e) => onChange({ ...state, outsourcing: { ...state.outsourcing, amount: stripDigits(e.target.value) } })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">계약일</span>
              <DateInput value={state.outsourcing.contractDate} onChange={(contractDate) => onChange({ ...state, outsourcing: { ...state.outsourcing, contractDate } })} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">준공일</span>
              <DateInput value={state.outsourcing.endedAt} onChange={(endedAt) => onChange({ ...state, outsourcing: { ...state.outsourcing, endedAt } })} />
            </label>
            <label className="grid gap-1 text-sm col-span-2">
              <span className="font-bold cd-text-muted">메모</span>
              <textarea
                className="cd-input min-h-[90px]"
                value={state.outsourcing.memo}
                onChange={(e) => onChange({ ...state, outsourcing: { ...state.outsourcing, memo: e.target.value } })}
              />
            </label>
            <label className="grid gap-1 text-sm col-span-2">
              <span className="font-bold cd-text-muted">외주 계약서 PDF 첨부</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:cd-fill-primary file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
                onChange={(e) => {
                  const nextFile = e.target.files?.[0] ?? null;
                  outsourcingFileRef.current = nextFile;
                  setOutsourcingFileName(nextFile?.name ?? "");
                }}
              />
              {outsourcingFileName && <span className="text-xs cd-text-faint">선택됨: {outsourcingFileName}</span>}
            </label>
          </div>
        )}

        {tab === "document" && (
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">계약서 PDF 첨부</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:cd-fill-primary file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
                onChange={(e) => {
                  const nextFile = e.target.files?.[0] ?? null;
                  documentFileRef.current = nextFile;
                  setDocumentFileName(nextFile?.name ?? "");
                }}
              />
              {documentFileName && <span className="text-xs cd-text-faint">선택됨: {documentFileName}</span>}
            </label>
            <p className="text-xs cd-text-faint">
              저장 경로는 계약일 기준 <code>매출계약서/년도/(계약일) 계약명</code> 논리 경로로 생성됩니다.
            </p>
          </div>
        )}
      </div>

      <div className="p-5 pt-0 border-t cd-border-c flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-xl px-4 py-2 text-sm font-bold cd-text-muted">닫기</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-bold text-white cd-fill-primary shadow-sm disabled:opacity-60">
          {saving ? "저장 중..." : "계약 등록"}
        </button>
      </div>
    </ModalShell>
  );
}

function EditMilestoneModal({
  contractId,
  state,
  onChange,
  onClose,
  onSaved,
}: {
  contractId: string;
  state: EditMilestoneModalState;
  onChange: (state: EditMilestoneModalState) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const invoiceFileRef = useRef<File | null>(null);
  const [invoiceFileName, setInvoiceFileName] = useState("");

  const submit = async () => {
    setSaving(true);
    const invoiceFile = invoiceFileRef.current;
    try {
      const patchRes = await fetch(
        `/api/contracts/${encodeURIComponent(contractId)}/milestones/${encodeURIComponent(state.milestoneId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stageLabel: state.stageLabel,
            amount: state.amount ? Number(state.amount) : null,
            paymentTerms: state.paymentTerms || null,
            invoiceIssued: Boolean(state.issueDate),
            invoiceIssuedAt: state.issueDate || null,
            invoiceAmount: state.invoiceAmount ? Number(state.invoiceAmount) : null,
            paymentCollected: state.paymentCollected,
            paymentCollectedAt: state.paymentCollectedAt || null,
            collectionRatio: state.collectionRatio ? Number(state.collectionRatio) : null,
            collectedAmount: state.collectedAmount ? Number(state.collectedAmount) : null,
            partialPaymentMemo: state.paymentCollected && !invoiceFile ? state.partialPaymentMemo : undefined,
          }),
        }
      );
      if (!patchRes.ok) {
        const body = await patchRes.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + patchRes.status);
      }

      if (invoiceFile) {
        const form = new FormData();
        form.set("milestoneId", state.milestoneId);
        form.set("issueDate", state.issueDate);
        form.set("invoiceAmount", state.invoiceAmount);
        form.set("paymentCollected", state.paymentCollected ? "1" : "0");
        form.set("paymentCollectedAt", state.paymentCollectedAt);
        form.set("collectionRatio", state.collectionRatio);
        form.set("collectedAmount", state.collectedAmount);
        form.set("paymentTerms", state.paymentTerms);
        form.set("partialPaymentMemo", state.partialPaymentMemo);
        form.set("file", invoiceFile);
        const uploadRes = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/invoices`, {
          method: "POST",
          body: form,
        });
        if (!uploadRes.ok) {
          const body = await uploadRes.json().catch(() => ({}));
          throw new Error(body?.error ?? "계산서 교체 실패");
        }
      }

      toast.show("청구·수금 단계가 수정되었습니다.", "success");
      onSaved();
    } catch (err) {
      toast.show("수정 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`${state.stageLabel} 단계 수정`} onClose={onClose}>
      <div className="p-5 grid gap-3 grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">단계명</span>
          <input className="cd-input" value={state.stageLabel} onChange={(e) => onChange({ ...state, stageLabel: e.target.value })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">청구금액</span>
          <input className="cd-input tabular-nums" inputMode="numeric" value={formatThousands(state.amount)} onChange={(e) => onChange({ ...state, amount: stripDigits(e.target.value) })} />
        </label>
        <label className="grid gap-1 text-sm col-span-2">
          <span className="font-bold cd-text-muted">대금 지급 조건</span>
          <input className="cd-input" value={state.paymentTerms} onChange={(e) => onChange({ ...state, paymentTerms: e.target.value })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">계산서 발행일</span>
          <DateInput value={state.issueDate} onChange={(issueDate) => onChange({ ...state, issueDate })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">계산서 발행금액</span>
          <input className="cd-input tabular-nums" inputMode="numeric" value={formatThousands(state.invoiceAmount)} onChange={(e) => onChange({ ...state, invoiceAmount: stripDigits(e.target.value) })} />
        </label>
        <label className="grid gap-1 text-sm col-span-2">
          <span className="font-bold cd-text-muted">세금계산서 교체 PDF</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:cd-fill-primary file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
            onChange={(e) => {
              const nextFile = e.target.files?.[0] ?? null;
              invoiceFileRef.current = nextFile;
              setInvoiceFileName(nextFile?.name ?? "");
            }}
          />
          {invoiceFileName && <span className="text-xs cd-text-faint">선택됨: {invoiceFileName}</span>}
          <span className="text-xs cd-text-faint">파일을 선택하면 새 계산서 PDF가 같은 단계의 최신 계산서로 추가 등록됩니다.</span>
        </label>
        <label className="flex items-center gap-2 text-sm font-bold cd-text-muted col-span-2">
          <input type="checkbox" checked={state.paymentCollected} onChange={(e) => onChange({ ...state, paymentCollected: e.target.checked })} />
          수금 정보 등록
        </label>
        {state.paymentCollected && (
          <>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">수금일</span>
              <DateInput value={state.paymentCollectedAt} onChange={(paymentCollectedAt) => onChange({ ...state, paymentCollectedAt })} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold cd-text-muted">수금금액</span>
              <input
                className="cd-input tabular-nums"
                inputMode="numeric"
                value={formatThousands(state.collectedAmount)}
                onChange={(e) => {
                  const digits = stripDigits(e.target.value);
                  const amount = Number(digits || "0");
                  const base = Number(state.amount || state.baseAmount || 0);
                  const ratio = base > 0 ? String(Math.round((amount / base) * 10000) / 10000) : "";
                  onChange({ ...state, collectedAmount: digits, collectionRatio: ratio });
                }}
              />
            </label>
            <label className="grid gap-1 text-sm col-span-2">
              <span className="font-bold cd-text-muted">부분입금 사유</span>
              <textarea className="cd-input min-h-[84px]" value={state.partialPaymentMemo} onChange={(e) => onChange({ ...state, partialPaymentMemo: e.target.value })} />
            </label>
          </>
        )}
      </div>
      <div className="p-5 pt-0 border-t cd-border-c flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-xl px-4 py-2 text-sm font-bold cd-text-muted">닫기</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-bold text-white cd-fill-primary shadow-sm disabled:opacity-60">
          {saving ? "저장 중..." : "수정"}
        </button>
      </div>
    </ModalShell>
  );
}

function NewStageModal({
  contractId,
  contractKind = "standard",
  state,
  onChange,
  onClose,
  onSaved,
}: {
  contractId: string;
  contractKind?: string;
  state: NewStageModalState;
  onChange: (state: NewStageModalState) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  // 단가 계약 — 단계명을 단가 기준표 파생 옵션에서 고른다(2026-08-24). 소계/선급·준공 분해액이 금액으로 자동 적용.
  const isUnitPrice = contractKind === "unit_price";
  const [rateCard, setRateCard] = useState<RateCardData>(() => createRateCard());
  useEffect(() => {
    if (!isUnitPrice) return;
    let alive = true;
    fetch(`/api/contracts/${encodeURIComponent(contractId)}/rate-card`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return;
        const d = (await r.json()) as { card?: unknown; items?: unknown };
        if (alive) setRateCard(upgradeRateCard(d.card ?? d.items));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [contractId, isUnitPrice]);
  const rateStageOptions = useMemo(() => rateCardStageOptions(rateCard), [rateCard]);

  const submit = async () => {
    if (!state.stageLabel.trim()) {
      toast.show("단계명을 입력하세요.", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/milestones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stageLabel: state.stageLabel,
          amount: state.amount ? Number(state.amount) : null,
          paymentTerms: state.paymentTerms || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      toast.show("새 단계가 추가되었습니다.", "success");
      onSaved();
    } catch (err) {
      toast.show("추가 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="청구·수금 단계 추가" onClose={onClose}>
      <div className="p-5 grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">단계명</span>
          {isUnitPrice ? (
            <>
              <select
                className="cd-select"
                value={state.stageLabel}
                onChange={(e) => {
                  const label = e.target.value;
                  const option = rateStageOptions.find((o) => o.label === label);
                  onChange({
                    ...state,
                    stageLabel: label,
                    ...(option && option.amount > 0 ? { amount: String(option.amount) } : {}),
                  });
                }}
              >
                <option value="">단계 선택</option>
                {rateStageOptions.map((o) => (
                  <option key={o.label} value={o.label}>{o.label}</option>
                ))}
                {state.stageLabel && !rateStageOptions.some((o) => o.label === state.stageLabel) && (
                  <option value={state.stageLabel}>{state.stageLabel}</option>
                )}
              </select>
              {rateStageOptions.length === 0 && (
                <span className="text-[11px] cd-text-faint">
                  단가 기준표가 비어 있습니다. 변경계약 입력의 단가 계약 탭에서 먼저 작성하세요.
                </span>
              )}
            </>
          ) : (
            <input type="text" className="cd-input" placeholder="예: 1차 기성금"
              value={state.stageLabel} onChange={(e) => onChange({ ...state, stageLabel: e.target.value })} />
          )}
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">청구금액</span>
          <input className="cd-input tabular-nums" inputMode="numeric" value={formatThousands(state.amount)} onChange={(e) => onChange({ ...state, amount: stripDigits(e.target.value) })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">대금 지급 조건</span>
          <input type="text" className="cd-input" placeholder="예: 세금계산서 발행 후 30일 이내 지급"
            value={state.paymentTerms} onChange={(e) => onChange({ ...state, paymentTerms: e.target.value })} />
        </label>
      </div>
      <div className="p-5 pt-0 border-t cd-border-c flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-xl px-4 py-2 text-sm font-bold cd-text-muted">닫기</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-bold text-white cd-fill-primary shadow-sm disabled:opacity-60">
          {saving ? "저장 중..." : "추가"}
        </button>
      </div>
    </ModalShell>
  );
}

function DraggablePdfViewer({
  title,
  url,
  onClose,
}: {
  title: string;
  url: string;
  onClose: () => void;
}) {
  const [position, setPosition] = useState(() => ({
    x: typeof window === "undefined"
      ? 96
      : Math.max(16, Math.round((window.innerWidth - Math.min(1280, window.innerWidth - 32)) / 2)),
    y: 24,
  }));
  const dragOffset = useRef<{ x: number; y: number } | null>(null);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = {
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return;
    const width = Math.min(1280, window.innerWidth - 32);
    const height = Math.min(1100, window.innerHeight - 32);
    setPosition({
      x: Math.min(Math.max(8, event.clientX - dragOffset.current.x), Math.max(8, window.innerWidth - width - 8)),
      y: Math.min(Math.max(8, event.clientY - dragOffset.current.y), Math.max(8, window.innerHeight - height - 8)),
    });
  };

  const stopDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      className="fixed z-[60] rounded-3xl border cd-border-c cd-card-bg shadow-2xl overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: "min(1280px, calc(100vw - 32px))",
        height: "min(1100px, calc(100vh - 32px))",
      }}
    >
      <div
        className="h-12 px-4 border-b cd-border-c cd-surface-bg flex items-center justify-between gap-3 cursor-move select-none"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <div className="min-w-0 flex items-center gap-2">
          <FileText className="w-4 h-4 cd-text-primary shrink-0" />
          <span className="text-sm cd-text truncate">{title}</span>
        </div>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="rounded-lg p-1 cd-text-faint hover:bg-[color:var(--cd-surface)] hover:text-[color:var(--cd-text)]"
          title="닫기"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <iframe
        title={title}
        src={withPdfViewerDefaults(url)}
        className="w-full h-[calc(100%-48px)] cd-surface-bg"
      />
    </div>
  );
}

function withPdfViewerDefaults(url: string): string {
  const [base] = url.split("#", 1);
  return `${base}#toolbar=1&navpanes=0&view=FitH`;
}

function ContractDeleteModal({
  contractTitle,
  onClose,
  onDelete,
}: {
  contractTitle: string;
  onClose: () => void;
  onDelete: (deleteReason: string) => Promise<void>;
}) {
  const [deleteReason, setDeleteReason] = useState("중복 입력 삭제");
  const [saving, setSaving] = useState(false);
  return (
    <ModalShell title="계약 휴지통 이동" onClose={onClose}>
      <div className="p-5 grid gap-4">
        <p className="text-sm cd-text-muted">
          <span className="cd-text">{contractTitle}</span> 계약을 휴지통으로 이동합니다. 계약 데이터는 목록에서 제외되며, admin만 휴지통에서 영구 삭제할 수 있습니다.
        </p>
        <label className="grid gap-1 text-sm">
          <span className="font-bold cd-text-muted">삭제 사유</span>
          <select className="cd-select" value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)}>
            <option value="중복 입력 삭제">중복 입력 삭제</option>
            <option value="계약 무산">계약 무산</option>
            <option value="계약 포기">계약 포기</option>
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-2 border-t cd-border-c">
          <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-xl px-4 py-2 text-sm font-bold cd-text-muted">
            닫기
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onDelete(deleteReason);
              } finally {
                setSaving(false);
              }
            }}
            className="rounded-xl px-4 py-2 text-sm font-bold text-white bg-rose-500 hover:bg-rose-600 disabled:opacity-60"
          >
            {saving ? "삭제 중..." : "삭제"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-stone-950/20 flex items-center justify-center p-4">
      <div className={"cd-card rounded-3xl max-h-[min(840px,calc(100vh-32px))] shadow-2xl overflow-hidden flex flex-col " + (wide ? "w-[min(960px,calc(100vw-32px))]" : "w-[min(640px,calc(100vw-32px))]")}>
        <div className="p-5 border-b cd-border-c flex items-start justify-between gap-3">
          <h3 className="text-xl font-bold cd-text">{title}</h3>
          <button type="button" onClick={onClose} className="cd-text-faint hover:opacity-70">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto scrollbar-hide">{children}</div>
      </div>
    </div>
  );
}

function Info({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  const isEmpty = value == null || value === "";
  return (
    <div className={"rounded-2xl border p-3 " + (highlight ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c")}>
      <p className="text-[11px] cd-text-faint">{label}</p>
      <p className={"text-sm mt-1 truncate " + (highlight ? "cd-text-primary" : "cd-text")}>
        {isEmpty ? "-" : value}
      </p>
    </div>
  );
}

function CollectionProgressCard({
  rate,
  collectedAmount,
  baseAmount,
  settlementRate,
}: {
  rate: number;
  collectedAmount: number;
  baseAmount: number;
  /** 실적 정산이 있는 용역만 전달. 총 계약금액 대비 정산 반영 총 청구액 비율(0~1). */
  settlementRate?: number | null;
}) {
  const percent = Math.round(rate * 100);
  const today = formatKoreanDate(new Date());
  return (
    <div className="rounded-2xl border cd-border-c p-4 min-h-[180px] flex flex-col items-center justify-center relative">
      <p className="absolute left-4 top-3 text-[11px] font-bold cd-text-faint">수금 진척도</p>
      {/* conic-gradient + 가운데 원 방식은 가운데가 카드색으로 '덮인' 것이라 반투명 토큰에서 뒤가 비쳤고,
          호(arc) 양 끝도 각지게 잘렸다 → SVG 링으로 그려 가운데를 실제로 비우고 끝을 둥글린다. */}
      <div className="relative w-28 h-28 flex items-center justify-center">
        <svg width="112" height="112" viewBox="0 0 112 112" className="absolute inset-0">
          <circle
            cx="56"
            cy="56"
            r="44"
            fill="none"
            strokeWidth="12"
            stroke="color-mix(in srgb, #9BC2E6 22%, transparent)"
          />
          {percent > 0 && (
            <circle
              cx="56"
              cy="56"
              r="44"
              fill="none"
              strokeWidth="12"
              stroke="#9BC2E6"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 44}
              strokeDashoffset={2 * Math.PI * 44 * (1 - Math.min(1, Math.max(0, rate)))}
              transform="rotate(-90 56 56)"
            />
          )}
        </svg>
        <span className="relative text-xl font-bold text-[#9BC2E6]">{percent}%</span>
      </div>
      <p className="mt-3 text-xs font-mono cd-text-muted">
        {formatExactAmount(collectedAmount)} / {formatExactAmount(baseAmount)}
      </p>
      {settlementRate != null && (
        <p className="mt-1.5 rounded-lg border cd-border-c px-2 py-1 text-[11px] font-bold cd-text-muted">
          실적 정산 반영 비율 {Math.round(settlementRate * 1000) / 10}%
        </p>
      )}
      <p className="absolute right-4 bottom-3 text-[11px] cd-text-faint">{today} 기준</p>
    </div>
  );
}

type TreeFlatRow =
  | {
      kind: "group";
      serviceType: string;
      count: number;
      isOpen: boolean;
      style: ServiceTypeStyle;
    }
  | {
      kind: "child";
      contract: ContractTreeContractNode;
      isLastChild: boolean;
      style: ServiceTypeStyle;
    };

interface TreeGroupHeaderProps {
  serviceType: string;
  count: number;
  isOpen: boolean;
  style: ServiceTypeStyle;
  onToggle: (serviceType: string) => void;
}

const TreeGroupHeader = memo(function TreeGroupHeader({
  serviceType,
  count,
  isOpen,
  style,
  onToggle,
}: TreeGroupHeaderProps) {
  // Switch the parent folder icon between closed and open variants so that
  // expanding a group is reinforced visually beyond the chevron rotation.
  const ParentIcon = isOpen ? FolderOpen : Folder;
  const handleClick = useCallback(() => onToggle(serviceType), [onToggle, serviceType]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[color:var(--cd-surface)] border-b cd-border-c"
    >
      {isOpen ? (
        <ChevronDown className="w-4 h-4 cd-text-faint" />
      ) : (
        <ChevronRight className="w-4 h-4 cd-text-faint" />
      )}
      <ParentIcon
        className="w-4 h-4 fill-current transition-transform"
        style={{ color: style.parentColor }}
      />
      <span className="text-sm cd-text">{serviceType}</span>
      <span className="text-[11px] cd-text-faint ml-auto">{count}건</span>
    </button>
  );
});

interface TreeChildRowProps {
  contract: ContractTreeContractNode;
  isSelected: boolean;
  isLastChild: boolean;
  childColor: string;
  onSelect: (contractId: string) => void;
}

const TreeChildRow = memo(function TreeChildRow({
  contract,
  isSelected,
  isLastChild,
  childColor,
  onSelect,
}: TreeChildRowProps) {
  const handleClick = useCallback(() => onSelect(contract.contractId), [onSelect, contract.contractId]);
  // Selected child rows show an "open folder" icon to mirror the active-state
  // metaphor used by the parent group header.
  const ChildIcon = isSelected ? FolderOpen : FolderClosed;
  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        "relative w-full flex items-center gap-2 pl-12 pr-3 py-2 text-left text-xs hover:bg-[color:var(--cd-surface)] " +
        (isSelected ? "cd-tint-primary border-l-4 border-[color:var(--cd-primary)]" : "border-l-4 border-transparent")
      }
    >
      <span
        aria-hidden
        className={
          "pointer-events-none absolute left-7 w-px bg-[var(--cd-border)] " +
          (isLastChild ? "top-0 h-1/2" : "top-0 bottom-0")
        }
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-7 top-1/2 w-3 h-px bg-[var(--cd-border)]"
      />
      <ChildIcon
        className="w-3.5 h-3.5 fill-current shrink-0"
        style={{ color: childColor }}
      />
      <span className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="truncate cd-text">{contract.contractTitle}</span>
        {contract.contractStatus === "terminated" && (
          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] text-white" style={{ background: "#FF7171" }}>
            계약해지
          </span>
        )}
        {contract.contractStatus === "suspended" && (
          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] cd-text" style={{ background: "#FFD966" }}>
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
      <span className="w-[88px] text-right text-[10px] font-mono cd-text-faint ml-2 shrink-0 tabular-nums">
        {contract.contractDate ?? "-"}
      </span>
      <span className="w-[72px] text-right text-[10px] font-mono cd-text-faint ml-1 shrink-0 tabular-nums">
        {formatMoney(contract.currentAmount)}
      </span>
    </button>
  );
});

function DateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const displayValue = formatDateProgressive(value);
  return (
    <div className="relative flex items-center">
      <input
        type="text"
        inputMode="numeric"
        maxLength={10}
        className="cd-input tabular-nums w-full pr-9"
        placeholder="YYYYMMDD"
        value={displayValue}
        onChange={(e) => onChange(normalizeDateInput(e.target.value))}
      />
      <Calendar className="pointer-events-none absolute right-3 w-4 h-4 cd-text-faint" />
      <input
        type="date"
        aria-label="달력에서 선택"
        title="달력에서 선택"
        className="absolute right-0 top-0 h-full w-9 cursor-pointer opacity-0"
        value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** 저장값(부분 숫자 또는 ISO)을 입력 진행도에 맞춰 YYYY-MM-DD 로 표시 */
function formatDateProgressive(value: string): string {
  const digits = stripDigits(value).slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function normalizeDateInput(value: string): string {
  const digits = stripDigits(value).slice(0, 8);
  if (digits.length !== 8) return digits;
  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6);
  const day = digits.slice(6, 8);
  const iso = `${year}-${month}-${day}`;
  const date = new Date(iso + "T00:00:00");
  const valid =
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === Number(year) &&
    date.getMonth() + 1 === Number(month) &&
    date.getDate() === Number(day);
  return valid ? iso : digits;
}

function formatKoreanDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}.`;
}

function createMilestoneDraft(): ContractMilestoneDraft {
  return {
    id: "draft_" + Math.random().toString(36).slice(2),
    stageLabel: "",
    amount: "",
    paymentTerms: "",
  };
}

function createEmptyContractState(): NewContractModalState {
  const defaultService = CONTRACT_SERVICE_OPTIONS[0];
  return {
    contractTitle: "",
    counterpartyQuery: "",
    counterpartyFacilityId: "",
    counterpartyName: "",
    counterpartyBusinessRegistrationNo: null,
    facilityQuery: "",
    selectedFacilities: [],
    serviceType: defaultService.type,
    serviceSubtype: defaultService.subtypes[0],
    contractKind: "standard",
    paymentMethod: PAYMENT_METHOD_OPTIONS[0],
    orderingSubjectType: ORDERING_SUBJECT_OPTIONS[0].value,
    contractDate: new Date().toISOString().slice(0, 10),
    startedAt: "",
    endedAt: "",
    currentAmount: "",
    industryCategory: "",
    memo: "",
    milestones: [
      { ...createMilestoneDraft(), stageLabel: "선급금" },
      { ...createMilestoneDraft(), stageLabel: "준공금" },
    ],
    rateCard: createRateCard(),
    outsourcing: {
      outsourcingTitle: "",
      counterpartyQuery: "",
      counterpartyFacilityId: "",
      counterpartyName: "",
      serviceType: DEFAULT_OUTSOURCING_TYPES[0],
      contractDate: "",
      endedAt: "",
      amount: "",
      memo: "",
    },
  };
}

function firstPartialPaymentMemo(value: unknown): string {
  if (!value) return "";
  try {
    const parsed = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? JSON.parse(value) as Array<{ memo?: unknown }>
        : [];
    return String(parsed.find((item) => item?.memo)?.memo ?? "");
  } catch {
    return "";
  }
}

function getContractStatusLabel(detail: ContractDetail): string {
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

/**
 * Render a numeric amount with thousands separators for currency input fields
 * (e.g. `53000000` -> `53,000,000`). Returns "" for empty/non-numeric input
 * so that placeholders still show up in the form.
 */
/**
 * 두 날짜 사이의 "경과 개월 수"를 달력 기준으로 계산한다.
 * (일자가 시작일보다 이르면 아직 한 달을 채우지 못한 것으로 보고 1을 뺀다.)
 */
function monthsBetween(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

interface OverdueCollectionTag {
  label: string;
  color: string;
  tooltip: string;
}

/**
 * 계산서 발행 후 수금이 완료되지 않은 대금지급조건을 검사해 경과 기간 태그를 만든다.
 * 미수금 건이 하나도 없으면 null. 색상/구간은 "가장 오래 경과한" 발행 건을 기준으로 한다.
 *  - 1개월 미만: #A9D08E / 2개월 미만: #FFD966 / 2개월 이상: #FF7979
 */
function getOverdueCollectionTag(milestones: Array<Record<string, unknown>>): OverdueCollectionTag | null {
  const now = new Date();
  let maxMonths = -1;
  for (const m of milestones) {
    const issued = Number(m.invoice_issued ?? 0) === 1;
    const collected = Number(m.payment_collected ?? 0) === 1;
    if (!issued || collected) continue;
    const raw = m.invoice_issued_at ? new Date(String(m.invoice_issued_at)) : null;
    const months = raw && !Number.isNaN(raw.getTime()) ? monthsBetween(raw, now) : 0;
    if (months > maxMonths) maxMonths = months;
  }
  if (maxMonths < 0) return null;
  if (maxMonths < 1) return { label: "1개월 미만", color: "#A9D08E", tooltip: "계산서 발행 후 수금 미완료 (발행 1개월 미만)" };
  if (maxMonths < 2) return { label: "2개월 미만", color: "#FFD966", tooltip: "계산서 발행 후 수금 미완료 (발행 1~2개월 경과)" };
  return { label: "2개월 이상", color: "#FF7979", tooltip: "계산서 발행 후 수금 미완료 (발행 2개월 이상 경과)" };
}

function formatThousands(value: string): string {
  const digits = stripDigits(value);
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
}

/** Remove every non-digit character (commas, spaces, etc.) from a string. */
function stripDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

function formatMoney(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "-";
  if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, "") + "억";
  if (Math.abs(n) >= 10000) return Math.round(n / 10000).toLocaleString() + "만";
  return n.toLocaleString();
}

/**
 * Render the exact amount with thousands separators (e.g. `8,640,000`).
 * Used in milestone tables where the user wants the full claim/collection
 * amount visible rather than the abbreviated 만/억 form.
 */
function formatExactAmount(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "-";
  return Math.round(n).toLocaleString("en-US");
}

/**
 * 대상사업장 항목 라벨을 용역분류에 맞춰 `대상사업장(용역분류)` 형태로 생성한다.
 * 용역분류가 비어 있으면 `대상사업장`만 표시한다.
 */
function buildTargetFacilityLabel(serviceType: unknown): string {
  const type = String(serviceType ?? "").trim();
  return type ? `대상사업장(${type})` : "대상사업장";
}
