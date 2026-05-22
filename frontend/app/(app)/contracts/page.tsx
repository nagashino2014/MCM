"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Virtuoso } from "react-virtuoso";
import type { ServiceTypeStyle } from "@/lib/ieps/contract-tree-style";
import Link from "next/link";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  FileSignature,
  FileText,
  Folder,
  FolderClosed,
  FolderOpen,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { resolveServiceTypeStyle } from "@/lib/ieps/contract-tree-style";
import ContractChangeModal from "@/components/contracts/ContractChangeModal";

interface ContractTreeContractNode {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  serviceSubtype: string | null;
  currentAmount: number | null;
  contractDate: string | null;
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

interface ContractDetail {
  contract: Record<string, unknown>;
  milestones: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  changes: Array<Record<string, unknown>>;
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
  file: File | null;
}

interface ContractMilestoneDraft {
  id: string;
  stageLabel: string;
  amount: string;
  paymentTerms: string;
}

interface NewContractModalState {
  contractTitle: string;
  counterpartyQuery: string;
  counterpartyEntityId: string;
  counterpartyName: string;
  serviceType: string;
  serviceSubtype: string;
  contractKind: "standard" | "unit_price";
  contractDate: string;
  startedAt: string;
  endedAt: string;
  currentAmount: string;
  memo: string;
  milestones: ContractMilestoneDraft[];
  documentFile: File | null;
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
  invoiceFile: File | null;
}

interface LegalEntitySearchItem {
  entityId: string;
  entityName: string;
  businessRegistrationNo: string | null;
}

interface PdfViewerState {
  title: string;
  url: string;
}

export default function ContractsPage() {
  return (
    <ToastProvider>
      <ContractsInner />
    </ToastProvider>
  );
}

function ContractsInner() {
  const toast = useToast();
  const [tree, setTree] = useState<ContractTreePayload | null>(null);
  const [year, setYear] = useState<string>(() => String(new Date().getFullYear()));
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
  const [newContractModal, setNewContractModal] = useState<NewContractModalState | null>(null);
  const [newStageModal, setNewStageModal] = useState<NewStageModalState | null>(null);
  const [editMilestoneModal, setEditMilestoneModal] = useState<EditMilestoneModalState | null>(null);
  const [pdfViewer, setPdfViewer] = useState<PdfViewerState | null>(null);
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
      setSelectedId((current) => {
        if (current && json.groups.some((g) => g.contracts.some((c) => c.contractId === current))) return current;
        return null;
      });
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
    <div className="flex flex-col gap-6 p-2">
      <section className="glass-panel p-8 rounded-3xl relative overflow-hidden reveal">
        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-stone-800 mb-2 flex items-center gap-3">
              <FileSignature className="w-7 h-7 text-primary" />
              계약 관리
            </h1>
            <p className="text-stone-600 text-base max-w-3xl">
              엑셀 계약현황의 원장 구조를 웹으로 이전해 계약, 단계별 청구·수금, 세금계산서 PDF를 함께 관리합니다.
              상세 패널에서 청구·수금 단계 관리와 변경계약 입력이 가능합니다.
            </p>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={() => setNewContractModal(createEmptyContractState())}
              className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary hover:bg-primary/90 shadow-sm flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              신규 계약
            </button>
            <button
              type="button"
              onClick={reloadTree}
              className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700 flex items-center gap-1"
            >
              <RefreshCw className={"w-3 h-3 " + (loading ? "animate-spin" : "")} />
              새로고침
            </button>
            <Link
              href="/contracts/dashboard"
              className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary hover:bg-primary/90 shadow-sm flex items-center gap-1"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Dashboard
            </Link>
          </div>
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
      </section>

      {error ? (
        <div className="glass-card rounded-2xl p-6 text-sm text-rose-600">
          계약 데이터를 불러오지 못했습니다. <code>infra/aws/005_contract_management_round2.sql</code> 적용 여부와 DB 연결을 확인하세요.
          <div className="mt-2 font-mono text-xs text-stone-600">{error}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(360px,0.9fr)_minmax(560px,1.4fr)] gap-5">
          <section className="glass-card rounded-3xl overflow-hidden reveal delay-2">
            <div className="p-4 border-b border-stone-200/70 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-stone-800 flex items-center gap-2">
                  <WalletCards className="w-4 h-4 text-primary" />
                  계약 원장
                </h2>
                <p className="text-xs text-stone-500">총 {totalCount.toLocaleString()}건</p>
              </div>
            </div>
            <div className="px-4 py-3 border-b border-stone-200/70 flex items-center gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Search className="w-4 h-4 text-stone-400 shrink-0" />
                <input
                  type="text"
                  className="input-field text-xs"
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
                className="ui-select text-xs shrink-0"
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
            {filteredGroups.length === 0 && !loading ? (
              <div className="p-10 text-center text-sm text-stone-500">조건에 맞는 계약이 없습니다.</div>
            ) : (
              <Virtuoso
                style={{ height: 720 }}
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
            <div className="p-3 text-xs text-stone-500 text-right border-t border-stone-200/70">
              계약 건수: {tree?.totalCount.toLocaleString() ?? 0}
            </div>
          </section>

          <section className="glass-card rounded-3xl p-5 reveal delay-3 min-h-[720px]">
            {!selected ? (
              <div className="h-full flex items-center justify-center text-sm text-stone-500">계약을 선택하세요.</div>
            ) : detailLoading || !detail ? (
              <div className="h-full flex items-center justify-center text-sm text-stone-500">상세 정보를 불러오는 중입니다.</div>
            ) : (
              <ContractDetailPanel
                detail={detail}
                onOpenInvoice={setInvoiceModal}
                onOpenNewStage={() => setNewStageModal({ stageLabel: "", amount: "", paymentTerms: "" })}
                onOpenEditStage={setEditMilestoneModal}
                onOpenChange={() => setChangeModalOpen(true)}
                onOpenPdf={setPdfViewer}
                onDeleteStage={async (milestoneId) => {
                  if (!selected) return;
                  if (!confirm("해당 단계를 삭제하시겠습니까?")) return;
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
              />
            )}
          </section>
        </div>
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
          contractDate={selected.contractDate}
          initialMilestones={detail.milestones.map((m) => ({
            stageLabel: String(m.stage_label ?? ""),
            amount: Number(m.amount ?? 0),
            paymentTerms: String(m.payment_terms ?? ""),
          }))}
          initialServiceType={String(detail.contract.service_type ?? "") || ""}
          initialServiceSubtype={String(detail.contract.service_subtype ?? "") || ""}
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
  onOpenInvoice,
  onOpenNewStage,
  onOpenEditStage,
  onOpenChange,
  onOpenPdf,
  onDeleteStage,
}: {
  detail: ContractDetail;
  onOpenInvoice: (state: InvoiceModalState) => void;
  onOpenNewStage: () => void;
  onOpenEditStage: (state: EditMilestoneModalState) => void;
  onOpenChange: () => void;
  onOpenPdf: (state: PdfViewerState) => void;
  onDeleteStage: (milestoneId: string) => void;
}) {
  const contract = detail.contract;
  const baseAmount = Number(contract.current_amount ?? contract.contract_amount ?? 0);
  const collectedAmount = detail.milestones.reduce(
    (acc, m) => acc + Number(m.collected_amount ?? 0),
    0
  );
  const collectionRate = baseAmount > 0 ? Math.min(1, collectedAmount / baseAmount) : 0;
  const contractKindLabel = String(contract.contract_kind ?? "standard") === "unit_price" ? "단가 계약" : "일반 계약";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-stone-800">{String(contract.contract_title ?? "")}</h2>
          <p className="text-sm text-stone-500 mt-2">
            {String(contract.counterparty_name ?? "")} · 업체ID {String(contract.legacy_company_id ?? "-")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="glass-button rounded-xl px-3 py-2 text-xs text-stone-700 flex items-center gap-1"
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
            <FileText className="w-3.5 h-3.5" />
            계약서 보기
          </button>
          <button
            type="button"
            onClick={onOpenChange}
            className="rounded-xl px-3 py-2 text-xs text-white bg-primary hover:bg-primary/90 shadow-sm flex items-center gap-1"
          >
            <Pencil className="w-3.5 h-3.5" />
            변경계약 입력
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Info label="계약일" value={contract.contract_date ?? contract.started_at} />
        <Info
          label="계약금액"
          value={baseAmount ? formatExactAmount(baseAmount) : "-"}
          highlight
        />
        <Info label="업체명" value={contract.counterparty_name} />
        <Info label="계약 종류" value={contractKindLabel} />
        <Info label="용역분류" value={contract.service_type} />
        <Info label="용역세분류" value={contract.service_subtype} />
        <Info label="준공일" value={contract.ended_at} />
        <Info
          label="수금 진척도"
          value={`${Math.round(collectionRate * 100)}% (${formatExactAmount(collectedAmount)} / ${formatExactAmount(baseAmount)})`}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-stone-800">청구·수금 단계</h3>
          <button
            type="button"
            onClick={onOpenNewStage}
            className="rounded-lg px-3 py-1.5 text-xs text-white bg-primary hover:bg-primary/90 shadow-sm flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            단계 추가
          </button>
        </div>
        <div className="overflow-hidden rounded-2xl border border-stone-200/80">
          <table className="w-full text-xs">
            <thead className="bg-stone-100 text-stone-700 text-[11px]">
              <tr>
                <th className="text-left p-2.5">차수</th>
                <th className="text-left p-2.5">단계명</th>
                <th className="text-right p-2.5">청구금액</th>
                <th className="text-left p-2.5">대금 지급 조건</th>
                <th className="text-center p-2.5">발행일</th>
                <th className="text-center p-2.5">수금일</th>
                <th className="text-right p-2.5">수금비율</th>
                <th className="text-right p-2.5">수금금액</th>
                <th className="text-right p-2.5">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200/70">
              {detail.milestones.map((milestone, idx) => {
                const milestoneId = String(milestone.milestone_id ?? "");
                const stageAmount = Number(milestone.amount ?? 0);
                const collectionRatio = Number(milestone.collection_ratio ?? 0);
                const ratioLabel = collectionRatio > 0
                  ? `${Math.round(collectionRatio * 1000) / 10}%`
                  : Number(milestone.payment_collected ?? 0) === 1 ? "100%" : "-";
                return (
                  <tr key={milestoneId} className="bg-white/60">
                    <td className="p-2.5 font-mono text-stone-600">{idx + 1}</td>
                    <td className="p-2.5 text-stone-800">{String(milestone.stage_label ?? "")}</td>
                    <td className="p-2.5 text-right font-mono tabular-nums">{formatExactAmount(stageAmount)}</td>
                    <td className="p-2.5 text-stone-600 max-w-[220px] truncate" title={String(milestone.payment_terms ?? "")}>
                      {String(milestone.payment_terms ?? "-") || "-"}
                    </td>
                    <td className="p-2.5 text-center text-stone-600">{String(milestone.invoice_issued_at ?? "-") || "-"}</td>
                    <td className="p-2.5 text-center text-stone-600">{String(milestone.payment_collected_at ?? "-") || "-"}</td>
                    <td className="p-2.5 text-right font-mono">{ratioLabel}</td>
                    <td className="p-2.5 text-right font-mono tabular-nums">{formatExactAmount(milestone.collected_amount)}</td>
                    <td className="p-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1 text-[11px] text-white bg-primary hover:bg-primary/90 shadow-sm inline-flex items-center gap-1"
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
                              file: null,
                            })
                          }
                        >
                          <Paperclip className="w-3 h-3" />
                          발행/수금
                        </button>
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1 text-[11px] border border-stone-300 text-stone-700 hover:bg-stone-100"
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
                              invoiceFile: null,
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
              {detail.milestones.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-stone-500" colSpan={9}>
                    등록된 청구 단계가 없습니다. 우상단의 `단계 추가` 버튼으로 추가하세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="font-bold text-stone-800 mb-3">세금계산서 파일</h3>
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
              className="rounded-xl border border-stone-200/80 bg-white/60 px-3 py-2 text-sm hover:bg-primary/5 flex items-center justify-between gap-3"
            >
              <span>{title}</span>
              <span className="text-xs text-stone-500">{String(invoice.issue_date ?? "")}</span>
            </button>
          );
          })}
          {detail.invoices.length === 0 && <p className="text-sm text-stone-500">등록된 세금계산서 PDF가 없습니다.</p>}
        </div>
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

  const submit = async () => {
    if (!state.file) {
      toast.show("세금계산서 PDF 파일을 선택하세요.", "error");
      return;
    }
    setSaving(true);
    try {
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
      form.set("file", state.file);
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
          <span className="font-bold text-stone-700">계산서 발행일</span>
          <DateInput value={state.issueDate} onChange={(issueDate) => onChange({ ...state, issueDate })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold text-stone-700">발행금액</span>
          <input
            type="text"
            inputMode="numeric"
            className="input-field tabular-nums"
            value={formatThousands(state.invoiceAmount)}
            onChange={(e) => onChange({ ...state, invoiceAmount: stripDigits(e.target.value) })}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold text-stone-700">대금 지급 조건</span>
          <input type="text" className="input-field" placeholder="예: 세금계산서 발행 후 30일 이내 지급"
            value={state.paymentTerms} onChange={(e) => onChange({ ...state, paymentTerms: e.target.value })} />
        </label>
        <label className="grid gap-1 text-sm col-span-2">
          <span className="font-bold text-stone-700">계산서 PDF 첨부</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
            onChange={(e) => onChange({ ...state, file: e.target.files?.[0] ?? null })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-stone-700 col-span-2">
          <input type="checkbox" checked={state.paymentCollected} onChange={(e) => onChange({ ...state, paymentCollected: e.target.checked })} />
          수금 정보도 함께 등록
        </label>
        {state.paymentCollected && (
          <>
            <label className="grid gap-1 text-sm">
              <span className="font-bold text-stone-700">수금일</span>
              <DateInput value={state.paymentCollectedAt} onChange={(paymentCollectedAt) => onChange({ ...state, paymentCollectedAt })} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold text-stone-700">수금금액</span>
              <input
                type="text"
                inputMode="numeric"
                className="input-field tabular-nums"
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
              <span className="font-bold text-stone-700">부분입금 사유</span>
              <textarea
                className="input-field min-h-[84px]"
                placeholder="예: 업체 자금 사정으로 일부만 입금, 착오입금 후 잔액 추후 입금 예정 등"
                value={state.partialPaymentMemo}
                onChange={(e) => onChange({ ...state, partialPaymentMemo: e.target.value })}
              />
            </label>
          </>
        )}
        <p className="text-xs text-stone-500 col-span-2">
          저장 경로는 발행일 기준 <code>매출계산서/년도/분기</code> 논리 경로로 생성됩니다.
        </p>
      </div>
      <div className="p-5 pt-0 border-t border-stone-200/70 flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="glass-button rounded-xl px-4 py-2 text-sm font-bold text-stone-700">닫기</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 shadow-sm disabled:opacity-60">
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
  const [tab, setTab] = useState<"basic" | "milestones" | "document">("basic");
  const [entityOptions, setEntityOptions] = useState<LegalEntitySearchItem[]>([]);

  useEffect(() => {
    const q = state.counterpartyQuery.trim();
    if (q.length < 2) {
      setEntityOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/legal-entities?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: LegalEntitySearchItem[] };
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

  const updateMilestone = (id: string, patch: Partial<ContractMilestoneDraft>) => {
    onChange({
      ...state,
      milestones: state.milestones.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
  };

  const submit = async () => {
    if (!state.contractTitle.trim()) {
      toast.show("계약명을 입력하세요.", "error");
      setTab("basic");
      return;
    }
    if (!state.counterpartyEntityId) {
      toast.show("계약상대 업체를 선택하세요.", "error");
      setTab("basic");
      return;
    }
    if (!state.contractDate) {
      toast.show("계약일을 입력하세요.", "error");
      setTab("basic");
      return;
    }
    const validMilestones = state.milestones.filter((m) => m.stageLabel.trim());
    setSaving(true);
    try {
      const createRes = await fetch("/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractTitle: state.contractTitle,
          counterpartyEntityId: state.counterpartyEntityId,
          serviceType: state.serviceType || null,
          serviceSubtype: state.serviceSubtype || null,
          contractKind: state.contractKind,
          contractDate: state.contractDate,
          startedAt: state.startedAt || state.contractDate,
          endedAt: state.endedAt || null,
          contractAmount: state.currentAmount ? Number(state.currentAmount) : null,
          originalAmount: state.currentAmount ? Number(state.currentAmount) : null,
          currentAmount: state.currentAmount ? Number(state.currentAmount) : null,
          memo: state.memo || null,
        }),
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + createRes.status);
      }
      const { contractId } = (await createRes.json()) as { contractId: string };

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

      if (state.documentFile) {
        const form = new FormData();
        form.set("documentType", "contract");
        form.set("documentDate", state.contractDate);
        form.set("file", state.documentFile);
        const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/documents`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error ?? "계약서 업로드 실패");
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
      <div className="border-b border-stone-200/70 px-5 pt-4 flex gap-2">
        {[
          ["basic", "계약 상세정보"],
          ["milestones", "청구·수금 단계"],
          ["document", "계약서 PDF"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key as typeof tab)}
            className={
              "rounded-t-xl px-3 py-2 text-xs border border-b-0 " +
              (tab === key ? "bg-white text-primary border-primary/30" : "bg-stone-50 text-stone-500 border-stone-200")
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
              <span className="font-bold text-stone-700">계약명</span>
              <input className="input-field" value={state.contractTitle} onChange={(e) => onChange({ ...state, contractTitle: e.target.value })} />
            </label>
            <label className="grid gap-1 text-sm col-span-2 relative">
              <span className="font-bold text-stone-700">계약상대 업체</span>
              <input
                className="input-field"
                placeholder="업체명 또는 사업자번호 검색"
                value={state.counterpartyQuery}
                onChange={(e) => onChange({ ...state, counterpartyQuery: e.target.value, counterpartyEntityId: "", counterpartyName: "" })}
              />
              {state.counterpartyName && <p className="text-xs text-primary">선택됨: {state.counterpartyName}</p>}
              {entityOptions.length > 0 && !state.counterpartyEntityId && (
                <div className="absolute z-10 top-[70px] left-0 right-0 rounded-xl border border-stone-200 bg-white shadow-lg max-h-56 overflow-y-auto">
                  {entityOptions.map((entity) => (
                    <button
                      key={entity.entityId}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-primary/5"
                      onClick={() =>
                        onChange({
                          ...state,
                          counterpartyEntityId: entity.entityId,
                          counterpartyName: entity.entityName,
                          counterpartyQuery: entity.entityName,
                        })
                      }
                    >
                      <span className="text-stone-800">{entity.entityName}</span>
                      <span className="ml-2 text-xs text-stone-400">{entity.businessRegistrationNo ?? ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold text-stone-700">용역분류</span>
              <input className="input-field" value={state.serviceType} onChange={(e) => onChange({ ...state, serviceType: e.target.value })} placeholder="예: 통합허가" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold text-stone-700">용역세분류</span>
              <input className="input-field" value={state.serviceSubtype} onChange={(e) => onChange({ ...state, serviceSubtype: e.target.value })} placeholder="예: 변경허가" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold text-stone-700">계약 종류</span>
              <select className="ui-select" value={state.contractKind} onChange={(e) => onChange({ ...state, contractKind: e.target.value as "standard" | "unit_price" })}>
                <option value="standard">일반 계약</option>
                <option value="unit_price">단가 계약</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold text-stone-700">계약금액</span>
              <input className="input-field tabular-nums" inputMode="numeric" value={formatThousands(state.currentAmount)} onChange={(e) => onChange({ ...state, currentAmount: stripDigits(e.target.value) })} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold text-stone-700">계약일</span>
              <DateInput value={state.contractDate} onChange={(contractDate) => onChange({ ...state, contractDate, startedAt: state.startedAt || contractDate })} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold text-stone-700">준공일</span>
              <DateInput value={state.endedAt} onChange={(endedAt) => onChange({ ...state, endedAt })} />
            </label>
            <label className="grid gap-1 text-sm col-span-2">
              <span className="font-bold text-stone-700">메모</span>
              <textarea className="input-field min-h-[90px]" value={state.memo} onChange={(e) => onChange({ ...state, memo: e.target.value })} />
            </label>
          </div>
        )}

        {tab === "milestones" && (
          <div className="grid gap-3">
            {state.milestones.map((m, idx) => (
              <div key={m.id} className="grid grid-cols-[56px_1fr_150px_1.2fr_40px] gap-2 items-end rounded-2xl border border-stone-200 bg-white/60 p-3">
                <div className="text-xs text-stone-500 pb-2">{idx + 1}차</div>
                <label className="grid gap-1 text-xs">
                  <span className="text-stone-500">단계명</span>
                  <input className="input-field" value={m.stageLabel} onChange={(e) => updateMilestone(m.id, { stageLabel: e.target.value })} placeholder="선급금 / 중도금1 / 준공금" />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-stone-500">청구금액</span>
                  <input className="input-field tabular-nums" inputMode="numeric" value={formatThousands(m.amount)} onChange={(e) => updateMilestone(m.id, { amount: stripDigits(e.target.value) })} />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-stone-500">대금 지급 조건</span>
                  <input className="input-field" value={m.paymentTerms} onChange={(e) => updateMilestone(m.id, { paymentTerms: e.target.value })} placeholder="세금계산서 발행 후 30일 이내" />
                </label>
                <button type="button" className="rounded-lg p-2 text-rose-600 hover:bg-rose-50" onClick={() => onChange({ ...state, milestones: state.milestones.filter((item) => item.id !== m.id) })}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="glass-button rounded-xl px-3 py-2 text-sm text-stone-700 inline-flex items-center gap-2 justify-center"
              onClick={() => onChange({ ...state, milestones: [...state.milestones, createMilestoneDraft()] })}
            >
              <Plus className="w-4 h-4" />
              단계 추가
            </button>
          </div>
        )}

        {tab === "document" && (
          <div className="grid gap-4">
            <label className="grid gap-1 text-sm">
              <span className="font-bold text-stone-700">계약서 PDF 첨부</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
                onChange={(e) => onChange({ ...state, documentFile: e.target.files?.[0] ?? null })}
              />
            </label>
            <p className="text-xs text-stone-500">
              저장 경로는 계약일 기준 <code>매출계약서/년도/(계약일) 계약명</code> 논리 경로로 생성됩니다.
            </p>
          </div>
        )}
      </div>

      <div className="p-5 pt-0 border-t border-stone-200/70 flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="glass-button rounded-xl px-4 py-2 text-sm font-bold text-stone-700">닫기</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 shadow-sm disabled:opacity-60">
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

  const submit = async () => {
    setSaving(true);
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
            partialPaymentMemo: state.paymentCollected && !state.invoiceFile ? state.partialPaymentMemo : undefined,
          }),
        }
      );
      if (!patchRes.ok) {
        const body = await patchRes.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + patchRes.status);
      }

      if (state.invoiceFile) {
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
        form.set("file", state.invoiceFile);
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
          <span className="font-bold text-stone-700">단계명</span>
          <input className="input-field" value={state.stageLabel} onChange={(e) => onChange({ ...state, stageLabel: e.target.value })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold text-stone-700">청구금액</span>
          <input className="input-field tabular-nums" inputMode="numeric" value={formatThousands(state.amount)} onChange={(e) => onChange({ ...state, amount: stripDigits(e.target.value) })} />
        </label>
        <label className="grid gap-1 text-sm col-span-2">
          <span className="font-bold text-stone-700">대금 지급 조건</span>
          <input className="input-field" value={state.paymentTerms} onChange={(e) => onChange({ ...state, paymentTerms: e.target.value })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold text-stone-700">계산서 발행일</span>
          <DateInput value={state.issueDate} onChange={(issueDate) => onChange({ ...state, issueDate })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold text-stone-700">계산서 발행금액</span>
          <input className="input-field tabular-nums" inputMode="numeric" value={formatThousands(state.invoiceAmount)} onChange={(e) => onChange({ ...state, invoiceAmount: stripDigits(e.target.value) })} />
        </label>
        <label className="grid gap-1 text-sm col-span-2">
          <span className="font-bold text-stone-700">세금계산서 교체 PDF</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
            onChange={(e) => onChange({ ...state, invoiceFile: e.target.files?.[0] ?? null })}
          />
          <span className="text-xs text-stone-500">파일을 선택하면 새 계산서 PDF가 같은 단계의 최신 계산서로 추가 등록됩니다.</span>
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-stone-700 col-span-2">
          <input type="checkbox" checked={state.paymentCollected} onChange={(e) => onChange({ ...state, paymentCollected: e.target.checked })} />
          수금 정보 등록
        </label>
        {state.paymentCollected && (
          <>
            <label className="grid gap-1 text-sm">
              <span className="font-bold text-stone-700">수금일</span>
              <DateInput value={state.paymentCollectedAt} onChange={(paymentCollectedAt) => onChange({ ...state, paymentCollectedAt })} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-bold text-stone-700">수금금액</span>
              <input
                className="input-field tabular-nums"
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
              <span className="font-bold text-stone-700">부분입금 사유</span>
              <textarea className="input-field min-h-[84px]" value={state.partialPaymentMemo} onChange={(e) => onChange({ ...state, partialPaymentMemo: e.target.value })} />
            </label>
          </>
        )}
      </div>
      <div className="p-5 pt-0 border-t border-stone-200/70 flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="glass-button rounded-xl px-4 py-2 text-sm font-bold text-stone-700">닫기</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 shadow-sm disabled:opacity-60">
          {saving ? "저장 중..." : "수정"}
        </button>
      </div>
    </ModalShell>
  );
}

function NewStageModal({
  contractId,
  state,
  onChange,
  onClose,
  onSaved,
}: {
  contractId: string;
  state: NewStageModalState;
  onChange: (state: NewStageModalState) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

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
          <span className="font-bold text-stone-700">단계명</span>
          <input type="text" className="input-field" placeholder="예: 1차 기성금"
            value={state.stageLabel} onChange={(e) => onChange({ ...state, stageLabel: e.target.value })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold text-stone-700">청구금액</span>
          <input type="number" className="input-field" value={state.amount} onChange={(e) => onChange({ ...state, amount: e.target.value })} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-bold text-stone-700">대금 지급 조건</span>
          <input type="text" className="input-field" placeholder="예: 세금계산서 발행 후 30일 이내 지급"
            value={state.paymentTerms} onChange={(e) => onChange({ ...state, paymentTerms: e.target.value })} />
        </label>
      </div>
      <div className="p-5 pt-0 border-t border-stone-200/70 flex justify-end gap-2 mt-2">
        <button type="button" onClick={onClose} className="glass-button rounded-xl px-4 py-2 text-sm font-bold text-stone-700">닫기</button>
        <button type="button" onClick={submit} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 shadow-sm disabled:opacity-60">
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
      : Math.max(24, Math.round((window.innerWidth - Math.min(980, window.innerWidth - 48)) / 2)),
    y: 72,
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
    const width = Math.min(980, window.innerWidth - 48);
    const height = Math.min(760, window.innerHeight - 48);
    setPosition({
      x: Math.min(Math.max(12, event.clientX - dragOffset.current.x), Math.max(12, window.innerWidth - width - 12)),
      y: Math.min(Math.max(12, event.clientY - dragOffset.current.y), Math.max(12, window.innerHeight - height - 12)),
    });
  };

  const stopDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      className="fixed z-[60] rounded-3xl border border-stone-200 bg-white shadow-2xl overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: "min(980px, calc(100vw - 48px))",
        height: "min(760px, calc(100vh - 48px))",
      }}
    >
      <div
        className="h-12 px-4 border-b border-stone-200 bg-stone-50 flex items-center justify-between gap-3 cursor-move select-none"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <div className="min-w-0 flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm text-stone-800 truncate">{title}</span>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="rounded-lg p-1 text-stone-500 hover:bg-stone-200 hover:text-stone-800"
          title="닫기"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <iframe
        title={title}
        src={url}
        className="w-full h-[calc(100%-48px)] bg-stone-100"
      />
    </div>
  );
}

function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 bg-stone-950/20 flex items-center justify-center p-4">
      <div className={"glass-panel rounded-3xl max-h-[min(840px,calc(100vh-32px))] shadow-2xl overflow-hidden flex flex-col " + (wide ? "w-[min(960px,calc(100vw-32px))]" : "w-[min(640px,calc(100vw-32px))]")}>
        <div className="p-5 border-b border-stone-200/70 flex items-start justify-between gap-3">
          <h3 className="text-xl font-bold text-stone-800">{title}</h3>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto scrollbar-hide">{children}</div>
      </div>
    </div>
  );
}

function Info({ label, value, highlight }: { label: string; value: unknown; highlight?: boolean }) {
  return (
    <div className={"rounded-2xl border p-3 " + (highlight ? "bg-primary/5 border-primary/30" : "bg-white/60 border-stone-200/80")}>
      <p className="text-[11px] text-stone-500">{label}</p>
      <p className={"text-sm mt-1 truncate " + (highlight ? "text-primary" : "text-stone-800")}>
        {value == null || value === "" ? "-" : String(value)}
      </p>
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
      className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-stone-50 border-b border-stone-200/70"
    >
      {isOpen ? (
        <ChevronDown className="w-4 h-4 text-stone-500" />
      ) : (
        <ChevronRight className="w-4 h-4 text-stone-500" />
      )}
      <ParentIcon
        className="w-4 h-4 fill-current transition-transform"
        style={{ color: style.parentColor }}
      />
      <span className="text-sm text-stone-800">{serviceType}</span>
      <span className="text-[11px] text-stone-500 ml-auto">{count}건</span>
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
      <span
        aria-hidden
        className="pointer-events-none absolute left-7 top-1/2 w-3 h-px bg-stone-300"
      />
      <ChildIcon
        className="w-3.5 h-3.5 fill-current shrink-0"
        style={{ color: childColor }}
      />
      <span className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="truncate text-stone-800">{contract.contractTitle}</span>
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
});

function DateInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const displayValue = value ? value.replace(/-/g, "") : "";
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        inputMode="numeric"
        maxLength={8}
        className="input-field tabular-nums"
        placeholder="YYYYMMDD"
        value={displayValue}
        onChange={(e) => onChange(normalizeDateInput(e.target.value))}
      />
      <input
        type="date"
        className="ui-select w-[48px] px-2 text-transparent"
        value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        title="달력에서 선택"
      />
    </div>
  );
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

function createMilestoneDraft(): ContractMilestoneDraft {
  return {
    id: "draft_" + Math.random().toString(36).slice(2),
    stageLabel: "",
    amount: "",
    paymentTerms: "",
  };
}

function createEmptyContractState(): NewContractModalState {
  return {
    contractTitle: "",
    counterpartyQuery: "",
    counterpartyEntityId: "",
    counterpartyName: "",
    serviceType: "",
    serviceSubtype: "",
    contractKind: "standard",
    contractDate: new Date().toISOString().slice(0, 10),
    startedAt: "",
    endedAt: "",
    currentAmount: "",
    memo: "",
    milestones: [
      { ...createMilestoneDraft(), stageLabel: "선급금" },
      { ...createMilestoneDraft(), stageLabel: "준공금" },
    ],
    documentFile: null,
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

/**
 * Render a numeric amount with thousands separators for currency input fields
 * (e.g. `53000000` -> `53,000,000`). Returns "" for empty/non-numeric input
 * so that placeholders still show up in the form.
 */
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
