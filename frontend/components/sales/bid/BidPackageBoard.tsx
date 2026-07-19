"use client";

// 입찰 증빙서류 패키지 생성(전용 페이지) — BidBoard 상세 모달 '입찰 서류 생성' 버튼으로 진입.
// P1 골격: 공고 요약 + ①제출 양식(발주처 라이브러리 업로드/디폴트) ②실적 계약 선택
// ③수행인력 확정 ④문서 생성(P2 양식 분석 후 활성화 — placeholder). 선택 상태는 공고당 1건 저장.
// 상세 설계: docs/bid-package-blueprint.md

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileStack,
  FileText,
  Paperclip,
  Save,
  Search,
  Users,
} from "lucide-react";
import { resolveServiceTypeStyle } from "@/lib/ieps/contract-tree-style";
import { INTEGRATED_PERMIT_INDUSTRIES, canonicalServiceSubtype, matchesIndustryText } from "@/lib/ieps/integrated-permit";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { FormProfilePanel } from "@/components/sales/bid/FormProfilePanel";
import "@/components/cdash/cdash.css";

interface BidSummary {
  bidId: string;
  externalId: string;
  title: string | null;
  orgName: string | null;
  budget: number | null;
  postedAt: string | null;
  deadline: string | null;
  method: string | null;
  workType: string | null;
}

interface PackageForm {
  formId: string;
  orgName: string;
  displayName: string;
  byteSize: number | null;
  hasProfile: boolean;
  updatedAt: string;
}

interface PackageState {
  packageId: string;
  formId: string | null;
  contractIds: string[];
  employeeIds: string[];
  updatedAt: string;
}

interface Participant {
  employeeId: string;
  name: string;
  positionName: string | null;
  engGrade: string | null;
  specialtyField: string | null;
  contractCount: number;
}

interface TreeContract {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  contractDate: string | null;
  serviceSubtype: string | null;
  industryCategory: string | null;
  facilityIndustryName: string | null;
  facilityIndustryCode: string | null;
}

interface TreeGroup {
  serviceType: string;
  contracts: TreeContract[];
}

interface TreePayload {
  availableYears: string[];
  groups: TreeGroup[];
}

const TYPE_LABEL: Record<string, string> = {
  order_plan: "발주계획",
  prior_spec: "사전규격",
  bid_notice: "입찰공고",
};

// P3 에서 생성할 문서 7종 — 골격 단계에서는 구성 안내만 표시.
const PACKAGE_DOCS = [
  "업체 연혁·일반사항",
  "신용평가 등급",
  "수행실적 총괄표",
  "수행인력 집계표",
  "수행인력 개별 이력사항",
  "개인정보 수집 및 이용 동의서",
  "보안 서약서",
];

const short = (s: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "-");

function fmtMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "-";
  const eok = Math.floor(n / 1e8);
  const man = Math.round((n - eok * 1e8) / 1e4);
  if (eok > 0) return man > 0 ? `${eok}억 ${man.toLocaleString()}만원` : `${eok}억원`;
  return `${man.toLocaleString()}만원`;
}

