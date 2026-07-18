"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Archive, BadgeCheck, Check, CheckSquare, ChevronDown, ChevronRight, Download, FileArchive, FileText, ListChecks, Mail, Paperclip, Search } from "lucide-react";
import { resolveServiceTypeStyle } from "@/lib/ieps/contract-tree-style";
import { INTEGRATED_PERMIT_INDUSTRIES, canonicalServiceSubtype, matchesIndustryText } from "@/lib/ieps/integrated-permit";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
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

interface ContactOption {
  personId: string;
  name: string;
  title: string;
  deptName: string;
  fax: string;
  active: boolean;
}
interface ContractContacts {
  facilityName: string;
  contacts: ContactOption[];
}

type Scope =
  | { kind: "all" }
  | { kind: "contract" }
  | { kind: "amendment" }
  | { kind: "invoice"; milestoneId: string };

type SingleMode = "singleRaw" | "individualZip" | "mergedSingle";
type MultiMode = "perContractMergedZip" | "mergedAll";

// 통합허가 업종/세분류 상수·매칭은 lib/ieps/integrated-permit.ts 공용(입찰 서류 생성과 공유)

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
  // 연도/필터를 바꿔도 이전에 본 계약 메타를 유지하기 위한 누적 캐시
  // (트리는 연도별로만 로드되므로, 다른 연도에서 선택한 계약의 표시 정보가 사라지는 문제 방지)
  const [nodeCache, setNodeCache] = useState<Map<string, { node: ContractTreeContractNode; serviceType: string }>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [singleMode, setSingleMode] = useState<SingleMode>("individualZip");
  const [multiMode, setMultiMode] = useState<MultiMode>("perContractMergedZip");
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(true);
  // 증명서 생성 관련 상태
  const [certOption, setCertOption] = useState<1 | 2 | 3>(1); // 1=증명서만 2=증명서+명단 3=명단만
  const [submittedTo, setSubmittedTo] = useState("");
  const [purpose, setPurpose] = useState("입찰 참여용");
  const [certBusy, setCertBusy] = useState(false);
  const [bundleBusy, setBundleBusy] = useState(false);
  const [contactsByContract, setContactsByContract] = useState<Record<string, ContractContacts>>({});
  const [contactByContract, setContactByContract] = useState<Record<string, string>>({});
  // 서명(직인) 증명서는 첨부 즉시 S3에 저장 → 재선택 시 '증명서 기첨부'로 표시. 여기엔 저장 상태만 보관.
  const [signedCerts, setSignedCerts] = useState<Record<string, { fileName: string }>>({});
  // 'PDF생성'으로 만든 수행인력 명단 PDF도 S3 저장 → 재선택 시 '명단 기저장'으로 표시('명단+계약서' 묶음에 사용).
  const [rosterPdfs, setRosterPdfs] = useState<Record<string, { fileName: string }>>({});
  const [rosterPdfBusy, setRosterPdfBusy] = useState(false);
  const [rosterBundleBusy, setRosterBundleBusy] = useState(false);
  const [attaching, setAttaching] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; contractId: string } | null>(null);

  const reloadTree = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (year) params.set("year", year);
      const res = await fetch("/api/contracts/tree?" + params.toString(), { cache: "no-store" });
      const json = (await res.json()) as ContractTreePayload;
      setTree(json);
      setNodeCache((prev) => {
        const next = new Map(prev);
        for (const group of json.groups) {
          for (const contract of group.contracts) {
            next.set(contract.contractId, { node: contract, serviceType: group.serviceType });
          }
        }
        return next;
      });
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
  // 누적 캐시 기반이라 연도/필터를 바꿔도 이전에 선택한 계약 정보가 유지된다.
  const contractById = useMemo(() => {
    const map = new Map<string, ContractTreeContractNode>();
    nodeCache.forEach((value, id) => map.set(id, value.node));
    return map;
  }, [nodeCache]);

  const removeFromSelection = (contractId: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.delete(contractId);
      return next;
    });
    setSelectedId((prev) => (prev === contractId ? null : prev));
    // 로컬 표시만 제거(S3 저장본은 유지) — 재선택 시 서버에서 다시 조회된다.
    setSignedCerts((prev) => {
      if (!(contractId in prev)) return prev;
      const next = { ...prev };
      delete next[contractId];
      return next;
    });
    setRosterPdfs((prev) => {
      if (!(contractId in prev)) return prev;
      const next = { ...prev };
      delete next[contractId];
      return next;
    });
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

  // 특정 문서 태그/버튼 다운로드: 단일 파일이면 폴더/zip 없이 원본 그대로,
  // 복수 파일이면 선택한 병합 옵션(singleMode)대로 처리한다.
  const downloadDoc = (scope: Scope, count: number) =>
    download(count === 1 ? "singleRaw" : singleMode, scope);

  // 계약 → 용역분류 매핑 (증명서 통합허가 필터용) — 누적 캐시 기반(연도 전환에도 유지)
  const serviceTypeById = useMemo(() => {
    const m = new Map<string, string>();
    nodeCache.forEach((value, id) => m.set(id, value.serviceType));
    return m;
  }, [nodeCache]);

  // 선택된 계약 중 통합허가(증명서 대상). 필터로 숨은 계약(분류 미상)은 서버 판정에 맡겨 포함.
  const certEligibleIds = useMemo(
    () => targetIds.filter((id) => (serviceTypeById.get(id) ?? "통합허가") === "통합허가"),
    [targetIds, serviceTypeById]
  );
  // 화면상 분류가 확인된 비-통합허가(안내용)
  const knownSkippedCount = useMemo(
    () => targetIds.filter((id) => { const t = serviceTypeById.get(id); return t && t !== "통합허가"; }).length,
    [targetIds, serviceTypeById]
  );

  // 증명서 발급기관 담당자 선택용 — 통합허가 계약별 담당자 리스트 로드
  useEffect(() => {
    const ids = targetIds.filter((id) => serviceTypeById.get(id) === "통합허가");
    let cancelled = false;
    for (const id of ids) {
      if (contactsByContract[id]) continue;
      fetch(`/api/contracts/${encodeURIComponent(id)}/contacts`, { cache: "no-store" })
        .then((res) => (res.ok ? (res.json() as Promise<ContractContacts>) : null))
        .then((data) => {
          if (cancelled || !data) return;
          setContactsByContract((prev) => (prev[id] ? prev : { ...prev, [id]: data }));
          const first = data.contacts[0];
          if (first) setContactByContract((prev) => (prev[id] ? prev : { ...prev, [id]: first.personId }));
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [targetIds, serviceTypeById, contactsByContract]);

  const downloadBlobResponse = async (res: Response, fallbackName: string) => {
    const blob = await res.blob();
    const fileName = getDownloadFileName(res.headers.get("Content-Disposition")) ?? fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateCertificates = async () => {
    if (certEligibleIds.length === 0) {
      alert("선택한 계약 중 통합허가 용역이 없어 증명서를 생성할 수 없습니다.");
      return;
    }
    if (knownSkippedCount > 0 &&
        !confirm(`통합허가가 아닌 ${knownSkippedCount}건은 제외하고 ${certEligibleIds.length}건의 증명서를 생성합니다. 계속할까요?`)) {
      return;
    }
    setCertBusy(true);
    try {
      const res = await fetch("/api/contracts/certificate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractIds: certEligibleIds, option: certOption, submittedTo, purpose, contactByContract }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "증명서 생성 실패");
      }
      await downloadBlobResponse(res, "용역수행실적증명서.hwpx");
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCertBusy(false);
    }
  };

  // 계약 행의 서명(직인) 증명서 PDF 첨부 — 즉시 S3에 저장(같은 계약 재첨부 시 교체).
  const attachSignedCert = async (contractId: string, file: File) => {
    if (file.type && file.type !== "application/pdf") {
      alert("PDF 파일만 첨부할 수 있습니다.");
      return;
    }
    setAttaching((prev) => ({ ...prev, [contractId]: true }));
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/signed-certificate`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "증명서 첨부 실패");
      }
      const data = (await res.json()) as { fileName: string };
      setSignedCerts((prev) => ({ ...prev, [contractId]: { fileName: data.fileName } }));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setAttaching((prev) => {
        const next = { ...prev };
        delete next[contractId];
        return next;
      });
    }
  };

  // 선택 계약들의 서명 증명서/명단 PDF(S3) 저장 여부를 한 번에 조회해 '기첨부/기저장' 표시 동기화
  useEffect(() => {
    if (targetIds.length === 0) {
      setSignedCerts({});
      setRosterPdfs({});
      return;
    }
    let cancelled = false;
    fetch("/api/contracts/signed-certificates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractIds: targetIds }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ signed: Record<string, { fileName: string }>; rosters?: Record<string, { fileName: string }> }>) : null))
      .then((d) => {
        if (cancelled || !d) return;
        if (d.signed) setSignedCerts(d.signed);
        setRosterPdfs(d.rosters ?? {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [targetIds]);

  // '명단만 생성' PDF — 선택 계약 리스트 전체의 수행인력 명단을 PDF로 만들어 S3에 저장(다운로드 없음)
  const generateRosterPdfs = async () => {
    if (targetIds.length === 0) {
      alert("명단을 생성할 계약을 선택하세요.");
      return;
    }
    setRosterPdfBusy(true);
    try {
      const res = await fetch("/api/contracts/roster-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractIds: targetIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "명단 PDF 생성 실패");
      }
      const data = (await res.json()) as { saved: Record<string, { fileName: string }>; skipped: number };
      setRosterPdfs((prev) => ({ ...prev, ...data.saved }));
      const count = Object.keys(data.saved).length;
      alert(`수행인력 명단 PDF ${count}건을 저장했습니다.${data.skipped > 0 ? ` (생성 불가 ${data.skipped}건 제외)` : ""}`);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setRosterPdfBusy(false);
    }
  };

  // 통합묶음(증명서+명단+계약서) 다운로드 — S3 저장된 서명 증명서를 사용
  const downloadBundle = async () => {
    if (targetIds.length === 0) {
      alert("계약을 선택하세요.");
      return;
    }
    setBundleBusy(true);
    try {
      const res = await fetch("/api/contracts/certificate-bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractIds: targetIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "통합묶음 생성 실패");
      }
      await downloadBlobResponse(res, "증명서묶음.pdf");
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBundleBusy(false);
    }
  };

  // 명단+계약서 묶음 다운로드 — 'PDF생성'으로 S3에 저장된 명단 PDF를 사용
  const downloadRosterBundle = async () => {
    if (targetIds.length === 0) {
      alert("계약을 선택하세요.");
      return;
    }
    setRosterBundleBusy(true);
    try {
      const res = await fetch("/api/contracts/roster-bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractIds: targetIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "명단+계약서 묶음 생성 실패");
      }
      await downloadBlobResponse(res, "명단계약서묶음.pdf");
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setRosterBundleBusy(false);
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
                      onClick={() => setExpanded((prev) => (prev[group.serviceType] ? {} : { [group.serviceType]: true }))}
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

        <section className="cd-card rounded-3xl p-5 cd-reveal delay-2 min-h-0 flex flex-col">
          <div className="flex items-start justify-between gap-4 mb-5 shrink-0">
            <div>
              <h2 className="text-xl font-bold cd-text">파일 병합 및 증명서/명단 생성</h2>
              <p className="text-xs cd-text-faint mt-1">
                {isSingleTarget ? "단일 계약은 개별 문서 또는 전체 증빙을 다운로드할 수 있습니다." : "복수 계약은 전체 증빙 다운로드만 가능합니다."}
              </p>
            </div>
            <FileArchive className="w-6 h-6 cd-text-primary" />
          </div>

          {/* 좌: [병합옵션·병합대상] 위 / [증명서 생성] 아래(하단까지) · 우: [선택 계약 리스트] 위 / [실적증명서 송부] 아래 */}
          <div className="grid grid-cols-1 2xl:grid-cols-4 2xl:grid-rows-[360px_1fr_auto] gap-4 flex-1 min-h-0 overflow-y-auto scrollbar-hide">
            <div className="rounded-2xl border cd-border-c p-3 h-[360px] overflow-hidden 2xl:col-start-1 2xl:row-start-1">
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

            <div className="rounded-2xl border cd-border-c p-3 h-[360px] overflow-hidden flex flex-col 2xl:col-start-2 2xl:row-start-1">
              <h3 className="font-bold cd-text mb-3">병합 대상 파일 목록</h3>
              {isSingleTarget && detail ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex-1 overflow-y-auto pr-1 scrollbar-hide">
                    <div className="flex flex-wrap gap-2">
                    <DocumentTag
                      title="계약서"
                      count={contractDocs.length}
                      disabled={contractDocs.length === 0 || downloading}
                      onClick={() => downloadDoc({ kind: "contract" }, contractDocs.length)}
                    />
                    <DocumentTag
                      title="변경계약서"
                      count={amendmentDocs.length}
                      disabled={amendmentDocs.length === 0 || downloading}
                      onClick={() => downloadDoc({ kind: "amendment" }, amendmentDocs.length)}
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
                          onClick={() => downloadDoc({ kind: "invoice", milestoneId }, invoiceCount)}
                        />
                      );
                    })}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <DownloadButton disabled={contractDocs.length === 0 || downloading} onClick={() => downloadDoc({ kind: "contract" }, contractDocs.length)}>계약서</DownloadButton>
                    <DownloadButton disabled={amendmentDocs.length === 0 || downloading} onClick={() => downloadDoc({ kind: "amendment" }, amendmentDocs.length)}>변경계약</DownloadButton>
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
            <div className="rounded-2xl border cd-border-c p-3 h-full min-h-[360px] overflow-hidden flex flex-col 2xl:col-start-3 2xl:col-span-2 2xl:row-start-1 2xl:row-span-2">
              <h3 className="font-bold cd-text mb-3 flex items-center gap-2">
                <ListChecks className="w-4 h-4 cd-text-primary" />
                선택 계약 리스트
                <span className="text-[11px] font-normal cd-text-faint ml-auto">{targetIds.length.toLocaleString()}건</span>
                <button
                  type="button"
                  className="cd-btn cd-btn-ghost rounded-lg px-2.5 py-1 text-[11px] cd-text-muted"
                  disabled={targetIds.length === 0}
                  onClick={() => { setChecked(new Set()); setSelectedId(null); setDetail(null); setSignedCerts({}); setRosterPdfs({}); }}
                >
                  선택 해제
                </button>
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
                          {rosterPdfs[id] && (
                            <span
                              className="shrink-0 inline-flex items-center gap-1 rounded-md border border-[color:var(--cd-primary)] cd-tint-primary cd-text-primary px-1.5 py-0.5 text-[9px] font-semibold"
                              title={`명단 PDF 저장됨: ${rosterPdfs[id].fileName}`}
                            >
                              <Check className="w-3 h-3" /> 명단 기저장
                            </span>
                          )}
                          {signedCerts[id] && (
                            <span
                              className="shrink-0 inline-flex items-center gap-1 rounded-md border border-[color:var(--cd-primary)] cd-tint-primary cd-text-primary px-1.5 py-0.5 text-[9px] font-semibold"
                              title={`증명서 저장됨: ${signedCerts[id].fileName}`}
                            >
                              <Check className="w-3 h-3" /> 증명서 기첨부
                            </span>
                          )}
                          <label
                            className="shrink-0 inline-flex items-center gap-1 rounded-md border cd-border-c cd-text-faint hover:bg-[color:var(--cd-surface)] px-1.5 py-0.5 cursor-pointer text-[9px] font-semibold"
                            title={signedCerts[id] ? "증명서 PDF 교체(새 파일 첨부)" : "서명 증명서 PDF 첨부"}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Paperclip className="w-3 h-3" />
                            {attaching[id] ? "첨부 중..." : signedCerts[id] ? "증명서 교체" : "증명서 첨부"}
                            <input
                              type="file"
                              accept="application/pdf"
                              className="hidden"
                              disabled={!!attaching[id]}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) attachSignedCert(id, f);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <DownloadButton
                  disabled={targetIds.length === 0 || rosterBundleBusy}
                  onClick={downloadRosterBundle}
                >
                  <Download className="w-3.5 h-3.5" />
                  {rosterBundleBusy ? "생성 중..." : "명단+계약서"}
                </DownloadButton>
                <DownloadButton
                  disabled={targetIds.length === 0 || bundleBusy}
                  onClick={downloadBundle}
                >
                  <Download className="w-3.5 h-3.5" />
                  {bundleBusy ? "생성 중..." : "증명서+명단+계약서"}
                </DownloadButton>
                <DownloadButton
                  primary
                  disabled={targetIds.length === 0 || downloading}
                  onClick={() => download(isSingleTarget ? singleMode : multiMode)}
                >
                  <Download className="w-3.5 h-3.5" />
                  {downloading ? "생성 중..." : "계약서+계산서"}
                </DownloadButton>
              </div>
            </div>

            {/* 수행실적 증명서 생성 카드 (좌측 하단 — 카드 하단까지 확장) */}
            <div className="rounded-2xl border cd-border-c p-5 flex flex-col gap-4 overflow-y-auto scrollbar-hide 2xl:col-start-1 2xl:col-span-2 2xl:row-start-2 2xl:row-span-2">
              {/* 수행실적 증명서 */}
              <div>
                <h3 className="font-bold cd-text flex items-center gap-2">
                  <BadgeCheck className="w-4 h-4 cd-text-primary" />
                  수행실적 증명서 생성
                  <span className="ml-auto text-[11px] font-normal cd-text-faint">통합허가 {certEligibleIds.length}건</span>
                </h3>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {([
                    { v: 1, label: "증명서만 생성" },
                    { v: 2, label: "증명서 + 명단" },
                    { v: 3, label: "명단만 생성" },
                  ] as const).map((opt) => (
                    <label
                      key={opt.v}
                      className={
                        "flex items-center justify-center gap-2 rounded-xl border px-2 py-2 text-xs text-center cursor-pointer " +
                        (certOption === opt.v ? "border-[color:var(--cd-primary)] cd-tint-primary" : "cd-border-c")
                      }
                    >
                      <input
                        type="radio"
                        name="certOption"
                        className="shrink-0"
                        checked={certOption === opt.v}
                        onChange={() => setCertOption(opt.v)}
                      />
                      <span className="font-semibold cd-text">{opt.label}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">제출처</span>
                    <input className="cd-input text-xs" value={submittedTo} onChange={(e) => setSubmittedTo(e.target.value)} placeholder="예: 신평택발전㈜" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] cd-text-faint">증명서용도</span>
                    <input className="cd-input text-xs" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="예: 입찰 참여용" />
                  </label>
                </div>

                {certEligibleIds.some((id) => contactsByContract[id]) && (
                  <div className="mt-3">
                    <span className="text-[11px] cd-text-faint">발급기관 담당자 선택</span>
                    <div className="mt-1 rounded-xl border cd-border-c divide-y cd-border-c max-h-[460px] overflow-y-auto scrollbar-hide">
                      {certEligibleIds.map((id) => {
                        const data = contactsByContract[id];
                        if (!data) return null;
                        const node = contractById.get(id);
                        return (
                          <div key={id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                            <span className="truncate cd-text flex-1 min-w-0" title={node?.contractTitle ?? id}>
                              {data.facilityName || node?.contractTitle || id}
                            </span>
                            {data.contacts.length === 0 ? (
                              <span className="text-[11px] cd-text-faint shrink-0">담당자 없음</span>
                            ) : (
                              <select
                                className="cd-select text-xs shrink-0 max-w-[55%]"
                                value={contactByContract[id] ?? ""}
                                onChange={(e) => setContactByContract((prev) => ({ ...prev, [id]: e.target.value }))}
                              >
                                {data.contacts.map((c) => (
                                  <option key={c.personId} value={c.personId}>
                                    {[c.name, c.title].filter(Boolean).join(" ")}{c.deptName ? ` · ${c.deptName}` : ""}{c.active ? "" : " (퇴직)"}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={generateCertificates}
                    disabled={certEligibleIds.length === 0 || certBusy}
                    className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
                  >
                    {certBusy ? "생성 중..." : `HWPX 생성${certEligibleIds.length > 1 ? ` (${certEligibleIds.length}건)` : ""}`}
                  </button>
                  {/* 명단만 생성(옵션 3) 전용 — 선택 계약 리스트 전체의 명단 PDF를 S3에 저장(다운로드 없음, '명단+계약서' 묶음에 사용) */}
                  <button
                    type="button"
                    onClick={generateRosterPdfs}
                    disabled={certOption !== 3 || targetIds.length === 0 || rosterPdfBusy}
                    title="선택 계약의 수행인력 명단을 PDF로 저장합니다. 저장본은 '명단+계약서' 묶음 다운로드에 사용됩니다."
                    className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
                  >
                    {rosterPdfBusy ? "저장 중..." : `PDF생성${targetIds.length > 1 ? ` (${targetIds.length}건)` : ""}`}
                  </button>
                </div>
              </div>
            </div>

            {/* 실적증명서 송부 카드 (선택 계약 리스트 하단) — 메일 자동작성·수신/답신 확인·첨부 S3 보관 예정 */}
            <div className="rounded-2xl border cd-border-c p-5 flex flex-col gap-3 2xl:col-start-3 2xl:col-span-2 2xl:row-start-3">
              <h3 className="font-bold cd-text flex items-center gap-2">
                <Mail className="w-4 h-4 cd-text-primary" />
                실적증명서 송부
                <span className="ml-auto text-[11px] font-normal cd-text-faint">준비 중</span>
              </h3>
              <p className="text-xs leading-relaxed cd-text-faint">
                생성한 수행실적 증명서(HWPX)를 사업장 담당자에게 메일로 자동 송부하고, 수신·답신 확인과
                첨부 PDF의 S3 보관까지 관리하는 기능이 이 영역에 추가될 예정입니다.
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
  return matchesIndustryText(
    [contract.industryCategory, contract.facilityIndustryName, contract.facilityIndustryCode],
    label
  );
}
