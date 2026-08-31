"use client";

// 사업·기타소득 대장(FRM-P4, 205) — 전문가활용비 승인 적재분의 대장 조회.
// 실무 엑셀 대장(기타소득 & 사업소득대장)의 열 구성 그대로, 세무 제출용 엑셀 다운로드 지원.

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

interface LedgerRow {
  entryId: string;
  incomeKind: "business" | "other";
  payDate: string;
  payeeName: string;
  payeeRrnMasked: string | null;
  grossAmount: number;
  necessaryExpense: number;
  taxableIncome: number;
  incomeTax: number;
  localTax: number;
  withheldTotal: number;
  netAmount: number;
  note: string | null;
  docNo: string | null;
}

const won = (n: number) => n.toLocaleString("ko-KR");

export function IncomeLedgerPanel() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [kind, setKind] = useState<"other" | "business">("other");
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/finance/income-ledger?year=${year}&kind=${kind}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.error) setError(String(d.error));
        else {
          setRows(Array.isArray(d.rows) ? d.rows : []);
          setError(null);
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [year, kind]);

  const isOther = kind === "other";
  const t = (fn: (r: LedgerRow) => number) => rows.reduce((a, r) => a + fn(r), 0);

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <div className="cd-card-title mr-auto">{isOther ? "기타소득대장 (거주자)" : "사업소득대장 (거주자)"}</div>
        <div className="flex items-center gap-1.5">
          {([
            ["other", "기타소득 (일비 등)"],
            ["business", "사업소득 (자문료 등)"],
          ] as ["other" | "business", string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`cd-chip ${kind === k ? "" : "cd-text-muted"}`} data-active={kind === k || undefined}>
              {label}
            </button>
          ))}
        </div>
        <select className="cd-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear - 1, thisYear].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => window.open(`/api/finance/income-ledger?year=${year}&format=xlsx`, "_blank")}>
          <Download className="w-3.5 h-3.5" /> 대장 엑셀
        </button>
      </div>
      <div className="text-xs cd-text-muted mb-3">
        전문가활용비 지급 신청서 승인 건이 자동 적재됩니다. {isOther ? "기타소득: 필요경비 80% 공제 후 소득세 20%·지방세 10% (과세소득 5만원 이하 징수 없음)." : "사업소득: 소득세 3%·지방세 10% (소득세 1,000원 미만 징수 없음)."}
        {" "}원천세 신고 집계는 부가세 신고 → 원천세 탭의 A25·A42 열로 반영됩니다.
      </div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">번호</th>
              <th className="py-1.5 pr-3 font-normal">지급일</th>
              <th className="py-1.5 pr-3 font-normal">소득자</th>
              <th className="py-1.5 pr-3 font-normal">주민등록번호</th>
              <th className="py-1.5 pr-3 font-normal text-right">지급총액</th>
              {isOther && <th className="py-1.5 pr-3 font-normal text-right">필요경비(80%)</th>}
              {isOther && <th className="py-1.5 pr-3 font-normal text-right">과세소득</th>}
              <th className="py-1.5 pr-3 font-normal text-right">소득세({isOther ? "20%" : "3%"})</th>
              <th className="py-1.5 pr-3 font-normal text-right">주민세(10%)</th>
              <th className="py-1.5 pr-3 font-normal text-right">징수세액</th>
              <th className="py-1.5 pr-3 font-normal text-right">차감지급액</th>
              <th className="py-1.5 pr-3 font-normal">비고</th>
              <th className="py-1.5 font-normal">문서번호</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.entryId} className="border-t cd-hairline-row-c">
                <td className="py-1.5 pr-3">{i + 1}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{r.payDate}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{r.payeeName}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{r.payeeRrnMasked ?? "-"}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(r.grossAmount)}</td>
                {isOther && <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(r.necessaryExpense)}</td>}
                {isOther && <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(r.taxableIncome)}</td>}
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(r.incomeTax)}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(r.localTax)}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(r.withheldTotal)}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap font-medium">{won(r.netAmount)}</td>
                <td className="py-1.5 pr-3 text-xs">{r.note ?? "-"}</td>
                <td className="py-1.5 whitespace-nowrap text-xs">{r.docNo ?? "-"}</td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="border-t cd-hairline-row-c font-semibold">
                <td className="py-2 pr-3">계</td>
                <td className="py-2 pr-3" colSpan={3} />
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(t((r) => r.grossAmount))}</td>
                {isOther && <td className="py-2 pr-3 text-right whitespace-nowrap">{won(t((r) => r.necessaryExpense))}</td>}
                {isOther && <td className="py-2 pr-3 text-right whitespace-nowrap">{won(t((r) => r.taxableIncome))}</td>}
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(t((r) => r.incomeTax))}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(t((r) => r.localTax))}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(t((r) => r.withheldTotal))}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap">{won(t((r) => r.netAmount))}</td>
                <td className="py-2" colSpan={2} />
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={isOther ? 13 : 11} className="py-6 text-center cd-text-muted text-sm">{year}년 {isOther ? "기타소득" : "사업소득"} 지급 내역이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
