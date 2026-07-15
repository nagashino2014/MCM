"use client";

// 공공입찰(bid) 보드 — 나라장터 발주계획/사전규격/입찰공고 목록.
// 종류 탭 + 필터 + 서버 페이지네이션 테이블 + 원문 링크. IntelBoard 패턴 축약본.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Gavel, Search, ExternalLink, Wand2 } from "lucide-react";
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

const TABS: { key: BidType; label: string }[] = [
  { key: "bid_notice", label: "입찰공고" },
  { key: "prior_spec", label: "사전규격" },
  { key: "order_plan", label: "발주계획" },
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

export function BidBoard() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor";
  const { theme } = useCdashTheme();

  const [bidType, setBidType] = useState<BidType>("bid_notice");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [workType, setWorkType] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<BidRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setOffset(0), [bidType, qDebounced, workType]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ bidType, limit: String(PAGE_SIZE), offset: String(offset) });
      if (qDebounced) p.set("q", qDebounced);
      if (workType) p.set("workType", workType);
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
  }, [bidType, qDebounced, workType, offset]);

  useEffect(() => {
    load();
  }, [load]);

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
            <Link href="/sales/bids/sources" className="cd-chip">
              <Wand2 className="w-3.5 h-3.5" /> 공공입찰 소스
            </Link>
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

        {/* 필터 */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
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
        </div>

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
                <tr key={r.bidId}>
                  <td className="truncate max-w-[160px]">{r.orgName ?? "-"}</td>
                  <td className="truncate max-w-[280px]">{r.title ?? "-"}</td>
                  <td className="text-right font-mono tabular-nums">{fmtMoney(r.budget)}</td>
                  <td className="font-mono text-[12px] cd-text-faint">{short(r.postedAt)}</td>
                  <td className="font-mono text-[12px] cd-text-faint">{short(r.deadline)}</td>
                  <td>{r.method ?? "-"}</td>
                  <td>
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
    </div>
  );
}
