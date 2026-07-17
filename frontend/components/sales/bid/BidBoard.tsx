"use client";

// 공공입찰(bid) 보드 — 나라장터 발주계획/사전규격/입찰공고 목록.
// 종류 탭 + 필터(키워드·업무구분·게시일 기간·예산 금액대·지역권·계약방법·용역 분류) +
// 서버 페이지네이션 테이블 + 상세 모달(발주계획↔사전규격↔입찰공고 연계 링크) + 분류 설정.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Gavel, Search, ExternalLink, Wand2, SlidersHorizontal, Tags, X, Link2, Plus, Trash2, Columns3, ArrowUp, ArrowDown, ChevronUp, ChevronDown, Paperclip } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { PaginationControls } from "@/components/ui/PaginationControls";
import "@/components/cdash/cdash.css";

type BidType = "order_plan" | "prior_spec" | "bid_notice";

interface BidRow {
  bidId: string;
  externalId: string;
  orgName: string | null;
  title: string | null;
  budget: number | null;
  postedAt: string | null;
  deadline: string | null;
  method: string | null;
  workType: string | null;
  category: string | null;
  url: string | null;
  /** 발주계획 전용 — 발주년도-발주월(예: 2026-07). */
  orderPeriod: string | null;
  /** 커스텀 열 값(columns 순서와 동일, 서버 계산). */
  cells?: (string | null)[];
}

interface ViewColumn {
  label: string;
  parts: string[];
  mode: "single" | "join" | "calc";
  sep?: string;
  op?: "+" | "-" | "*" | "/";
  format?: "text" | "money" | "date" | "link";
  sortable?: boolean;
}

interface FieldCandidate {
  name: string;
  nameKo?: string;
}

interface BidDetail extends BidRow {
  raw: Record<string, unknown>;
}

interface RelatedBid {
  bidType: BidType;
  bidId: string;
  title: string | null;
  orgName: string | null;
  postedAt: string | null;
}

interface BidCategory {
  categoryId: string;
  name: string;
  keywords: string[];
  enabled: boolean;
}

const TABS: { key: BidType; label: string }[] = [
  { key: "bid_notice", label: "입찰공고" },
  { key: "prior_spec", label: "사전규격" },
  { key: "order_plan", label: "발주계획" },
];
const TYPE_LABEL: Record<BidType, string> = { order_plan: "발주계획", prior_spec: "사전규격", bid_notice: "입찰공고" };
const REGION_GROUPS = ["수도권", "강원권", "충청권", "경북권", "경남권", "전라권", "제주권"];
const PAGE_SIZE = 20;

function fmtMoney(n: number | null): string {
  if (!n || n <= 0) return "-";
  const eok = Math.floor(n / 1e8);
  const man = Math.round((n - eok * 1e8) / 1e4);
  if (eok > 0) return man > 0 ? `${eok}억 ${man.toLocaleString("ko-KR")}만` : `${eok}억`;
  if (man > 0) return `${man.toLocaleString("ko-KR")}만`;
  return n.toLocaleString("ko-KR");
}
const short = (s: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "-");

/**
 * raw 응답에서 첨부파일(URL+파일명) 쌍 추출 — 나라장터 표준: ntceSpecDocUrl{N}↔ntceSpecFileNm{N},
 * stdNtceDocUrl 등 "…DocUrl{N}" 패턴 전반(사전규격도 동일 규칙). URL 은 g2b 직다운로드 링크.
 */
