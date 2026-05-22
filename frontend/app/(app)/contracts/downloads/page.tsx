"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Archive, CheckSquare, ChevronDown, ChevronRight, Download, FileArchive, FileText, Search } from "lucide-react";
import { resolveServiceTypeStyle } from "@/lib/ieps/contract-tree-style";

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
    <div className="flex h-full min-h-0 flex-col gap-6 p-2">
      <section className="glass-panel p-8 rounded-3xl relative overflow-hidden reveal">
        <h1 className="text-3xl font-bold text-stone-800 mb-2 flex items-center gap-3">
          <Archive className="w-7 h-7 text-primary" />
          다운로드/증명서 생성
        </h1>
        <p className="text-stone-600 text-base">
          계약서, 변경계약서, 세금계산서 PDF를 선택한 계약 단위로 다운로드하거나 병합합니다.
        </p>
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(360px,0.9fr)_minmax(620px,1.4fr)] gap-5">
        <section className="glass-card rounded-3xl overflow-hidden reveal delay-1 flex min-h-0 flex-col">
          <div className="p-4 border-b border-stone-200/70 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-stone-800 flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-primary" />
                계약 선택
              </h2>
              <p className="text-xs text-stone-500">
                선택 {targetIds.length.toLocaleString()}건 / 현재 목록 {filteredGroups.reduce((acc, group) => acc + group.contracts.length, 0).toLocaleString()}건
              </p>
            </div>
            <button type="button" className="glass-button rounded-lg px-3 py-1.5 text-xs text-stone-700" onClick={() => setChecked(new Set())}>
              선택 해제
            </button>
          </div>
          <div className="px-4 py-3 border-b border-stone-200/70 grid gap-2">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-stone-400 shrink-0" />
              <input className="input-field text-xs flex-1" placeholder="계약명 / 거래처 / 세분류 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
              <select className="ui-select text-xs shrink-0" style={{ width: "17ch" }} value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">전체 연도</option>
                {(tree?.availableYears ?? []).map((item) => <option key={item} value={item}>{item}년</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pl-6">
              <select className="ui-select text-xs" value={serviceTypeFilter} onChange={(e) => setServiceTypeFilter(e.target.value)}>
                <option value="">용역분류 전체</option>
                {serviceTypeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className="ui-select text-xs" value={serviceSubtypeFilter} onChange={(e) => setServiceSubtypeFilter(e.target.value)}>
                <option value="">용역세분류 전체</option>
                {serviceSubtypeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select className="ui-select text-xs" value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)}>
                <option value="">업종 전체</option>
                {INTEGRATED_PERMIT_INDUSTRIES.map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
              </select>
            </div>
            {hiddenSelectedCount > 0 && (
              <p className="pl-6 text-[11px] text-primary">
                현재 연도/필터 목록에 보이지 않는 선택 계약 {hiddenSelectedCount}건도 다운로드 대상에 유지됩니다.
              </p>
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
            {loading ? (
              <div className="p-8 text-center text-sm text-stone-500">계약 목록을 불러오는 중입니다.</div>
            ) : (
              filteredGroups.map((group) => {
                const style = resolveServiceTypeStyle(group.serviceType);
                const isOpen = expanded[group.serviceType] === true;
                return (
                  <div key={group.serviceType}>
                    <button
                      type="button"
                      onClick={() => setExpanded((prev) => ({ ...prev, [group.serviceType]: !isOpen }))}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-stone-50 border-b border-stone-200/70"
                    >
                      {isOpen ? <ChevronDown className="w-4 h-4 text-stone-500" /> : <ChevronRight className="w-4 h-4 text-stone-500" />}
                      <span className="w-3 h-3 rounded-full" style={{ background: style.parentColor }} />
                      <span className="text-sm text-stone-800">{group.serviceType}</span>
                      <span className="text-[11px] text-stone-500 ml-auto">{group.contracts.length}건</span>
                    </button>
                    {isOpen && group.contracts.map((contract) => (
                      <label
                        key={contract.contractId}
                        className={
                          "relative w-full flex items-center gap-2 pl-8 pr-3 py-2 text-left text-xs bg-white/40 hover:bg-primary/5 border-l-4 " +
                          (selectedId === contract.contractId ? "border-primary bg-primary/10" : "border-transparent")
                        }
                        onClick={() => setSelectedId(contract.contractId)}
                      >
                        <input
                          type="checkbox"
                          checked={checked.has(contract.contractId)}
                          onChange={() => toggleChecked(contract.contractId)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="truncate text-stone-800">{contract.contractTitle}</span>
                        <span className="ml-auto w-[80px] shrink-0 text-right text-[10px] font-mono text-stone-400">{contract.contractDate ?? "-"}</span>
                      </label>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="glass-card rounded-3xl p-5 reveal delay-2 min-h-0 overflow-y-auto scrollbar-hide">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h2 className="text-xl font-bold text-stone-800">
                {selectedContract?.contractTitle ?? String(detail?.contract.contract_title ?? "계약을 선택하세요")}
              </h2>
              <p className="text-xs text-stone-500 mt-1">
                {isSingleTarget ? "단일 계약은 개별 문서 또는 전체 증빙을 다운로드할 수 있습니다." : "복수 계약은 전체 증빙 다운로드만 가능합니다."}
              </p>
            </div>
            <FileArchive className="w-6 h-6 text-primary" />
          </div>

          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-5">
            <div className="rounded-2xl border border-stone-200/80 bg-white/50 p-3 h-[360px] overflow-hidden">
              <h3 className="font-bold text-stone-800 mb-3">병합 옵션</h3>
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

            <div className="rounded-2xl border border-stone-200/80 bg-white/50 p-3 h-[360px] overflow-hidden flex flex-col">
              <h3 className="font-bold text-stone-800 mb-3">병합 대상 파일 목록</h3>
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
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      <DownloadButton disabled={contractDocs.length === 0 || downloading} onClick={() => download(singleMode, { kind: "contract" })}>계약서</DownloadButton>
                      <DownloadButton disabled={amendmentDocs.length === 0 || downloading} onClick={() => download(singleMode, { kind: "amendment" })}>변경계약</DownloadButton>
                      <DownloadButton disabled={downloading} onClick={() => download(singleMode)}>전체</DownloadButton>
                    </div>
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
              ) : (
                <div className="flex min-h-0 flex-1 flex-col justify-between gap-3">
                  <div className="rounded-2xl border border-stone-200/80 bg-white/60 p-6 text-sm text-stone-500">
                    {targetIds.length > 1 ? "복수 계약 선택 중입니다. 전체 다운로드 버튼만 사용할 수 있습니다." : "좌측 트리에서 계약을 선택하세요."}
                  </div>
                  <div className="flex justify-end">
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
              )}
            </div>
          </div>
        </section>
      </div>
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
        (active ? "border-primary bg-primary/5" : "border-stone-200/80 bg-white/60 hover:bg-primary/5")
      }
    >
      <p className="text-sm leading-tight text-stone-800">{title}</p>
      <p className="text-[11px] leading-snug text-stone-500 mt-1">{description}</p>
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
          ? "border-primary/30 bg-primary/5 text-stone-800 hover:bg-primary/10"
          : "border-stone-200 bg-white/50 text-stone-400")
      }
      title={count > 0 ? `${title} ${count}개` : `${title} 없음`}
    >
        <FileText className="w-4 h-4 text-primary" />
        <span className="truncate">{title}</span>
        <span className={count > 0 ? "text-primary" : "text-stone-400"}>{count > 0 ? `${count}개` : "없음"}</span>
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
        (primary ? "text-white bg-primary hover:bg-primary/90" : "text-stone-700 border border-stone-300 hover:bg-stone-100")
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
