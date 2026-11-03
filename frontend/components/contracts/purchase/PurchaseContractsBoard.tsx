"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Virtuoso } from "react-virtuoso";
import { Plus, RefreshCw, Search, ShoppingCart } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { hasPerm, permsOf } from "@/lib/auth/perms";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";
import { TreeChildRow, TreeGroupHeader, type TreeFlatRow } from "@/components/contracts/ContractTreeRows";
import { DraggablePdfViewer, type PdfViewerDoc } from "@/components/contracts/DraggablePdfViewer";
import { PURCHASE_TYPE_STYLE } from "@/lib/contracts/purchase/options";
import type { PurchaseContractDetail, PurchaseTreeNode, PurchaseTreePayload } from "@/lib/contracts/purchase/types";
import { purchaseApi, purchaseJson } from "@/lib/contracts/purchase/client";
import { PurchaseContractDetailPanel } from "./PurchaseContractDetailPanel";
import { NewPurchaseContractModal } from "./NewPurchaseContractModal";
import { PurchaseChangeModal } from "./PurchaseChangeModal";
import { PurchaseStageModal } from "./PurchaseStageModal";
import { InvoiceCandidateModal } from "./InvoiceCandidateModal";
import { PurchaseDeleteModal } from "./PurchaseDeleteModal";

interface PdfViewerState {
  title: string;
  url: string;
  docs?: PdfViewerDoc[];
  initialIndex?: number;
}

/**
 * 매입 계약 원장(331) — 매출 계약 관리(app/(app)/contracts/page.tsx ContractsInner)와 같은 좌 트리·우 상세 배치.
 * 부모 노드는 계약 유형 4종(외주·구독·임대·관리)이고 아이콘 색만 PURCHASE_TYPE_STYLE 로 다르다.
 */