function extractAttachments(raw: Record<string, unknown> | undefined): { name: string; url: string }[] {
  if (!raw) return [];
  const out: { name: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const k of Object.keys(raw)) {
    const m = k.match(/^(.*)DocUrl(\d*)$/);
    if (!m) continue;
    const url = String(raw[k] ?? "").trim();
    if (!/^https?:\/\//.test(url)) continue;
    const nameKey = `${m[1]}FileNm${m[2]}`;
    const name = String(raw[nameKey] ?? "").trim() || `첨부파일${m[2] ? ` ${m[2]}` : ""}`;
    const sig = `${name}|${url}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ name, url });
  }
  return out;
}

async function jfetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

export function BidBoard() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor";
  const { theme } = useCdashTheme();

  const [bidType, setBidType] = useState<BidType>("bid_notice");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [workType, setWorkType] = useState("");
  // 확장 필터
  const [showFilters, setShowFilters] = useState(false);
  const [postedFrom, setPostedFrom] = useState("");
  const [postedTo, setPostedTo] = useState("");
  const [budgetMinMan, setBudgetMinMan] = useState(""); // 만원 단위 입력
  const [budgetMaxMan, setBudgetMaxMan] = useState("");
  const [regionGroup, setRegionGroup] = useState("");
  const [method, setMethod] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const [categories, setCategories] = useState<BidCategory[]>([]);
  /** 계약방법 옵션 — 해당 종류의 실데이터 distinct(서버 제공). */
  const [methodOptions, setMethodOptions] = useState<string[]>([]);
  /** 커스텀 열 구성(서버 제공, 없으면 기본). */
  const [columns, setColumns] = useState<ViewColumn[]>([]);
  /** 헤더 클릭 정렬 — 열 인덱스 기준(desc→asc→기본 토글). */
  const [sortCol, setSortCol] = useState<number>(-1);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<BidRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 상세 모달
  const [detail, setDetail] = useState<BidDetail | null>(null);
  const [detailType, setDetailType] = useState<BidType>("bid_notice");
  const [related, setRelated] = useState<RelatedBid[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // 분류 설정 모달
  const [catModal, setCatModal] = useState(false);
  const [catName, setCatName] = useState("");
  const [catKeywords, setCatKeywords] = useState("");
  const [catBusy, setCatBusy] = useState(false);

  // 열 설정 모달
  const [colModal, setColModal] = useState(false);
  const [colDraft, setColDraft] = useState<ViewColumn[]>([]);
  const [colCandidates, setColCandidates] = useState<FieldCandidate[]>([]);
  const [colIsDefault, setColIsDefault] = useState(true);
  const [colBusy, setColBusy] = useState(false);
  // 새 열 폼
  const [ncLabel, setNcLabel] = useState("");
  const [ncParts, setNcParts] = useState<string[]>([]);
  const [ncPartSel, setNcPartSel] = useState("");
  const [ncMode, setNcMode] = useState<"single" | "join" | "calc">("single");
  const [ncSep, setNcSep] = useState("/");
  const [ncOp, setNcOp] = useState<"+" | "-" | "*" | "/">("+");
  const [ncFormat, setNcFormat] = useState<"text" | "money" | "date" | "link">("text");
  const [ncSortable, setNcSortable] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(
    () => setOffset(0),
    [bidType, qDebounced, workType, postedFrom, postedTo, budgetMinMan, budgetMaxMan, regionGroup, method, categoryId, sortCol, sortDir]
  );
  useEffect(() => setSortCol(-1), [bidType]);

  const loadCategories = useCallback(async () => {
    try {
      const d = await jfetch("/api/sales/bids/categories");
      setCategories((d.categories ?? []).filter((c: BidCategory) => c.enabled));
    } catch {
      // 분류는 부가 기능 — 실패해도 목록은 동작
    }
  }, []);
  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ bidType, limit: String(PAGE_SIZE), offset: String(offset) });
      if (qDebounced) p.set("q", qDebounced);
      if (workType) p.set("workType", workType);
      if (postedFrom) p.set("postedFrom", postedFrom);
      if (postedTo) p.set("postedTo", postedTo);
      const bmin = Number(budgetMinMan);
      const bmax = Number(budgetMaxMan);
      if (Number.isFinite(bmin) && bmin > 0) p.set("budgetMin", String(bmin * 10000));
      if (Number.isFinite(bmax) && bmax > 0) p.set("budgetMax", String(bmax * 10000));
      if (regionGroup) p.set("regionGroup", regionGroup);
      if (method) p.set("method", method);
      if (categoryId) p.set("categoryId", categoryId);
      // 정렬 — 열의 첫 필드 기준, money/calc 열은 숫자 캐스팅
      const sc = sortCol >= 0 ? columns[sortCol] : null;
      if (sc?.parts?.[0]) {
        p.set("sortField", sc.parts[0]);
        p.set("sortDir", sortDir);
        if (sc.format === "money" || sc.mode === "calc") p.set("sortNumeric", "1");
      }
      const res = await fetch(`/api/sales/bids?${p.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setRows(d.items ?? []);
      setTotal(d.total ?? 0);
      if (Array.isArray(d.methods)) setMethodOptions(d.methods);
      if (Array.isArray(d.columns)) setColumns(d.columns);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
    // columns 는 응답으로 갱신되므로 deps 에 넣지 않는다(재조회 루프 방지) — 정렬 시점엔 이미 로드됨.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidType, qDebounced, workType, postedFrom, postedTo, budgetMinMan, budgetMaxMan, regionGroup, method, categoryId, sortCol, sortDir, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = useCallback(async (type: BidType, bidId: string) => {
    setDetailLoading(true);
    setDetail(null);
    setRelated([]);
    setDetailType(type);
    try {
      const d = await jfetch(`/api/sales/bids/${bidId}/related?bidType=${type}`);
      setDetail(d.detail ?? null);
      setRelated(d.related ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const addCategory = async () => {
    if (!catName.trim()) return;
    setCatBusy(true);
    try {
      await jfetch("/api/sales/bids/categories", {
        method: "POST",
        body: JSON.stringify({ name: catName.trim(), keywords: catKeywords.split(",").map((s) => s.trim()).filter(Boolean) }),
      });
      setCatName("");
      setCatKeywords("");
      await loadCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCatBusy(false);
    }
  };

  // ── 열 설정 ──
  const openColModal = async () => {
    setColModal(true);
    setColBusy(true);
    try {
      const d = await jfetch(`/api/sales/bids/view-config?bidType=${bidType}`);
      setColDraft(Array.isArray(d.columns) ? d.columns : []);
      setColCandidates(Array.isArray(d.candidates) ? d.candidates : []);
      setColIsDefault(!!d.isDefault);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setColBusy(false);
    }
  };

  const saveColConfig = async (cols: ViewColumn[]) => {
    setColBusy(true);
    try {
      const d = await jfetch("/api/sales/bids/view-config", {
        method: "PUT",
        body: JSON.stringify({ bidType, columns: cols }),
      });
      setColDraft(Array.isArray(d.columns) ? d.columns : []);
      setColIsDefault(!!d.isDefault);
      setColModal(false);
      setSortCol(-1);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setColBusy(false);
    }
  };

  const koOf = (name: string) => colCandidates.find((c) => c.name === name)?.nameKo;

  const addColumn = () => {
    if (!ncLabel.trim() || ncParts.length === 0) return;
    const col: ViewColumn = {
      label: ncLabel.trim(),
      parts: ncParts,
      mode: ncParts.length > 1 ? ncMode : "single",
      ...(ncMode === "join" && ncParts.length > 1 ? { sep: ncSep } : {}),
      ...(ncMode === "calc" && ncParts.length > 1 ? { op: ncOp } : {}),
      ...(ncFormat !== "text" ? { format: ncFormat } : {}),
      ...(ncSortable ? { sortable: true } : {}),
    };
    setColDraft((p) => [...p, col]);
    setNcLabel("");
    setNcParts([]);
    setNcMode("single");
    setNcSortable(false);
    setNcFormat("text");
  };

  const removeCategory = async (c: BidCategory) => {
    if (!confirm(`분류 "${c.name}"를 삭제할까요?`)) return;
    setCatBusy(true);
    try {
      await jfetch(`/api/sales/bids/categories/${c.categoryId}`, { method: "DELETE" });
      if (categoryId === c.categoryId) setCategoryId("");
      await loadCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCatBusy(false);
    }
  };

  // 상세 모달의 주요 raw 필드(있을 때만 표시)
  const rawExtras: { label: string; key: string }[] = [
    { label: "담당부서", key: "deptNm" },
    { label: "담당자", key: "ofclNm" },
    { label: "전화", key: "telNo" },
    { label: "공사지역", key: "cnstwkRgnNm" },
    { label: "발주년도", key: "orderYear" },
    { label: "발주월", key: "orderMnth" },
    { label: "총괄기관", key: "totlmngInsttNm" },
  ];

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Gavel className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="공공입찰"
        titleSuffix={`${total.toLocaleString()}건`}
        subtitle="나라장터(조달청) 발주계획·사전규격·입찰공고를 수집해 종류별로 조회합니다."
        actions={
          canEdit ? (
            <div className="flex items-center gap-2">
              <button type="button" className="cd-chip" onClick={openColModal}>
                <Columns3 className="w-3.5 h-3.5" /> 열 설정
              </button>
              <button type="button" className="cd-chip" onClick={() => setCatModal(true)}>
                <Tags className="w-3.5 h-3.5" /> 분류 설정
              </button>
              <Link href="/sales/bids/sources" className="cd-chip">
                <Wand2 className="w-3.5 h-3.5" /> 공공입찰 소스
              </Link>
            </div>
          ) : undefined
        }
      />

      <section className="cd-card-bg rounded-2xl border cd-border-c p-4">
        {/* 종류 탭 */}
        <div className="flex items-center gap-1 flex-wrap mb-3">
          {TABS.map((t) => (
            <button key={t.key} className="cd-chip cd-chip-sm" data-active={bidType === t.key} onClick={() => setBidType(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {/* 기본 필터 */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <div className="flex items-center gap-1.5">
            <Search className="w-4 h-4 cd-text-faint" />
            <input className="cd-input" style={{ width: 220 }} placeholder="사업명·발주기관 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="cd-select" style={{ width: "auto" }} value={workType} onChange={(e) => setWorkType(e.target.value)}>
            <option value="">업무구분 전체</option>
            <option value="용역">용역</option>
            <option value="공사">공사</option>
            <option value="물품">물품</option>
            <option value="외자">외자</option>
          </select>
          <select className="cd-select" style={{ width: "auto" }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">용역 분류 전체</option>
            {categories.map((c) => (
              <option key={c.categoryId} value={c.categoryId}>{c.name}</option>
            ))}
          </select>
          <select className="cd-select" style={{ width: "auto" }} value={regionGroup} onChange={(e) => setRegionGroup(e.target.value)}>
            <option value="">지역권 전체</option>
            {REGION_GROUPS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <select className="cd-select" style={{ width: "auto" }} value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">계약방법 전체</option>
            {methodOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            {method && !methodOptions.includes(method) && <option value={method}>{method}</option>}
          </select>
          <button type="button" className="cd-chip cd-chip-sm" data-active={showFilters} onClick={() => setShowFilters((v) => !v)}>
            <SlidersHorizontal className="w-3.5 h-3.5" /> 기간·금액
          </button>
        </div>

        {/* 확장 필터: 게시일 기간 + 예산 금액대 */}
        {showFilters && (
          <div className="flex items-center gap-3 flex-wrap mb-3 rounded-lg border cd-border-c px-3 py-2 text-[12px] cd-text-muted">
            <label className="flex items-center gap-1.5 whitespace-nowrap">
              게시일
              <input type="date" className="cd-input text-[12px]" style={{ width: 140 }} value={postedFrom} onChange={(e) => setPostedFrom(e.target.value)} />
              ~
              <input type="date" className="cd-input text-[12px]" style={{ width: 140 }} value={postedTo} onChange={(e) => setPostedTo(e.target.value)} />
            </label>
            <label className="flex items-center gap-1.5 whitespace-nowrap">
              예산
              <input type="number" min={0} className="cd-input text-[12px]" style={{ width: 110 }} placeholder="최소(만원)" value={budgetMinMan} onChange={(e) => setBudgetMinMan(e.target.value)} />
              ~
              <input type="number" min={0} className="cd-input text-[12px]" style={{ width: 110 }} placeholder="최대(만원)" value={budgetMaxMan} onChange={(e) => setBudgetMaxMan(e.target.value)} />
              만원
            </label>
            <button
              type="button"
              className="cd-btn cd-btn-soft text-[11px]"
              onClick={() => {
                setPostedFrom("");
                setPostedTo("");
                setBudgetMinMan("");
                setBudgetMaxMan("");
              }}
            >
              초기화
            </button>
          </div>
        )}

        {/* 테이블 — 커스텀 열 구성(columns) 기반 동적 렌더. 헤더 클릭 정렬(sortable 열). */}
        <div className="overflow-x-auto">
          <table className="cd-table text-[13px] w-full">
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th
                    key={`${c.label}-${i}`}
                    className={(c.format === "money" ? "text-right " : "text-left ") + (c.sortable ? "cursor-pointer select-none" : "")}
                    onClick={
                      c.sortable
                        ? () => {
                            if (sortCol !== i) {
                              setSortCol(i);
                              setSortDir("desc");
                            } else if (sortDir === "desc") {
                              setSortDir("asc");
                            } else {
                              setSortCol(-1); // 기본 정렬로 복귀
                            }
                          }
                        : undefined
                    }
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {c.label}
                      {sortCol === i && (sortDir === "desc" ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bidId} className="cursor-pointer hover:bg-[color:var(--cd-surface)]" onClick={() => openDetail(bidType, r.bidId)}>
                  {columns.map((c, i) => {
                    const v = r.cells?.[i] ?? null;
                    if (c.format === "link") {
                      return (
                        <td key={i} onClick={(e) => e.stopPropagation()}>
                          {v ? (
                            <a href={v} target="_blank" rel="noreferrer" className="cd-text-muted hover:cd-text">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          ) : (
                            "-"
                          )}
                        </td>
                      );
                    }
                    if (c.format === "money") {
                      return <td key={i} className="text-right font-mono tabular-nums">{fmtMoney(v != null ? Number(v) : null)}</td>;
                    }
                    if (c.format === "date") {
                      return <td key={i} className="font-mono text-[12px] cd-text-faint">{short(v)}</td>;
                    }
                    return <td key={i} className="truncate max-w-[280px]">{v ?? "-"}</td>;
                  })}
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} className="text-center py-8 cd-text-faint">
                    {error ? "불러오지 못했습니다." : "수집된 공고가 없습니다."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <PaginationControls
          total={total}
          limit={PAGE_SIZE}
          offset={offset}
          loading={loading}
          onPageChange={setOffset}
        />
      </section>

      {/* 상세 모달 (인라인 오버레이 — .cdash 내부라 토큰 유지) */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setDetail(null)}>
          <div className="cd-card-bg rounded-2xl border cd-border-c w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            {detailLoading && <p className="text-[13px] cd-text-faint py-8 text-center">불러오는 중…</p>}
            {detail && (
              <>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-bold" style={{ color: "var(--cd-primary)" }}>{TYPE_LABEL[detailType]}</div>
                    <h3 className="text-[15px] font-bold cd-text">{detail.title ?? "-"}</h3>
                    <div className="text-[12px] cd-text-muted">{detail.orgName ?? "-"}</div>
                  </div>
                  <button type="button" className="cd-btn cd-btn-soft text-[12px] shrink-0" onClick={() => setDetail(null)}>
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2 text-[12px]">
                  <div><span className="cd-text-faint">공고번호</span><div className="cd-text font-mono">{detail.externalId}</div></div>
                  <div><span className="cd-text-faint">예산</span><div className="cd-text">{fmtMoney(detail.budget)}</div></div>
                  <div><span className="cd-text-faint">게시일</span><div className="cd-text font-mono">{short(detail.postedAt)}</div></div>
                  {detailType === "order_plan" ? (
                    <div><span className="cd-text-faint">발주시기</span><div className="cd-text font-mono">{detail.orderPeriod ?? "-"}</div></div>
                  ) : (
                    <div><span className="cd-text-faint">마감</span><div className="cd-text font-mono">{short(detail.deadline)}</div></div>
                  )}
                  <div><span className="cd-text-faint">조달방식</span><div className="cd-text">{detail.method ?? "-"}</div></div>
                  <div><span className="cd-text-faint">업무구분</span><div className="cd-text">{detail.workType ?? "-"}</div></div>
                  {rawExtras.map(({ label, key }) => {
                    const v = detail.raw?.[key];
                    if (v == null || v === "") return null;
                    return (
                      <div key={key}><span className="cd-text-faint">{label}</span><div className="cd-text truncate">{String(v)}</div></div>
                    );
                  })}
                </div>

                {detail.url && (
                  <a href={detail.url} target="_blank" rel="noreferrer" className="cd-chip self-start" style={{ color: "var(--cd-primary)" }}>
                    <ExternalLink className="w-3.5 h-3.5" /> 원문 보기
                  </a>
                )}

                {/* 첨부파일 — raw 의 …DocUrl{N}/…FileNm{N} 쌍(공고문·과업지시서·제안요청서 등 직다운로드) */}
                {(() => {
                  const atts = extractAttachments(detail.raw);
                  if (!atts.length) return null;
                  return (
                    <div className="border-t cd-border-c pt-3 flex flex-col gap-1.5">
                      <h4 className="text-[12px] font-bold cd-text flex items-center gap-1">
                        <Paperclip className="w-3.5 h-3.5" /> 첨부파일 ({atts.length})
                      </h4>
                      {atts.map((a, i) => (
                        <a
                          key={`${a.url}-${i}`}
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[12px] cd-text-muted hover:cd-text flex items-center gap-1.5 min-w-0"
                        >
                          <Paperclip className="w-3 h-3 shrink-0 cd-text-faint" />
                          <span className="truncate">{a.name}</span>
                        </a>
                      ))}
                    </div>
                  );
                })()}

                {/* 연계 공고 — 발주계획↔사전규격↔입찰공고 */}
                <div className="border-t cd-border-c pt-3 flex flex-col gap-1.5">
                  <h4 className="text-[12px] font-bold cd-text flex items-center gap-1">
                    <Link2 className="w-3.5 h-3.5" /> 같은 사업의 연계 공고
                  </h4>
                  {related.length === 0 && <p className="text-[12px] cd-text-faint">연계된 발주계획·사전규격·입찰공고를 찾지 못했습니다.</p>}
                  {related.map((r) => (
                    <button
                      key={`${r.bidType}-${r.bidId}`}
                      type="button"
                      onClick={() => openDetail(r.bidType, r.bidId)}
                      className="text-left rounded-lg border cd-border-c px-3 py-2 hover:bg-[color:var(--cd-surface)] flex items-center gap-2"
                    >
                      <span className="text-[10px] rounded-full px-1.5 py-0.5 cd-tint-primary shrink-0">{TYPE_LABEL[r.bidType]}</span>
                      <span className="text-[12px] cd-text truncate flex-1">{r.title ?? "-"}</span>
                      <span className="text-[11px] cd-text-faint font-mono shrink-0">{short(r.postedAt)}</span>
                    </button>
                  ))}
                </div>

                <details>
                  <summary className="text-[11px] cd-text-faint cursor-pointer">원본 데이터(전체 필드)</summary>
                  <pre className="text-[11px] cd-text-muted bg-[color:var(--cd-surface)] rounded p-2 overflow-x-auto max-h-60 mt-1">
                    {JSON.stringify(detail.raw, null, 2)}
                  </pre>
                </details>
              </>
            )}
          </div>
        </div>
      )}

      {/* 열 설정 모달 — 탭(종류)별 표시 열 구성: 순서·조합(구분자/사칙연산)·형식·정렬 여부 */}
      {colModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setColModal(false)}>
          <div className="cd-card-bg rounded-2xl border cd-border-c w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-bold cd-text flex items-center gap-1.5 flex-1">
                <Columns3 className="w-4 h-4" /> 열 설정 — {TABS.find((t) => t.key === bidType)?.label}
                {colIsDefault && <span className="text-[11px] cd-text-faint">(기본 구성)</span>}
              </h3>
              <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={() => setColModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] cd-text-faint">
              엔드포인트가 수집하는 필드로 열을 구성합니다. 여러 필드를 한 열에 조합(구분자 결합·사칙연산)할 수 있고, 순서와 정렬 가능 여부를 지정합니다.
            </p>

            {/* 현재 열 목록 */}
            <div className="flex flex-col gap-1.5">
              {colDraft.map((c, i) => (
                <div key={`${c.label}-${i}`} className="rounded-lg border cd-border-c px-3 py-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] cd-text font-semibold">{c.label}</div>
                    <div className="text-[11px] cd-text-faint truncate font-mono">
                      {c.parts.join(c.mode === "calc" ? ` ${c.op ?? "+"} ` : c.mode === "join" ? ` ${c.sep ?? ", "} ` : ", ")}
                      {c.format && c.format !== "text" ? ` · ${c.format}` : ""}
                    </div>
                  </div>
                  <label className="text-[11px] cd-text-muted flex items-center gap-1 whitespace-nowrap cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!c.sortable}
                      onChange={() => setColDraft((p) => p.map((x, j) => (j === i ? { ...x, sortable: !x.sortable } : x)))}
                    />
                    정렬
                  </label>
                  <button type="button" disabled={i === 0} className="cd-btn cd-btn-soft text-[11px] disabled:opacity-40"
                    onClick={() => setColDraft((p) => { const n = [...p]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })}>
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" disabled={i === colDraft.length - 1} className="cd-btn cd-btn-soft text-[11px] disabled:opacity-40"
                    onClick={() => setColDraft((p) => { const n = [...p]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; return n; })}>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" className="cd-btn cd-btn-soft text-[11px]" onClick={() => setColDraft((p) => p.filter((_, j) => j !== i))}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {colDraft.length === 0 && <p className="text-[12px] cd-text-faint">열이 없습니다 — 저장하면 기본 구성으로 복귀합니다.</p>}
            </div>

            {/* 열 추가 */}
            <div className="border-t cd-border-c pt-3 flex flex-col gap-2">
              <div className="text-[11px] font-bold cd-text-faint">열 추가</div>
              <div className="flex items-center gap-2 flex-wrap">
                <input className="cd-input text-[13px]" style={{ width: 140 }} placeholder="열 이름 (예: 발주시기)" value={ncLabel} onChange={(e) => setNcLabel(e.target.value)} />
                <select className="cd-select text-[12px]" style={{ width: 220 }} value={ncPartSel} onChange={(e) => setNcPartSel(e.target.value)}>
                  <option value="">필드 선택…</option>
                  {colCandidates.map((f) => (
                    <option key={f.name} value={f.name}>{f.nameKo ? `${f.nameKo} (${f.name})` : f.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="cd-btn cd-btn-soft text-[12px]"
                  disabled={!ncPartSel || ncParts.includes(ncPartSel) || ncParts.length >= 5}
                  onClick={() => { setNcParts((p) => [...p, ncPartSel]); setNcPartSel(""); }}
                >
                  <Plus className="w-3.5 h-3.5" /> 필드 추가
                </button>
              </div>
              {ncParts.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {ncParts.map((p) => (
                    <span key={p} className="cd-chip cd-chip-sm font-mono">
                      {koOf(p) ? `${koOf(p)}(${p})` : p}
                      <button type="button" className="ml-1" onClick={() => setNcParts((prev) => prev.filter((x) => x !== p))}>
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap text-[12px] cd-text-muted">
                {ncParts.length > 1 && (
                  <>
                    <select className="cd-select text-[12px]" value={ncMode} onChange={(e) => setNcMode(e.target.value as typeof ncMode)}>
                      <option value="join">구분자로 결합</option>
                      <option value="single">첫 값만</option>
                      <option value="calc">사칙연산</option>
                    </select>
                    {ncMode === "join" && (
                      <input className="cd-input text-[12px] font-mono" style={{ width: 64 }} placeholder="구분자" title="구분자 (예: / 또는 ,)" value={ncSep} onChange={(e) => setNcSep(e.target.value)} />
                    )}
                    {ncMode === "calc" && (
                      <select className="cd-select text-[12px]" value={ncOp} onChange={(e) => setNcOp(e.target.value as typeof ncOp)}>
                        <option value="+">+ 더하기</option>
                        <option value="-">− 빼기</option>
                        <option value="*">× 곱하기</option>
                        <option value="/">÷ 나누기</option>
                      </select>
                    )}
                  </>
                )}
                <select className="cd-select text-[12px]" value={ncFormat} onChange={(e) => setNcFormat(e.target.value as typeof ncFormat)}>
                  <option value="text">형식: 텍스트</option>
                  <option value="money">형식: 금액(억/만)</option>
                  <option value="date">형식: 일시</option>
                  <option value="link">형식: 링크</option>
                </select>
                <label className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
                  <input type="checkbox" checked={ncSortable} onChange={(e) => setNcSortable(e.target.checked)} /> 정렬 가능
                </label>
                <button type="button" className="cd-btn cd-btn-primary text-[12px] disabled:opacity-50" disabled={!ncLabel.trim() || ncParts.length === 0} onClick={addColumn}>
                  <Plus className="w-3.5 h-3.5" /> 열 추가
                </button>
              </div>
            </div>

            <div className="border-t cd-border-c pt-3 flex items-center gap-2">
              <button type="button" disabled={colBusy} className="cd-btn cd-btn-primary text-[13px] disabled:opacity-50" onClick={() => saveColConfig(colDraft)}>
                저장
              </button>
              <button type="button" disabled={colBusy} className="cd-btn cd-btn-soft text-[13px] disabled:opacity-50" onClick={() => saveColConfig([])}>
                기본값 복원
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 분류 설정 모달 */}
      {catModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setCatModal(false)}>
          <div className="cd-card-bg rounded-2xl border cd-border-c w-full max-w-lg max-h-[80vh] overflow-y-auto p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-bold cd-text flex items-center gap-1.5 flex-1">
                <Tags className="w-4 h-4" /> 용역 분류 설정
              </h3>
              <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={() => setCatModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] cd-text-faint">
              분류별 검색 키워드를 등록하면 사업명에서 키워드 중 하나라도 포함된 공고를 찾습니다. (예: 통합허가 → 통합환경, 통합허가)
            </p>
            <div className="flex flex-col gap-2">
              {categories.map((c) => (
                <div key={c.categoryId} className="rounded-lg border cd-border-c px-3 py-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] cd-text font-semibold">{c.name}</div>
                    <div className="text-[11px] cd-text-faint truncate">{c.keywords.join(", ") || "(키워드 없음)"}</div>
                  </div>
                  <button type="button" disabled={catBusy} className="cd-btn cd-btn-soft text-[11px]" onClick={() => removeCategory(c)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {categories.length === 0 && <p className="text-[12px] cd-text-faint">등록된 분류가 없습니다.</p>}
            </div>
            <div className="border-t cd-border-c pt-3 flex flex-col gap-2">
              <input className="cd-input text-[13px]" placeholder="분류명 (예: 통합허가)" value={catName} onChange={(e) => setCatName(e.target.value)} />
              <input className="cd-input text-[13px]" placeholder="검색 키워드 (콤마 구분, 예: 통합환경, 통합허가)" value={catKeywords} onChange={(e) => setCatKeywords(e.target.value)} />
              <button type="button" disabled={catBusy || !catName.trim()} className="cd-btn cd-btn-primary text-[13px] self-start disabled:opacity-50" onClick={addCategory}>
                <Plus className="w-4 h-4" /> 분류 추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