function fmtBytes(n: number | null): string {
  if (n == null || n <= 0) return "";
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.round(n / 1024)}KB`;
}

export function BidPackageBoard() {
  const { theme } = useCdashTheme();
  const sp = useSearchParams();
  const bidType = sp.get("bidType") ?? "bid_notice";
  const bidId = sp.get("bidId") ?? "";

  const [bid, setBid] = useState<BidSummary | null>(null);
  const [form, setForm] = useState<PackageForm | null>(null);
  const [pkg, setPkg] = useState<PackageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 실적 계약 선택(다운로드/증명서 화면의 트리 패턴 축약 재사용)
  const [tree, setTree] = useState<TreePayload | null>(null);
  const [year, setYear] = useState("");
  const [search, setSearch] = useState("");
  // 통합허가 실적 인정 범위 한정용 — 용역 세분류·업종 필터
  const [subtypeFilter, setSubtypeFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [nodeCache, setNodeCache] = useState<Map<string, TreeContract>>(new Map());

  // 수행인력 확정
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [pickedEmployees, setPickedEmployees] = useState<Set<string>>(new Set());
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [participantsError, setParticipantsError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  // 초기 로드 — 공고 요약 + 저장된 패키지 상태 + 발주처 기본 양식
  useEffect(() => {
    if (!bidId) {
      setError("공고 정보가 없습니다. 공공입찰 목록에서 상세 모달의 '입찰 서류 생성'으로 진입하세요.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/sales/bids/package?bidType=${encodeURIComponent(bidType)}&bidId=${encodeURIComponent(bidId)}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "패키지 정보를 불러오지 못했습니다.");
        if (cancelled) return;
        setBid(data.bid ?? null);
        setForm(data.form ?? null);
        setPkg(data.package ?? null);
        if (data.package) {
          setChecked(new Set<string>(data.package.contractIds ?? []));
          setPickedEmployees(new Set<string>(data.package.employeeIds ?? []));
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bidType, bidId]);

  // 계약 트리 로드(연도 필터)
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (year) params.set("year", year);
    fetch("/api/contracts/tree?" + params.toString(), { cache: "no-store" })
      .then((res) => res.json())
      .then((json: TreePayload) => {
        if (cancelled) return;
        setTree(json);
        setNodeCache((prev) => {
          const next = new Map(prev);
          for (const g of json.groups ?? []) for (const c of g.contracts) next.set(c.contractId, c);
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [year]);

  const contractIds = useMemo(() => Array.from(checked), [checked]);

  // 선택 계약 기반 수행인력 후보 로드 — 신규 등장 인력은 기본 선택
  useEffect(() => {
    if (contractIds.length === 0) {
      setParticipants([]);
      setPickedEmployees(new Set());
      return;
    }
    let cancelled = false;
    setParticipantsLoading(true);
    setParticipantsError(null);
    fetch("/api/sales/bids/package/participants?contractIds=" + encodeURIComponent(contractIds.join(",")), {
      cache: "no-store",
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { participants?: Participant[]; error?: string };
        if (!res.ok) throw new Error(data?.error ?? `수행인력 조회 실패 (HTTP ${res.status})`);
        return data;
      })
      .then((data: { participants?: Participant[] }) => {
        if (cancelled) return;
        const list = data.participants ?? [];
        setParticipants(list);
        setPickedEmployees((prev) => {
          // 이미 화면에서 선택/해제한 인력은 유지, 새로 나타난 인력만 기본 선택
          const next = new Set<string>();
          const known = new Set(participants.map((p) => p.employeeId));
          for (const p of list) {
            if (known.has(p.employeeId)) {
              if (prev.has(p.employeeId)) next.add(p.employeeId);
            } else {
              next.add(p.employeeId);
            }
          }
          return next;
        });
      })
      .catch((err) => {
        if (!cancelled) setParticipantsError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setParticipantsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // participants 는 "이전 목록" 비교용으로만 쓰므로 deps 에 넣지 않는다(무한루프 방지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractIds.join(",")]);

  // 통합허가 용역 세분류 옵션(트리에서 동적 수집)
  const subtypeOptions = useMemo(() => {
    const values = new Set<string>();
    for (const g of tree?.groups ?? []) {
      for (const c of g.contracts) {
        if (c.serviceSubtype) values.add(canonicalServiceSubtype(c.serviceSubtype));
      }
      if (g.serviceType === "통합허가") values.add("최초허가");
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b, "ko"));
  }, [tree]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!tree) return [];
    return (tree.groups ?? [])
      .map((g) => ({
        ...g,
        contracts: g.contracts.filter((c) => {
          const textMatch =
            !q ||
            c.contractTitle.toLowerCase().includes(q) ||
            c.counterpartyName.toLowerCase().includes(q);
          const subtypeMatch = !subtypeFilter || canonicalServiceSubtype(c.serviceSubtype) === subtypeFilter;
          const industryMatch =
            !industryFilter ||
            matchesIndustryText([c.industryCategory, c.facilityIndustryName, c.facilityIndustryCode], industryFilter);
          return textMatch && subtypeMatch && industryMatch;
        }),
      }))
      .filter((g) => g.contracts.length > 0);
  }, [tree, search, subtypeFilter, industryFilter]);

  const uploadForm = async (file: File) => {
    if (!bid?.orgName) {
      alert("공고의 발주기관명이 없어 양식을 등록할 수 없습니다.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("orgName", bid.orgName);
      fd.append("file", file);
      const res = await fetch("/api/sales/bids/package/form", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "양식 업로드 실패");
      setForm(data.form ?? null);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  // 문서 생성 — 저장된 작업 상태(양식·계약·인력) 기준으로 채움본 HWPX zip 다운로드
  const generate = async () => {
    if (!bidId) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/sales/bids/package/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidType, bidId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string })?.error ?? "문서 생성 실패");
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition");
      const m = cd?.match(/filename\*=UTF-8''([^;]+)/);
      const name = m ? decodeURIComponent(m[1]) : "입찰서류패키지.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const save = useCallback(async () => {
    if (!bidId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/sales/bids/package", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidType,
          bidId,
          formId: form?.formId ?? null,
          contractIds,
          employeeIds: Array.from(pickedEmployees),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setPkg(data.package ?? null);
      setSavedAt(new Date().toLocaleTimeString("ko-KR"));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [bidType, bidId, form, contractIds, pickedEmployees]);

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<FileStack className="w-5 h-5" />}
        eyebrow={`Bid · Package · ${TYPE_LABEL[bidType] ?? bidType}`}
        title="입찰 서류 생성"
        subtitle="입찰 공고의 제출 서류 양식과 실적 계약·수행인력을 확정해 증빙서류 패키지를 생성합니다."
        actions={
          <div className="flex items-center gap-2">
            {savedAt && <span className="text-[11px] cd-text-faint">저장됨 {savedAt}</span>}
            <button
              type="button"
              onClick={save}
              disabled={saving || loading || !bid}
              className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? "저장 중..." : "작업 상태 저장"}
            </button>
            <Link href="/sales/bids" className="cd-btn cd-btn-soft rounded-lg px-3.5 py-2 text-xs inline-flex items-center gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" /> 공공입찰로
            </Link>
          </div>
        }
      />

      {loading ? (
        <div className="cd-card rounded-3xl p-8 text-center text-sm cd-text-faint">불러오는 중입니다.</div>
      ) : error ? (
        <div className="cd-card rounded-3xl p-8 text-center text-sm cd-text-faint">{error}</div>
      ) : bid ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scrollbar-hide pb-2">
          {/* 공고 요약 */}
          <section className="cd-card rounded-3xl p-5 cd-reveal delay-1">
            <div className="text-[11px] font-bold" style={{ color: "var(--cd-primary)" }}>{TYPE_LABEL[bidType]}</div>
            <h2 className="text-lg font-bold cd-text">{bid.title ?? "-"}</h2>
            <div className="mt-2 grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-2 text-[12px]">
              <div><span className="cd-text-faint">발주기관</span><div className="cd-text">{bid.orgName ?? "-"}</div></div>
              <div><span className="cd-text-faint">공고번호</span><div className="cd-text font-mono">{bid.externalId}</div></div>
              <div><span className="cd-text-faint">예산</span><div className="cd-text">{fmtMoney(bid.budget)}</div></div>
              <div><span className="cd-text-faint">게시일</span><div className="cd-text font-mono">{short(bid.postedAt)}</div></div>
              <div><span className="cd-text-faint">마감</span><div className="cd-text font-mono">{short(bid.deadline)}</div></div>
            </div>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* ① 제출 양식 — 발주처 라이브러리 */}
            <section className="cd-card rounded-3xl p-5 cd-reveal delay-2 flex flex-col gap-3">
              <h3 className="font-bold cd-text flex items-center gap-2">
                <FileText className="w-4 h-4 cd-text-primary" />
                ① 제출 서류 양식
                <span className="ml-auto text-[11px] font-normal cd-text-faint">발주처 기본 양식 라이브러리</span>
              </h3>
              <p className="text-[12px] leading-relaxed cd-text-faint">
                이 공고 첨부(제안요청서 등)의 제출 서류 양식을 업로드하면 발주처
                {bid.orgName ? ` (${bid.orgName})` : ""}의 기본 양식으로 등록되어, 같은 발주처의 다음 입찰
                건에서 자동으로 제안됩니다. 양식이 바뀐 경우 다시 업로드하면 교체됩니다.
              </p>
              {form ? (
                <div className="rounded-xl border border-[color:var(--cd-primary)] cd-tint-primary px-3 py-2.5 flex items-center gap-2 text-[12px]">
                  <Check className="w-4 h-4 cd-text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="cd-text truncate font-semibold">{form.displayName}</p>
                    <p className="cd-text-faint text-[11px]">
                      {form.orgName} 기본 양식 · {fmtBytes(form.byteSize)} · {short(form.updatedAt)} 등록
                      {form.hasProfile ? " · 분석 완료" : " · 미분석"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border cd-border-c px-3 py-2.5 text-[12px] cd-text-faint">
                  등록된 발주처 양식이 없습니다. 공고 첨부의 제출 서류 양식 파일을 업로드하세요.
                </div>
              )}
              <label className="cd-btn cd-btn-soft rounded-lg px-3.5 py-2 text-xs font-semibold self-start cursor-pointer inline-flex items-center gap-1.5">
                <Paperclip className="w-3.5 h-3.5" />
                {uploading ? "업로드 중..." : form ? "양식 교체 업로드" : "양식 업로드"}
                <input
                  type="file"
                  className="hidden"
                  accept=".hwpx,.hwp,.pdf,.docx,.doc,.zip"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadForm(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {/* 양식 분석·매핑 미세조정(P2) — HWPX 표·셀 → 표준 서류 항목 */}
              {form && (
                <FormProfilePanel
                  formId={form.formId}
                  hasProfile={form.hasProfile}
                  onProfileChange={(has) => setForm((prev) => (prev ? { ...prev, hasProfile: has } : prev))}
                />
              )}
            </section>

            {/* ④ 문서 구성(안내) — 생성은 P3 */}
            <section className="cd-card rounded-3xl p-5 cd-reveal delay-2 flex flex-col gap-3">
              <h3 className="font-bold cd-text flex items-center gap-2">
                <FileStack className="w-4 h-4 cd-text-primary" />
                ④ 패키지 문서 구성
                <span className="ml-auto text-[11px] font-normal cd-text-faint">준비 중 — 양식 분석 후 활성화</span>
              </h3>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-[12px]">
                {PACKAGE_DOCS.map((d, i) => (
                  <li key={d} className="rounded-lg border cd-border-c px-3 py-2 cd-text flex items-center gap-2">
                    <span className="text-[10px] font-mono cd-text-faint shrink-0">{i + 1}</span>
                    <span className="truncate">{d}</span>
                  </li>
                ))}
                <li className="rounded-lg border cd-border-c px-3 py-2 cd-text-faint flex items-center gap-2 md:col-span-2">
                  <span className="text-[10px] font-mono shrink-0">+</span>
                  인력별 첨부: 경력확인서 → 졸업증명서(박사→석사→학사) → 자격증 사본(지정 순서)
                </li>
              </ul>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={generate}
                  disabled={generating || !form?.hasProfile || contractIds.length === 0}
                  className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50 self-start"
                  title="저장된 작업 상태(양식 매핑·실적 계약·수행인력) 기준으로 채움본 HWPX 를 생성합니다. 생성 전 '작업 상태 저장'을 눌러 주세요."
                >
                  {generating ? "생성 중..." : "문서 생성 (HWPX)"}
                </button>
                {!form?.hasProfile && <span className="text-[10px] cd-text-faint">양식 분석(매핑) 후 활성화됩니다.</span>}
              </div>
              <p className="text-[10px] cd-text-faint">
                PDF 변환본·인력별 첨부(경력확인서·졸업증명서·자격증) 병합은 다음 단계에서 추가됩니다.
              </p>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 min-h-[420px]">
            {/* ② 실적 계약 선택 */}
            <section className="cd-card rounded-3xl p-5 cd-reveal delay-3 flex flex-col min-h-0">
              <h3 className="font-bold cd-text flex items-center gap-2 mb-3">
                <CheckSquare className="w-4 h-4 cd-text-primary" />
                ② 실적 계약 선택
                <span className="ml-auto text-[11px] font-normal cd-text-faint">{checked.size.toLocaleString()}건 선택</span>
                <button
                  type="button"
                  className="cd-btn cd-btn-ghost rounded-lg px-2.5 py-1 text-[11px] cd-text-muted"
                  disabled={checked.size === 0}
                  onClick={() => { setChecked(new Set()); setPickedEmployees(new Set()); }}
                >
                  일괄 해제
                </button>
              </h3>
              <div className="flex items-center gap-2 mb-2">
                <Search className="w-4 h-4 cd-text-faint shrink-0" />
                <input className="cd-input text-xs flex-1 min-w-0" placeholder="계약명 / 거래처 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
                {/* 통합허가 실적 인정 범위(발전·증기/열공급·폐기물소각 등) 한정용 필터 */}
                <select className="cd-select text-xs shrink-0" style={{ width: "13ch" }} value={subtypeFilter} onChange={(e) => setSubtypeFilter(e.target.value)}>
                  <option value="">세분류 전체</option>
                  {subtypeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="cd-select text-xs shrink-0" style={{ width: "13ch" }} value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)}>
                  <option value="">업종 전체</option>
                  {INTEGRATED_PERMIT_INDUSTRIES.map((i) => <option key={i.label} value={i.label}>{i.label}</option>)}
                </select>
                <select className="cd-select text-xs shrink-0" style={{ width: "11ch" }} value={year} onChange={(e) => setYear(e.target.value)}>
                  <option value="">전체 연도</option>
                  {(tree?.availableYears ?? []).map((y) => <option key={y} value={y}>{y}년</option>)}
                </select>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide rounded-xl border cd-border-c">
                {filteredGroups.length === 0 ? (
                  <p className="p-5 text-sm cd-text-faint">표시할 계약이 없습니다.</p>
                ) : (
                  filteredGroups.map((group) => {
                    const style = resolveServiceTypeStyle(group.serviceType);
                    const isOpen = expanded[group.serviceType] === true;
                    return (
                      <div key={group.serviceType}>
                        <button
                          type="button"
                          onClick={() => setExpanded((prev) => ({ ...prev, [group.serviceType]: !prev[group.serviceType] }))}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[color:var(--cd-surface)] border-b cd-border-c"
                        >
                          {isOpen ? <ChevronDown className="w-4 h-4 cd-text-faint" /> : <ChevronRight className="w-4 h-4 cd-text-faint" />}
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: style.parentColor }} />
                          <span className="text-[13px] cd-text">{group.serviceType}</span>
                          <span className="text-[11px] cd-text-faint ml-auto">{group.contracts.length}건</span>
                        </button>
                        {isOpen &&
                          group.contracts.map((c) => (
                            <label key={c.contractId} className="w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs hover:bg-[color:var(--cd-surface)] cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked.has(c.contractId)}
                                onChange={() =>
                                  setChecked((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(c.contractId)) next.delete(c.contractId);
                                    else next.add(c.contractId);
                                    return next;
                                  })
                                }
                              />
                              <span className="truncate cd-text">{c.contractTitle}</span>
                              <span className="ml-auto shrink-0 text-[10px] font-mono cd-text-faint">{c.contractDate ?? "-"}</span>
                            </label>
                          ))}
                      </div>
                    );
                  })
                )}
              </div>
              {checked.size > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 max-h-[72px] overflow-y-auto scrollbar-hide">
                  {contractIds.map((id) => (
                    <span key={id} className="text-[10px] rounded-full px-2 py-0.5 cd-tint-primary cd-text truncate max-w-[220px]" title={nodeCache.get(id)?.contractTitle ?? id}>
                      {nodeCache.get(id)?.contractTitle ?? id}
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* ③ 수행인력 확정 */}
            <section className="cd-card rounded-3xl p-5 cd-reveal delay-3 flex flex-col min-h-0">
              <h3 className="font-bold cd-text flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 cd-text-primary" />
                ③ 수행인력 확정
                <span className="ml-auto text-[11px] font-normal cd-text-faint">
                  {pickedEmployees.size.toLocaleString()}명 선택 / 후보 {participants.length.toLocaleString()}명
                </span>
              </h3>
              <p className="text-[12px] cd-text-faint mb-2">
                선택한 실적 계약의 수행인력을 합산한 후보입니다. 이 용역 입찰에 제출할 기술인력만 남기세요.
                확정 인력 기준으로 집계표·개별 이력사항과 경력확인서·졸업증명서·자격증 사본이 구성됩니다.
              </p>
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide rounded-xl border cd-border-c">
                {participantsLoading ? (
                  <p className="p-5 text-sm cd-text-faint">수행인력을 불러오는 중입니다.</p>
                ) : participantsError ? (
                  <p className="p-5 text-sm cd-error-text">{participantsError}</p>
                ) : participants.length === 0 ? (
                  <p className="p-5 text-sm cd-text-faint">
                    {contractIds.length > 0
                      ? "선택한 계약에 등록된 수행인력이 없습니다. 계약 상세의 공정표/수행인력에서 인력을 지정하세요."
                      : "실적 계약을 선택하면 수행인력 후보가 표시됩니다."}
                  </p>
                ) : (
                  participants.map((p) => (
                    <label key={p.employeeId} className="w-full flex items-center gap-2.5 px-3 py-2 text-xs border-b cd-border-c last:border-b-0 hover:bg-[color:var(--cd-surface)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pickedEmployees.has(p.employeeId)}
                        onChange={() =>
                          setPickedEmployees((prev) => {
                            const next = new Set(prev);
                            if (next.has(p.employeeId)) next.delete(p.employeeId);
                            else next.add(p.employeeId);
                            return next;
                          })
                        }
                      />
                      <span className="cd-text font-semibold shrink-0">{p.name}</span>
                      <span className="cd-text-faint shrink-0">{p.positionName ?? ""}</span>
                      {p.engGrade && <span className="text-[10px] rounded-full px-1.5 py-0.5 cd-tint-primary shrink-0">{p.engGrade}</span>}
                      {p.specialtyField && <span className="text-[10px] cd-text-faint shrink-0">{p.specialtyField}</span>}
                      <span className="ml-auto text-[10px] cd-text-faint shrink-0">참여 {p.contractCount}건</span>
                    </label>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
