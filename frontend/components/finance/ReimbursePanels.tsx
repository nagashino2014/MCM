"use client";

// 경비 환급 패널 (accounting-expansion §2 — 환급은 급여 합산 금지·별도 이체, 이체 실행은 수동)
// 결재 종결된 지출결의·출장보고의 개인 지출 행(영수증·수기 — 법인카드 제외)을 기안자별로 집계해
// 이체 실행의 근거 목록을 보여준다. 식대 불지급(withhold) 처분 행(근태 관리 "식대 경고" 탭,
// 마이그 203·204)은 합계에서 자동 제외되고 취소선으로 표시된다. 급여 차감(deduct) 처분 행은
// 환급에 포함하되 뱃지로 표시한다(회수는 급여대장 '식대환수' 공제 — 여기서도 빼면 이중 불이익).
// FinanceBoard 의 소메뉴 "계좌·카드 원장" 그룹에서 렌더된다(cdash 스타일 관례 동일).

import { useCallback, useEffect, useState } from "react";
import { HandCoins, UserRound, XCircle } from "lucide-react";

interface ReimburseRow {
  docId: string;
  docNo: string | null;
  formId: string;
  rowNo: number;
  usedOn: string | null;
  vendor: string | null;
  category: string | null;
  amount: number;
  kind: "receipt" | "manual";
  mealAction: "withhold" | "deduct" | null;
}

interface ReimburseEmployee {
  employeeId: string;
  name: string;
  payable: number;
  withheldTotal: number;
  withheldCount: number;
  rows: ReimburseRow[];
}

interface ReimburseList {
  employees: ReimburseEmployee[];
  summary: { people: number; rowCount: number; payableTotal: number; withheldTotal: number; withheldCount: number };
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

export function ReimbursePanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<ReimburseList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/reimbursements?year=${y}&month=${m}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "환급 목록을 불러오지 못했습니다.");
      setData(d as ReimburseList);
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load(year, month);
  }, [load, year, month]);

  const s = data?.summary;
  const years = [now.getFullYear(), now.getFullYear() - 1];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] cd-text-muted">
        결재 종결된 <b>지출결의·출장보고</b>의 개인 지출(개인카드 영수증·수기 행)을 기안자별로 집계한 <b>환급 이체 목록</b>입니다
        (법인카드 행 제외 · 급여 합산 금지, 별도 이체). 근태 관리의 <b>식대 경고</b> 탭에서 <b>불지급</b> 처분된 행은
        합계에서 자동 제외됩니다. <b>급여 차감</b> 처분 행은 환급에 포함되며 급여대장 &lsquo;식대환수&rsquo; 공제로 회수됩니다.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] cd-text-faint">결재 종결 월</span>
        <select className="cd-select" style={{ width: 110 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select className="cd-select" style={{ width: 100 }} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
      </div>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard icon={<UserRound className="w-4 h-4" />} label="환급 인원" value={`${s.people}명`} />
          <SummaryCard icon={<HandCoins className="w-4 h-4" />} label="환급 총액" value={`${won(s.payableTotal)}원`} />
          <SummaryCard icon={<XCircle className="w-4 h-4" />} label="불지급 제외" value={s.withheldCount > 0 ? `${s.withheldCount}건 · ${won(s.withheldTotal)}원` : "없음"} danger={s.withheldCount > 0} />
          <SummaryCard icon={<HandCoins className="w-4 h-4" />} label="지출 행" value={`${s.rowCount}건`} />
        </div>
      )}

      {error && <p className="text-[13px]" style={{ color: "var(--cd-error)" }}>{error}</p>}
      {loading ? (
        <p className="text-[13px] cd-text-faint">불러오는 중입니다.</p>
      ) : !data || data.employees.length === 0 ? (
        <p className="text-[13px] cd-text-faint py-4">해당 월에 결재 종결된 개인 지출이 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.employees.map((e) => (
            <div key={e.employeeId} className="rounded-2xl border cd-border-c overflow-hidden">
              <div className="flex items-center justify-between px-3.5 py-2.5 border-b cd-border-c">
                <span className="text-[13px] font-bold cd-text">{e.name}</span>
                <span className="text-[13px] cd-text">
                  이체액 <b>{won(e.payable)}원</b>
                  {e.withheldCount > 0 && (
                    <span className="ml-2 text-[11px]" style={{ color: "var(--cd-error)" }}>
                      (불지급 {e.withheldCount}건 {won(e.withheldTotal)}원 제외)
                    </span>
                  )}
                </span>
              </div>
              <div className="hidden md:grid px-3 py-1.5 text-[10.5px] font-bold cd-text-faint border-b cd-border-c" style={reimburseGrid}>
                <span>사용일</span>
                <span>문서번호</span>
                <span>사용처</span>
                <span>분류</span>
                <span>구분</span>
                <span className="text-right">금액</span>
                <span>처분</span>
              </div>
              {e.rows.map((r) => {
                const withheld = r.mealAction === "withhold";
                return (
                  <div
                    key={`${r.docId}-${r.rowNo}`}
                    className="grid items-center px-3 py-1.5 border-b cd-border-c last:border-b-0 text-[12px]"
                    style={{ ...reimburseGrid, opacity: withheld ? 0.6 : undefined }}
                  >
                    <span className="cd-text">{r.usedOn ?? "-"}</span>
                    <span className="cd-text-faint truncate">{r.docNo ?? "-"}</span>
                    <span className={`cd-text truncate ${withheld ? "line-through" : ""}`}>{r.vendor ?? "-"}</span>
                    <span className="cd-text-faint truncate">{r.category ?? "-"}</span>
                    <span className="cd-text-faint">{r.kind === "receipt" ? "영수증" : "수기"}</span>
                    <span className={`text-right cd-text ${withheld ? "line-through" : ""}`}>{won(r.amount)}원</span>
                    <span>
                      {r.mealAction === "withhold" && (
                        <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: "var(--cd-error)", color: "#fff" }}>불지급 제외</span>
                      )}
                      {r.mealAction === "deduct" && (
                        <span className="text-[10px] font-bold rounded-full px-2 py-0.5" style={{ background: "var(--cd-warning,#FFAE1F)", color: "#fff" }}>급여 차감</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, danger }: { icon: React.ReactNode; label: string; value: string; danger?: boolean }) {
  return (
    <div className="cd-card p-3.5">
      <span className="flex items-center gap-3">
        <span
          className="inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
          style={{
            background: danger ? "var(--cd-error)" : "var(--cd-primary-soft)",
            color: danger ? "#fff" : "var(--cd-primary)",
          }}
        >
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] cd-text-faint">{label}</span>
          <span className="block text-[15px] font-extrabold cd-text tracking-tight">{value}</span>
        </span>
      </span>
    </div>
  );
}

const reimburseGrid = {
  display: "grid",
  gridTemplateColumns: "0.8fr minmax(0,1fr) minmax(0,1.3fr) 0.9fr 0.6fr 0.8fr 0.9fr",
  gap: "8px",
} as const;
