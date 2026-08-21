"use client";

/* ================= 올라온 쇼핑몰 전표 =================
 *
 * 수집은 개인 PC 에서만 되지만 조회는 어디서든 된다 — 이 목록이 스테이징에서 보는 화면이다.
 * 개인 PC 의 앱에서 [스테이징으로 올리기] 를 누르면 여기에 쌓인다.
 */

import { useCallback, useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";

interface ShopReceiptRow {
  receiptId: string;
  site: string;
  orderNo: string;
  orderDate: string;
  title: string;
  amount: number;
  receiptType: string;
  storageKey: string | null;
  fileName: string | null;
}

const SITE_NAMES: Record<string, string> = {
  "11st": "11번가",
  gmarket: "G마켓",
  auction: "옥션",
  naver: "네이버페이",
  coupang: "쿠팡",
};

interface Props {
  /** 위 수집 카드에서 고른 기간을 그대로 쓴다 */
  from: string;
  to: string;
  /** 올리기가 끝난 뒤 다시 읽도록 부모가 올려 주는 값 */
  reloadToken?: number;
}

export function ShopReceiptRecords({ from, to, reloadToken }: Props) {
  const [rows, setRows] = useState<ShopReceiptRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [site, setSite] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (site) params.set("site", site);

      const res = await fetch(`/api/receipts/shop/records?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "전표를 불러오지 못했습니다.");

      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      if (data.error) setError(data.error);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [from, to, site]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="cd-card-title mr-auto">올라온 전표</div>

        <select className="cd-select w-auto" value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">전체 쇼핑몰</option>
          {Object.entries(SITE_NAMES).map(([key, name]) => (
            <option key={key} value={key}>{name}</option>
          ))}
        </select>

        <button type="button" className="cd-btn cd-btn-sm" onClick={() => void load()}>
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}

      <div className="text-xs cd-text-muted mb-2">
        {from} ~ {to} · {rows.length.toLocaleString()}건 · 합계 {total.toLocaleString()}원
      </div>

      {loading ? (
        <div className="text-sm cd-text-muted">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm cd-text-muted">
          이 기간에 올라온 전표가 없습니다. 개인 PC 의 전표 수집 앱에서 <b>스테이징으로 올리기</b> 를 실행하세요.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="cd-text-muted text-xs">
                <th className="text-left font-normal py-1.5 pr-3">쇼핑몰</th>
                <th className="text-left font-normal py-1.5 pr-3">주문일</th>
                <th className="text-left font-normal py-1.5 pr-3">주문번호</th>
                <th className="text-left font-normal py-1.5 pr-3">품목</th>
                <th className="text-right font-normal py-1.5 pr-3">금액</th>
                <th className="text-left font-normal py-1.5">전표</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.receiptId} className="border-t cd-border-c">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{SITE_NAMES[row.site] ?? row.site}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap cd-text-muted">{row.orderDate || "-"}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap cd-text-muted">{row.orderNo}</td>
                  <td className="py-1.5 pr-3">{row.title || "-"}</td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                    {row.amount ? `${row.amount.toLocaleString()}원` : "-"}
                  </td>
                  <td className="py-1.5">
                    {row.storageKey ? (
                      <a
                        className="cd-text-primary inline-flex items-center gap-1"
                        href={`/api/receipts/shop/file?key=${encodeURIComponent(row.storageKey)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <FileText size={13} /> 열기
                      </a>
                    ) : (
                      <span className="cd-text-faint">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
