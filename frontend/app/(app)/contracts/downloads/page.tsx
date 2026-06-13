"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Archive, BadgeCheck, CheckSquare, ChevronDown, ChevronRight, Download, FileArchive, FileText, ListChecks, Search, Users } from "lucide-react";
import { resolveServiceTypeStyle } from "@/lib/ieps/contract-tree-style";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";

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
  totalCount: number;
  availableYears: string[];
  groups: ContractTreeServiceGroup[];
}

interface ContractDetail {
  contract: Record<string, unknown>;
  milestones: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
}

type Scope =
  | { kind: "all" }
  | { kind: "contract" }
  | { kind: "amendment" }
  | { kind: "invoice"; milestoneId: string };

type SingleMode = "individualZip" | "mergedSingle";
type MultiMode = "perContractMergedZip" | "mergedAll";

const INTEGRATED_PERMIT_INDUSTRIES = [
  { label: "발전", keywords: ["발전", "화력", "기타 발전", "증기", "냉온수"] },
  { label: "폐기물소각", keywords: ["폐기물소각", "소각"] },
  { label: "철강", keywords: ["철강", "1차 철강"] },
  { label: "비철", keywords: ["비철", "비철금속"] },
  { label: "유기", keywords: ["유기", "석유화학계", "기초 유기"] },
  { label: "석유정제", keywords: ["석유정제", "석유 정제품"] },
  { label: "무기화학", keywords: ["무기화학", "무기 화학", "무기안료", "금속 산화물"] },
  { label: "정밀화학", keywords: ["정밀화학", "합성염료", "농업용 약제", "도료", "계면활성제", "화장품", "접착제", "화약", "세제"] },
  { label: "비료및질소화합물", keywords: ["비료", "질소화합물"] },
  { label: "펄프종이및판지", keywords: ["펄프", "종이", "판지"] },
  { label: "전자부품", keywords: ["전자부품", "회로기판", "평판"] },
  { label: "반도체", keywords: ["반도체"] },
  { label: "섬유염색및가공처리업", keywords: ["섬유", "염색", "마무리 가공"] },
  { label: "도축육류가공및저장처리업", keywords: ["도축", "육류가공", "저장처리"] },
  { label: "알콜음료제조업", keywords: ["알콜", "알코올", "주류", "음료 제조"] },
  { label: "플라스틱제품제조업", keywords: ["플라스틱"] },
  { label: "자동차부품제조업", keywords: ["자동차부품", "자동차 부품"] },
  { label: "폐기물처리업", keywords: ["폐기물 처리", "지정 폐기물"] },
  { label: "시멘트 제조업", keywords: ["시멘트"] },
  { label: "이차전지 제조업", keywords: ["이차전지", "2차전지", "축전지", "배터리"] },
];

