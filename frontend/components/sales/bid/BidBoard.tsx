"use client";

// 공공입찰(bid) 보드 — 나라장터 발주계획/사전규격/입찰공고 목록.
// 종류 탭 + 필터(키워드·업무구분·게시일 기간·예산 금액대·지역권·계약방법·용역 분류) +
// 서버 페이지네이션 테이블 + 상세 모달(발주계획↔사전규격↔입찰공고 연계 링크) + 분류 설정.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Gavel, Search, ExternalLink, Wand2, SlidersHorizontal, Tags, X, Link2, Plus, Trash2 } from "lucide-react";
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
const METHODS = [
  { value: "일반경쟁", label: "일반경쟁" },
  { value: "제한경쟁", label: "제한경쟁" },
  { value: "지명경쟁", label: "지명경쟁" },
  { value: "수의", label: "수의(소액 포함)" },
  { value: "적격", label: "적격심사" },
];
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

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(
    () => setOffset(0),
    [bidType, qDebounced, workType, postedFrom, postedTo, budgetMinMan, budgetMaxMan, regionGroup, method, categoryId]
  );

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
      const res = await fetch(`/api/sales/bids?${p.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setRows(d.items ?? []);
      setTotal(d.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [bidType, qDebounced, workType, postedFrom, postedTo, budgetMinMan, budgetMaxMan, regionGroup, method, categoryId, offset]);

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
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
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

        {/* 테이블 */}
        <div className="overflow-x-auto">
          <table className="cd-table text-[13px] w-full">
            <thead>
              <tr>
                <th className="text-left">발주기관</th>
                <th className="text-left">사업명</th>
                <th className="text-right">예산</th>
                <th className="text-left">게시일</th>
                <th className="text-left">마감</th>
                <th className="text-left">조달방식</th>
                <th className="text-left">원문</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bidId} className="cursor-pointer hover:bg-[color:var(--cd-surface)]" onClick={() => openDetail(bidType, r.bidId)}>
                  <td className="truncate max-w-[160px]">{r.orgName ?? "-"}</td>
                  <td className="truncate max-w-[280px]">{r.title ?? "-"}</td>
                  <td className="text-right font-mono tabular-nums">{fmtMoney(r.budget)}</td>
                  <td className="font-mono text-[12px] cd-text-faint">{short(r.postedAt)}</td>
                  <td className="font-mono text-[12px] cd-text-faint">{short(r.deadline)}</td>
                  <td>{r.method ?? "-"}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer" className="cd-text-muted hover:cd-text">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 cd-text-faint">
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
                  <div><span className="cd-text-faint">마감</span><div className="cd-text font-mono">{short(detail.deadline)}</div></div>
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