export function PurchaseContractsBoard() {
  const toast = useToast();
  const { data: session } = useSession();
  const perms = permsOf(session?.user);
  const canEdit = hasPerm(perms, "purchase.edit");
  const canDelete = hasPerm(perms, "purchase.delete");
  const { theme } = useCdashTheme();
  const searchParams = useSearchParams();
  const pendingContractRef = useRef<string | null>(searchParams.get("contract"));
  const [tree, setTree] = useState<PurchaseTreePayload | null>(null);
  const [year, setYear] = useState<string>(() => {
    const fromQuery = searchParams.get("year");
    return fromQuery && /^\d{4}$/.test(fromQuery) ? fromQuery : String(new Date().getFullYear());
  });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [, startSearchTransition] = useTransition();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PurchaseContractDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [stageModal, setStageModal] = useState<{ milestone: Record<string, unknown> | null } | null>(null);
  const [candidateTarget, setCandidateTarget] = useState<Record<string, unknown> | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [pdfViewer, setPdfViewer] = useState<PdfViewerState | null>(null);

  const reloadTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (year) params.set("year", year);
      const json = await purchaseApi<PurchaseTreePayload>("/api/purchase-contracts/tree?" + params.toString());
      setTree(json);
      setExpanded((prev) => {
        const next = { ...prev };
        for (const group of json.groups) if (next[group.contractType] === undefined) next[group.contractType] = false;
        return next;
      });
      const pending = pendingContractRef.current;
      const pendingGroup = pending ? json.groups.find((g) => g.contracts.some((c) => c.purchaseContractId === pending)) : undefined;
      if (pending && pendingGroup) {
        pendingContractRef.current = null;
        setExpanded(() => {
          const next: Record<string, boolean> = {};
          for (const group of json.groups) next[group.contractType] = group.contractType === pendingGroup.contractType;
          return next;
        });
        setSelectedId(pending);
      } else {
        setSelectedId((current) => (current && json.groups.some((g) => g.contracts.some((c) => c.purchaseContractId === current)) ? current : null));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [year]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      try {
        setDetail(await purchaseApi<PurchaseContractDetail>("/api/purchase-contracts/" + encodeURIComponent(id)));
      } catch (err) {
        toast.show("상세 조회 실패: " + (err as Error).message, "error");
      } finally {
        setDetailLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    reloadTree();
  }, [reloadTree]);
  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const refreshAll = useCallback(() => {
    reloadTree();
    if (selectedId) loadDetail(selectedId);
  }, [reloadTree, loadDetail, selectedId]);

  const selectContract = useCallback((id: string) => setSelectedId(id), []);
  const toggleGroup = useCallback((key: string) => {
    setExpanded((prev) => {
      const wasOpen = prev[key] === true;
      const next: Record<string, boolean> = {};
      for (const k of Object.keys(prev)) next[k] = false;
      next[key] = !wasOpen;
      return next;
    });
  }, []);

  const filteredGroups = useMemo(() => {
    if (!tree) return [];
    const q = search.trim().toLowerCase();
    if (!q) return tree.groups;
    return tree.groups
      .map((group) => ({
        ...group,
        contracts: group.contracts.filter(
          (c) =>
            c.contractTitle.toLowerCase().includes(q) ||
            c.counterpartyName.toLowerCase().includes(q) ||
            c.contractCategory.toLowerCase().includes(q)
        ),
      }))
      .filter((group) => group.contracts.length > 0);
  }, [tree, search]);

  const totalCount = useMemo(() => filteredGroups.reduce((acc, g) => acc + g.contracts.length, 0), [filteredGroups]);

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

  const flatRows = useMemo<TreeFlatRow<PurchaseTreeNode>[]>(() => {
    const rows: TreeFlatRow<PurchaseTreeNode>[] = [];
    for (const group of filteredGroups) {
      const style = PURCHASE_TYPE_STYLE[group.contractType];
      const isOpen = expanded[group.contractType] === true;
      rows.push({ kind: "group", groupKey: group.contractType, label: group.label, count: group.contracts.length, isOpen, style });
      if (isOpen) {
        for (let i = 0; i < group.contracts.length; i++) {
          rows.push({ kind: "child", contract: group.contracts[i], isLastChild: i === group.contracts.length - 1, style });
        }
      }
    }
    return rows;
  }, [filteredGroups, expanded]);
  const deferredFlatRows = useDeferredValue(flatRows);

  const selectedTitle = detail ? String(detail.contract.contract_title ?? "") : "";

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-lg" data-theme={theme}>
      <CdPageHeader
        icon={<ShoppingCart className="w-5 h-5" />}
        eyebrow="Contract · Purchase Ledger"
        title="매입 계약 관리"
        helpTopic="purchase.ledger"
        help="계약 유형(외주·정기 구독·임대·관리)을 펼쳐 매입 계약을 선택하면 오른쪽에 계약 정보와 청구·수금 단계(세금계산서 수취·대금 지급)가 표시됩니다."
        actions={
          <>
            {canEdit && (
              <button type="button" onClick={() => setNewModalOpen(true)} className="cd-btn cd-btn-primary cd-btn-sm">
                <Plus className="w-3.5 h-3.5" />
                신규 계약
              </button>
            )}
            <button type="button" onClick={refreshAll} className="cd-btn cd-btn-ghost cd-btn-sm">
              <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
              새로고침
            </button>
          </>
        }
      />

      {error ? (
        <div className="cd-card rounded-lg p-6 text-sm cd-error-text">
          매입 계약 데이터를 불러오지 못했습니다. <code>infra/aws/331_purchase_contracts.sql</code> 적용 여부와 권한(purchase.view)을 확인하세요.
          <div className="mt-2 font-mono text-xs cd-text-muted">{error}</div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(360px,0.9fr)_minmax(560px,1.4fr)] gap-5">
          <section className="cd-card rounded-lg overflow-hidden cd-reveal delay-2 flex min-h-0 flex-col">
            <div className="p-4 border-b cd-border-c flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold cd-text flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 cd-text-primary" />
                  매입 계약 원장
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
                  placeholder="계약명 / 업체 / 분류 검색"
                  value={searchInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSearchInput(value);
                    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                    searchDebounceRef.current = setTimeout(() => startSearchTransition(() => setSearch(value)), 180);
                  }}
                />
              </div>
              <select className="cd-select text-xs shrink-0" style={{ width: "17ch" }} value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">전체 연도</option>
                {(tree?.availableYears ?? []).map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-h-0">
              {filteredGroups.length === 0 && !loading ? (
                <div className="h-full p-10 text-center text-sm cd-text-faint">조건에 맞는 매입 계약이 없습니다.</div>
              ) : (
                <Virtuoso
                  style={{ height: "100%", minHeight: 0 }}
                  data={deferredFlatRows}
                  increaseViewportBy={400}
                  computeItemKey={(_, row) => (row.kind === "group" ? "g:" + row.groupKey : "c:" + row.contract.purchaseContractId)}
                  itemContent={(_, row) =>
                    row.kind === "group" ? (
                      <TreeGroupHeader groupKey={row.groupKey} label={row.label} count={row.count} isOpen={row.isOpen} style={row.style} onToggle={toggleGroup} />
                    ) : (
                      <TreeChildRow
                        nodeId={row.contract.purchaseContractId}
                        title={row.contract.contractTitle}
                        contractDate={row.contract.contractDate}
                        currentAmount={row.contract.currentAmount}
                        contractStatus={row.contract.contractStatus}
                        isFullyCollected={row.contract.isFullyPaid}
                        fullyCollectedLabel="지급 완료"
                        isSelected={row.contract.purchaseContractId === selectedId}
                        isLastChild={row.isLastChild}
                        childColor={row.style.childColor}
                        onSelect={selectContract}
                      />
                    )
                  }
                />
              )}
            </div>
            <div className="p-3 text-xs cd-text-faint border-t cd-border-c flex items-center gap-3 flex-wrap">
              <span>계약 건수: {treeStats.total.toLocaleString()}</span>
              <span>진행: {treeStats.active.toLocaleString()}</span>
              <span>지급 완료: {treeStats.completed.toLocaleString()}</span>
              {treeStats.suspended > 0 && <span>중지: {treeStats.suspended.toLocaleString()}</span>}
              {treeStats.terminated > 0 && <span>해지: {treeStats.terminated.toLocaleString()}</span>}
            </div>
          </section>

          <section className="cd-card rounded-lg p-5 cd-reveal delay-3 min-h-0 overflow-y-auto scrollbar-hide">
            {!selectedId ? (
              <div className="h-full flex items-center justify-center text-sm cd-text-faint">매입 계약을 선택하세요.</div>
            ) : detailLoading || !detail ? (
              <div className="h-full flex items-center justify-center text-sm cd-text-faint">상세 정보를 불러오는 중입니다.</div>
            ) : (
              <PurchaseContractDetailPanel
                detail={detail}
                canEdit={canEdit}
                canDelete={canDelete}
                onEditContract={() => setEditModalOpen(true)}
                onOpenNewStage={() => setStageModal({ milestone: null })}
                onOpenEditStage={(milestone) => setStageModal({ milestone })}
                onOpenCandidates={(milestone) => setCandidateTarget(milestone)}
                onOpenPdf={setPdfViewer}
                onDeleteContract={() => setDeleteModalOpen(true)}
                onDeleteStage={async (milestoneId) => {
                  if (!confirm("해당 청구·수금 단계를 삭제할까요? 연결한 계산서 기록도 함께 지워집니다.")) return;
                  try {
                    await purchaseApi(`/api/purchase-contracts/${encodeURIComponent(selectedId)}/milestones/${encodeURIComponent(milestoneId)}`, { method: "DELETE" });
                    toast.show("단계가 삭제되었습니다.", "success");
                    refreshAll();
                  } catch (err) {
                    toast.show("삭제 실패: " + (err as Error).message, "error");
                  }
                }}
                onReorderStages={async (orderedIds) => {
                  try {
                    await purchaseApi(`/api/purchase-contracts/${encodeURIComponent(selectedId)}/milestones/reorder`, { method: "POST", ...purchaseJson({ order: orderedIds }) });
                    loadDetail(selectedId);
                  } catch (err) {
                    toast.show("순서 변경 실패: " + (err as Error).message, "error");
                  }
                }}
                onDeleteDocument={async (documentId, title) => {
                  if (!confirm(`'${title}' 파일을 삭제할까요? 휴지통 없이 즉시 삭제됩니다.`)) return;
                  try {
                    await purchaseApi(`/api/purchase-contracts/${encodeURIComponent(selectedId)}/documents?documentId=${encodeURIComponent(documentId)}`, { method: "DELETE" });
                    toast.show("문서를 삭제했습니다.", "success");
                    loadDetail(selectedId);
                  } catch (err) {
                    toast.show("삭제 실패: " + (err as Error).message, "error");
                  }
                }}
              />
            )}
          </section>
        </div>
      )}

      {newModalOpen && (
        <NewPurchaseContractModal
          onClose={() => setNewModalOpen(false)}
          onSaved={(id) => {
            setNewModalOpen(false);
            pendingContractRef.current = id;
            reloadTree();
          }}
        />
      )}
      {editModalOpen && detail && (
        <PurchaseChangeModal
          detail={detail}
          onOpenPdf={setPdfViewer}
          onClose={() => setEditModalOpen(false)}
          onSaved={() => {
            setEditModalOpen(false);
            refreshAll();
          }}
        />
      )}
      {stageModal && selectedId && (
        <PurchaseStageModal
          purchaseContractId={selectedId}
          milestone={stageModal.milestone}
          onClose={() => setStageModal(null)}
          onSaved={() => {
            setStageModal(null);
            refreshAll();
          }}
          onOpenCandidates={(milestone) => {
            setStageModal(null);
            setCandidateTarget(milestone);
          }}
        />
      )}
      {candidateTarget && selectedId && (
        <InvoiceCandidateModal
          purchaseContractId={selectedId}
          milestone={candidateTarget}
          onClose={() => setCandidateTarget(null)}
          onLinked={() => {
            setCandidateTarget(null);
            refreshAll();
          }}
        />
      )}
      {deleteModalOpen && selectedId && (
        <PurchaseDeleteModal
          contractTitle={selectedTitle}
          onClose={() => setDeleteModalOpen(false)}
          onConfirm={async (reason) => {
            try {
              await purchaseApi(`/api/purchase-contracts/${encodeURIComponent(selectedId)}`, { method: "DELETE", ...purchaseJson({ reason }) });
              toast.show("매입 계약을 삭제했습니다.", "success");
              setDeleteModalOpen(false);
              setSelectedId(null);
              reloadTree();
            } catch (err) {
              toast.show("삭제 실패: " + (err as Error).message, "error");
            }
          }}
        />
      )}
      {pdfViewer && (
        <DraggablePdfViewer title={pdfViewer.title} url={pdfViewer.url} docs={pdfViewer.docs} initialIndex={pdfViewer.initialIndex} onClose={() => setPdfViewer(null)} />
      )}
    </div>
  );
}