export default function ContractDownloadsPage() {
  const { theme, toggleTheme } = useCdashTheme();
  const [tree, setTree] = useState<ContractTreePayload | null>(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [search, setSearch] = useState("");
  const [serviceTypeFilter, setServiceTypeFilter] = useState("");
  const [serviceSubtypeFilter, setServiceSubtypeFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [singleMode, setSingleMode] = useState<SingleMode>("individualZip");
  const [multiMode, setMultiMode] = useState<MultiMode>("perContractMergedZip");
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; contractId: string } | null>(null);

  const reloadTree = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (year) params.set("year", year);
      const res = await fetch("/api/contracts/tree?" + params.toString(), { cache: "no-store" });
      const json = (await res.json()) as ContractTreePayload;
      setTree(json);
      setExpanded((prev) => {
        const next = { ...prev };
        for (const group of json.groups) if (next[group.serviceType] === undefined) next[group.serviceType] = false;
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    reloadTree();
  }, [reloadTree]);

  const activeSingleId = useMemo(() => {
    if (checked.size === 1) return Array.from(checked)[0];
    return selectedId;
  }, [checked, selectedId]);

  useEffect(() => {
    if (!activeSingleId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    fetch("/api/contracts/" + encodeURIComponent(activeSingleId), { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled) setDetail(json as ContractDetail);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSingleId]);

  const serviceTypeOptions = useMemo(
    () => (tree?.groups ?? []).map((group) => group.serviceType),
    [tree]
  );
  const serviceSubtypeOptions = useMemo(() => {
    const values = new Set<string>();
    for (const group of tree?.groups ?? []) {
      if (serviceTypeFilter && group.serviceType !== serviceTypeFilter) continue;
      for (const contract of group.contracts) {
        if (contract.serviceSubtype) values.add(canonicalServiceSubtype(contract.serviceSubtype));
      }
      if (group.serviceType === "통합허가") values.add("최초허가");
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, "ko"));
  }, [tree, serviceTypeFilter]);

  useEffect(() => {
    if (serviceSubtypeFilter && !serviceSubtypeOptions.includes(serviceSubtypeFilter)) {
      setServiceSubtypeFilter("");
    }
  }, [serviceSubtypeFilter, serviceSubtypeOptions]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!tree) return [];
    return tree.groups
      .filter((group) => !serviceTypeFilter || group.serviceType === serviceTypeFilter)
      .map((group) => ({
        ...group,
        contracts: group.contracts.filter((contract) => {
          const textMatch = !q ||
            contract.contractTitle.toLowerCase().includes(q) ||
            contract.counterpartyName.toLowerCase().includes(q) ||
            canonicalServiceSubtype(contract.serviceSubtype).toLowerCase().includes(q);
          const subtypeMatch = !serviceSubtypeFilter || canonicalServiceSubtype(contract.serviceSubtype) === serviceSubtypeFilter;
          const industryMatch = !industryFilter || matchesIndustry(contract, industryFilter);
          return textMatch && subtypeMatch && industryMatch;
        }),
      }))
      .filter((group) => group.contracts.length > 0);
  }, [tree, search, serviceTypeFilter, serviceSubtypeFilter, industryFilter]);

  const targetIds = useMemo(() => {
    if (checked.size > 0) return Array.from(checked);
    return selectedId ? [selectedId] : [];
  }, [checked, selectedId]);
  const visibleContractIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of filteredGroups) {
      for (const contract of group.contracts) ids.add(contract.contractId);
    }
    return ids;
  }, [filteredGroups]);
  const hiddenSelectedCount = useMemo(
    () => Array.from(checked).filter((id) => !visibleContractIds.has(id)).length,
    [checked, visibleContractIds]
  );
  const isSingleTarget = targetIds.length === 1;
  const selectedContract = useMemo(() => {
    if (!tree || !activeSingleId) return null;
    for (const group of tree.groups) {
      const found = group.contracts.find((contract) => contract.contractId === activeSingleId);
      if (found) return found;
    }
    return null;
  }, [tree, activeSingleId]);

  const toggleChecked = (contractId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(contractId)) next.delete(contractId);
      else next.add(contractId);
      return next;
    });
    setSelectedId(contractId);
  };

  // 트리 전체에서 contractId → 노드 조회용 맵 (선택 계약 리스트 표시에 사용)
  const contractById = useMemo(() => {
    const map = new Map<string, ContractTreeContractNode>();
    for (const group of tree?.groups ?? []) {
      for (const contract of group.contracts) map.set(contract.contractId, contract);
    }
    return map;
  }, [tree]);

  const removeFromSelection = (contractId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.delete(contractId);
      return next;
    });
    setSelectedId((prev) => (prev === contractId ? null : prev));
    setContextMenu(null);
  };

  // 컨텍스트 메뉴 외부 클릭/ESC 시 닫기
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  const download = async (mode: SingleMode | MultiMode, scope: Scope = { kind: "all" }) => {
    if (targetIds.length === 0) {
      alert("다운로드할 계약을 선택하세요.");
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch("/api/contracts/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractIds: targetIds, mode, scope }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "다운로드 실패");
      }
      const blob = await res.blob();
      const fileName = getDownloadFileName(res.headers.get("Content-Disposition")) ?? "contract-download";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const contractDocs = detail?.documents.filter((doc) => String(doc.document_type) === "contract") ?? [];
  const amendmentDocs = detail?.documents.filter((doc) => String(doc.document_type) === "amendment") ?? [];

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Archive className="w-5 h-5" />}
        eyebrow="Contract · Documents"
        title="다운로드/증명서 생성"
        subtitle="계약서, 변경계약서, 세금계산서 PDF를 선택한 계약 단위로 다운로드하거나 병합합니다."
        actions={<CdThemeToggle theme={theme} onToggle={toggleTheme} />}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(360px,0.9fr)_minmax(620px,1.4fr)] gap-5">
        <section className="cd-card rounded-3xl overflow-hidden cd-reveal delay-1 flex min-h-0 flex-col">
          <div className="p-4 border-b cd-border-c flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold cd-text flex items-center gap-2">
                <CheckSquare className="w-4 h-4 cd-text-primary" />
                계약 선택
              </h2>
              <p className="text-xs cd-text-faint">
                선택 {targetIds.length.toLocaleString()}건 / 현재 목록 {filteredGroups.reduce((acc, group) => acc + group.contracts.length, 0).toLocaleString()}건
              </p>
            </div>
            <button type="button" className="cd-btn cd-btn-ghost rounded-lg px-3 py-1.5 text-xs cd-text-muted" onClick={() => setChecked(new Set())}>
              선택 해제
            </button>
          </div>
          <div className="px-4 py-3 border-b cd-border-c grid gap-2">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 cd-text-faint shrink-0" />
              <input className="cd-input text-xs flex-1" placeholder="계약명 / 거래처 / 세분류 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className="cd-select text-xs shrink-0" style={{ width: "17ch" }} value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">전체 연도</option>
                {(tree?.availableYears ?? []).map((item) => <option key={item} value={item}>{item}년</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pl-6">
              <select className="cd-select text-xs" value={serviceTypeFilter} onChange={(e) => setServiceTypeFilter(e.target.value)}>
                <option value="">용역분류 전체</option>
                {serviceTypeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className="cd-select text-xs" value={serviceSubtypeFilter} onChange={(e) => setServiceSubtypeFilter(e.target.value)}>
                <option value="">용역세분류 전체</option>
                {serviceSubtypeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className="cd-select text-xs" value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)}>
                <option value="">업종 전체</option>
                {INTEGRATED_PERMIT_INDUSTRIES.map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
              </select>
            </div>
            {hiddenSelectedCount > 0 && (
              <p className="pl-6 text-[11px] cd-text-primary">
                현재 연도/필터 목록에 보이지 않는 선택 계약 {hiddenSelectedCount}건도 다운로드 대상에 유지됩니다.
              </p>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
            {loading ? (
              <div className="p-8 text-center text-sm cd-text-faint">계약 목록을 불러오는 중입니다.</div>
            ) : (
              filteredGroups.map((group) => {
                const style = resolveServiceTypeStyle(group.serviceType);
                const isOpen = expanded[group.serviceType] === true;
                return (
                  <div key={group.serviceType}>
                    <button
                      type="button"
                      onClick={() => setExpanded((prev) => ({ ...prev, [group.serviceType]: !isOpen }))}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[color:var(--cd-surface)] border-b cd-border-c"
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4 cd-text-faint" /> : <ChevronRight className="w-4 h-4 cd-text-faint" />}
                      <span className="w-3 h-3 rounded-full" style={{ background: style.parentColor }} />
                      <span className="text-sm cd-text">{group.serviceType}</span>
                      <span className="text-[11px] cd-text-faint ml-auto">{group.contracts.length}건</span>
                    </button>
                    {isOpen && group.contracts.map((contract) => (
                      <label
                        key={contract.contractId}
                        className={
                          "relative w-full flex items-center gap-2 pl-8 pr-3 py-2 text-left text-xs hover:bg-[color:var(--cd-surface)] border-l-4 " +
                          (selectedId === contract.contractId ? "border-[color:var(--cd-primary)] cd-tint-primary" : "border-transparent")
                        }
                        onClick={() => setSelectedId(contract.contractId)}
                      >
                        <input
                          type="checkbox"
                          checked={checked.has(contract.contractId)}
                          onChange={() => toggleChecked(contract.contractId)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="truncate cd-text">{contract.contractTitle}</span>
                        <span className="ml-auto w-[80px] shrink-0 text-right text-[10px] font-mono cd-text-faint">{contract.contractDate ?? "-"}</span>
                      </label>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="cd-card rounded-3xl p-5 cd-reveal delay-2 min-h-0 overflow-y-auto scrollbar-hide">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h2 className="text-xl font-bold cd-text">
                {selectedContract?.contractTitle ?? String(detail?.contract.contract_title ?? "계약을 선택하세요")}
              </h2>
              <p className="text-xs cd-text-faint mt-1">
                {isSingleTarget ? "단일 계약은 개별 문서 또는 전체 증빙을 다운로드할 수 있습니다." : "복수 계약은 전체 증빙 다운로드만 가능합니다."}
              </p>
            </div>
            <FileArchive className="w-6 h-6 cd-text-primary" />
          </div>

          {/* 병합 옵션(1) + 병합 대상 파일 목록(1) = 선택 계약 리스트(2, gap 포함) 너비 */}
          <div className="grid grid-cols-1 2xl:grid-cols-4 gap-4">
            <div className="rounded-2xl border cd-border-c p-3 h-[360px] overflow-hidden">
              <h3 className="font-bold cd-text mb-3">병합 옵션</h3>
              <div className="grid grid-cols-1 gap-2">
                <OptionCard
                  title="병합 없이 개별 저장"
                  description="선택한 계약 1건의 PDF를 ZIP으로 묶어 다운로드"
                  disabled={!isSingleTarget}
                  active={singleMode === "individualZip"}
                  onClick={() => setSingleMode("individualZip")}
                />
                <OptionCard
                  title="병합하여 하나의 파일로 저장"
                  description="선택한 계약 1건의 계약서/계산서를 PDF 하나로 병합"
                  disabled={!isSingleTarget}
                  active={singleMode === "mergedSingle"}
                  onClick={() => setSingleMode("mergedSingle")}
                />
                <OptionCard
                  title="개별 용역별로 병합 후 저장"
                  description="계약별 병합 PDF를 만들고 ZIP으로 다운로드"
                  disabled={isSingleTarget || targetIds.length === 0}
                  active={multiMode === "perContractMergedZip"}
                  onClick={() => setMultiMode("perContractMergedZip")}
                />
                <OptionCard
                  title="선택된 모든 용역을 하나로 병합 후 저장"
                  description="계약일 순서대로 모든 증빙을 단일 PDF로 병합"
                  disabled={isSingleTarget || targetIds.length === 0}
                  active={multiMode === "mergedAll"}
                  onClick={() => setMultiMode("mergedAll")}
                />
              </div>
            </div>

            <div className="rounded-2xl border cd-border-c p-3 h-[360px] overflow-hidden flex flex-col">
              <h3 className="font-bold cd-text mb-3">병합 대상 파일 목록</h3>
              {isSingleTarget && detail ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex-1 overflow-y-auto pr-1 scrollbar-hide">
                    <div className="flex flex-wrap gap-2">
                    <DocumentTag
                      title="계약서"
                      count={contractDocs.length}
                      disabled={contractDocs.length === 0 || downloading}
                      onClick={() => download(singleMode, { kind: "contract" })}
                    />
                    <DocumentTag
                      title="변경계약서"
                      count={amendmentDocs.length}
                      disabled={amendmentDocs.length === 0 || downloading}
                      onClick={() => download(singleMode, { kind: "amendment" })}
                    />
                    {detail.milestones.map((milestone) => {
                      const milestoneId = String(milestone.milestone_id ?? "");
                      const invoiceCount = detail.invoices.filter((invoice) => String(invoice.milestone_id ?? "") === milestoneId).length;
                      return (
                        <DocumentTag
                          key={milestoneId}
                          title={String(milestone.stage_label ?? "-")}
                          count={invoiceCount}
                          disabled={invoiceCount === 0 || downloading}
                          onClick={() => download(singleMode, { kind: "invoice", milestoneId })}
                        />
                      );
                    })}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <DownloadButton disabled={contractDocs.length === 0 || downloading} onClick={() => download(singleMode, { kind: "contract" })}>계약서</DownloadButton>
                    <DownloadButton disabled={amendmentDocs.length === 0 || downloading} onClick={() => download(singleMode, { kind: "amendment" })}>변경계약</DownloadButton>
                    <DownloadButton disabled={downloading} onClick={() => download(singleMode)}>전체</DownloadButton>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="rounded-2xl border cd-border-c p-6 text-sm cd-text-faint">
                    {targetIds.length > 1 ? "복수 계약 선택 중입니다. 전체 다운로드 버튼만 사용할 수 있습니다." : "좌측 트리에서 계약을 선택하세요."}
                  </div>
                </div>
              )}
            </div>

            {/* 선택 계약 리스트 — 트리뷰에서 체크/선택한 계약 전체. 우클릭으로 목록에서 제거 */}
            <div className="rounded-2xl border cd-border-c p-3 h-[360px] overflow-hidden flex flex-col 2xl:col-span-2">
              <h3 className="font-bold cd-text mb-3 flex items-center gap-2">
                <ListChecks className="w-4 h-4 cd-text-primary" />
                선택 계약 리스트
                <span className="text-[11px] font-normal cd-text-faint ml-auto">{targetIds.length.toLocaleString()}건</span>
              </h3>
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide rounded-xl border cd-border-c">
                {targetIds.length === 0 ? (
                  <p className="p-6 text-sm cd-text-faint">트리뷰에서 계약을 체크하면 여기에 표시됩니다.</p>
                ) : (
                  targetIds.map((id) => {
                    const node = contractById.get(id);
                    return (
                      <div
                        key={id}
                        className="px-3 py-2 text-xs border-b cd-border-c last:border-b-0 hover:bg-[color:var(--cd-surface)] cursor-default select-none"
                        title="우클릭으로 목록에서 제거"
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setContextMenu({ x: e.clientX, y: e.clientY, contractId: id });
                        }}
                      >
                        <p className="truncate cd-text">{node?.contractTitle ?? "(현재 필터 목록에 없는 계약)"}</p>
                        <p className="mt-0.5 flex items-center gap-2 text-[10px] cd-text-faint">
                          <span className="truncate">{node?.counterpartyName ?? id}</span>
                          <span className="ml-auto shrink-0 font-mono">{node?.contractDate ?? ""}</span>
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="mt-3 flex justify-end">
                <DownloadButton
                  primary
                  disabled={targetIds.length === 0 || downloading}
                  onClick={() => download(isSingleTarget ? singleMode : multiMode)}
                >
                  <Download className="w-3.5 h-3.5" />
                  {downloading ? "생성 중..." : "전체 다운로드"}
                </DownloadButton>
              </div>
            </div>
          </div>

          {/* 용역 수행실적 증명서 / 수행인력 명단 생성 (기능 구상 중 — 컨셉 카드) */}
          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4 mt-4">
            <div className="rounded-2xl border cd-border-c p-5">
              <h3 className="font-bold cd-text flex items-center gap-2">
                <Users className="w-4 h-4 cd-text-primary" />
                수행인력 명단 생성
                <span className="ml-auto rounded-full cd-surface-bg px-2.5 py-0.5 text-[10px] font-semibold cd-text-faint">준비 중</span>
              </h3>
              <p className="mt-2 text-xs leading-relaxed cd-text-faint">
                용역별 수행인력 정보를 웹앱에서 통합 관리하고, 선택한 용역의 수행인력 명단 문서를
                생성하는 기능이 제공될 예정입니다.
              </p>
            </div>
            <div className="rounded-2xl border cd-border-c p-5">
              <h3 className="font-bold cd-text flex items-center gap-2">
                <BadgeCheck className="w-4 h-4 cd-text-primary" />
                수행실적 증명서 생성
                <span className="ml-auto rounded-full cd-surface-bg px-2.5 py-0.5 text-[10px] font-semibold cd-text-faint">준비 중</span>
              </h3>
              <p className="mt-2 text-xs leading-relaxed cd-text-faint">
                선택한 계약 이력을 바탕으로 용역 수행실적 증명서를 생성·다운로드하는 기능이
                제공될 예정입니다.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* 선택 계약 리스트 우클릭 컨텍스트 메뉴 */}
      {contextMenu && (
        <div
          className="fixed z-[80] rounded-xl border cd-border-c cd-card-bg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-xs cd-error-text hover:bg-[color:var(--cd-error-soft)]"
            onClick={() => removeFromSelection(contextMenu.contractId)}
          >
            선택 목록에서 제거
          </button>
        </div>
      )}
    </div>
  );
}

function OptionCard({
  title,
  description,
  active,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-40 disabled:cursor-not-allowed " +
        (active ? "border-[color:var(--cd-primary)] cd-tint-primary" : "cd-border-c hover:bg-[color:var(--cd-surface)]")
      }
    >
      <p className="text-sm leading-tight cd-text">{title}</p>
      <p className="text-[11px] leading-snug cd-text-faint mt-1">{description}</p>
    </button>
  );
}

function DocumentTag({
  title,
  count,
  disabled,
  onClick,
}: {
  title: string;
  count: number;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed " +
        (count > 0
          ? "border-[color:var(--cd-primary)] cd-tint-primary cd-text hover:bg-[color:var(--cd-primary-soft)]"
          : "cd-border-c cd-text-faint")
      }
      title={count > 0 ? `${title} ${count}개` : `${title} 없음`}
    >
        <FileText className="w-4 h-4 cd-text-primary" />
        <span className="truncate">{title}</span>
        <span className={count > 0 ? "cd-text-primary" : "cd-text-faint"}>{count > 0 ? `${count}개` : "없음"}</span>
      </button>
  );
}

function DownloadButton({
  children,
  disabled,
  primary,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "rounded-xl px-3 py-2 text-xs shadow-sm inline-flex items-center gap-1 disabled:opacity-50 " +
        (primary ? "text-white cd-fill-primary" : "cd-text-muted border cd-border-c hover:bg-[color:var(--cd-surface)]")
      }
    >
      {children}
    </button>
  );
}

function getDownloadFileName(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
  if (match) return decodeURIComponent(match[1]);
  return null;
}

function matchesIndustry(contract: ContractTreeContractNode, label: string): boolean {
  const target = INTEGRATED_PERMIT_INDUSTRIES.find((item) => item.label === label);
  if (!target) return true;
  const haystack = normalizeFilterText([
    contract.industryCategory,
    contract.facilityIndustryName,
    contract.facilityIndustryCode,
  ].filter(Boolean).join(" "));
  return target.keywords.some((keyword) => haystack.includes(normalizeFilterText(keyword)));
}

function canonicalServiceSubtype(value: string | null): string {
  return value === "통합허가" ? "최초허가" : (value ?? "");
}

function normalizeFilterText(value: string): string {
  return value.replace(/[\s·•\-‐‑‒–—―−.,:;()\[\]{}（）「」『』〈〉《》/&]+/g, "").toLowerCase();
}
