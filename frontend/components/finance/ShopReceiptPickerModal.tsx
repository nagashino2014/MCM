"use client";

// 쇼핑몰 전표 불러오기 모달(2026-09-15 사용자 요청) — 지출결의서(법인카드) 기안 화면 전용.
// 구매품의로 산 물건은 바로빌 카드 매출전표에 품목이 없어, 재무 > 쇼핑몰 전표 수집으로 올려 둔
// 품목 표기 전표(shop_receipts)를 골라 표 행·첨부(PDF)로 담는다. CardPickerModal 의 형제.
// 이미 표에 담긴 카드 승인건(_cardTxnId)과 매칭된 전표는 행을 만들지 않고 PDF 첨부만 추가한다(부모가 판단).

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, RefreshCw, Search } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { DigitDateInput } from "@/components/finance/DigitDateInput";

export interface ShopReceiptPickerItem {
  receiptId: string;
  site: string;
  siteName: string;
  orderNo: string;
  orderDate: string;
  title: string;
  amount: number;
  receiptType: string;
  cardLast4: string;
  approvalNum: string;
  storageKey: string | null;
  fileName: string | null;
  matchedTxnId: string | null;
  matchedTxn: { approvedAt: string; amountTotal: number; storeName: string; cardAlias: string; cardLast4: string } | null;
  docId: string | null;
}

const ymdInput = (d: Date) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const daysAgo = (n: number) => ymdInput(new Date(Date.now() - n * 86400000));

export function ShopReceiptPickerModal({
  open,
  onClose,
  existingIds,
  existingCardTxnIds,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** 이미 이 문서 표에 담긴 전표(_shopReceiptId) */
  existingIds: string[];
  /** 이미 이 문서 표에 담긴 카드 승인건(_cardTxnId) — 매칭된 전표는 첨부만 붙는다는 안내용 */
  existingCardTxnIds: string[];
  onPick: (items: ShopReceiptPickerItem[]) => void;
}) {
  const [from, setFrom] = useState(() => daysAgo(90));
  const [to, setTo] = useState(() => ymdInput(new Date()));
  const [site, setSite] = useState("");
  const [keyword, setKeyword] = useState("");
  const [sites, setSites] = useState<{ key: string; name: string }[]>([]);
  const [items, setItems] = useState<ShopReceiptPickerItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (site) params.set("site", site);
      if (keyword.trim()) params.set("keyword", keyword.trim());
      const res = await fetch(`/api/receipts/shop/picker?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "쇼핑몰 전표를 불러오지 못했습니다.");
      setItems(data.items ?? []);
      setSites(data.sites ?? []);
      if (data.error) setError(String(data.error));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [from, to, site, keyword]);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      load();
    }
  }, [open, load]);

  const existing = useMemo(() => new Set(existingIds), [existingIds]);
  const existingCards = useMemo(() => new Set(existingCardTxnIds), [existingCardTxnIds]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () => {
    const picked = items.filter((i) => selected.has(i.receiptId));
    if (!picked.length) return;
    onPick(picked);
    onClose();
  };

  return (
    <CdModal
      open={open}
      onClose={onClose}
      title="쇼핑몰 전표 불러오기"
      size="xl"
      footer={
        <>
          <span className="text-xs cd-text-muted mr-auto">{selected.size}건 선택 — 전표 PDF가 첨부서류에 함께 추가됩니다</span>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>
            취소
          </button>
          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={selected.size === 0} onClick={submit}>
            표에 추가
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="cd-label text-xs">주문일</label>
          <DigitDateInput value={from} onChange={setFrom} className="cd-input text-center" style={{ width: 116 }} />
          <span className="cd-text-muted">~</span>
          <DigitDateInput value={to} onChange={setTo} className="cd-input text-center" style={{ width: 116 }} />
          <select className="cd-select text-[13px]" style={{ width: 120 }} value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">전체 쇼핑몰</option>
            {sites.map((s) => (
              <option key={s.key} value={s.key}>{s.name}</option>
            ))}
          </select>
          <span className="relative flex items-center">
            <Search className="w-3.5 h-3.5 cd-text-faint absolute left-2" />
            <input
              className="cd-input text-[13px]"
              style={{ width: 180, paddingLeft: 26 }}
              placeholder="품목·주문번호 검색"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
            />
          </span>
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={load} disabled={loading}>
            <RefreshCw className="w-3.5 h-3.5" /> 조회
          </button>
          <span className="text-[11px] cd-text-faint ml-auto">
            재무 &gt; 쇼핑몰 전표 수집으로 올린 전표만 표시됩니다 — 표에 담긴 카드 승인건과 매칭된 전표는 첨부만 추가됩니다
          </span>
        </div>

        {error && <div className="cd-error-text text-sm">{error}</div>}

        <div className="overflow-x-auto max-h-[50vh] overflow-y-auto border cd-border-c rounded-xl">
          <table className="w-full text-sm">
            <thead className="cd-table-head sticky top-0">
              <tr className="cd-text-muted text-left">
                <th className="py-2 px-3 font-normal w-8"></th>
                <th className="py-2 pr-3 font-normal">주문일</th>
                <th className="py-2 pr-3 font-normal">쇼핑몰</th>
                <th className="py-2 pr-3 font-normal">품목</th>
                <th className="py-2 pr-3 font-normal text-right">금액</th>
                <th className="py-2 pr-3 font-normal">카드</th>
                <th className="py-2 font-normal">전표</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const used = existing.has(item.receiptId) || (!!item.docId && !existing.has(item.receiptId));
                const attachOnly = !!item.matchedTxnId && existingCards.has(item.matchedTxnId);
                const noFile = !item.storageKey;
                const disabled = used || noFile;
                return (
                  <tr
                    key={item.receiptId}
                    className={`border-t cd-hairline-row-c ${disabled ? "opacity-45" : "cursor-pointer cd-row-hover"}`}
                    onClick={() => !disabled && toggle(item.receiptId)}
                  >
                    <td className="py-1.5 px-3">
                      <input type="checkbox" checked={selected.has(item.receiptId)} disabled={disabled} readOnly />
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{item.orderDate || "-"}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{item.siteName}</td>
                    <td className="py-1.5 pr-3 max-w-[280px] truncate" title={item.title}>
                      {item.title || `주문 ${item.orderNo}`}
                      {existing.has(item.receiptId) && <span className="ml-1.5 text-[10px] cd-text-faint">(이미 담김)</span>}
                      {item.docId && !existing.has(item.receiptId) && <span className="ml-1.5 text-[10px] cd-text-faint">(다른 문서에 사용)</span>}
                      {attachOnly && !used && <span className="ml-1.5 text-[10px] cd-text-primary">(카드 행에 첨부만)</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium whitespace-nowrap">{item.amount.toLocaleString("ko-KR")}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{item.cardLast4 ? `****${item.cardLast4}` : "-"}</td>
                    <td className="py-1.5">
                      {item.storageKey ? (
                        <a
                          className="cd-text-primary inline-flex items-center gap-1 text-xs"
                          // 재무 권한이 없는 기안자도 열 수 있게 결재 첨부 미리보기 경로(shop-receipts/ 허용)로 연다.
                          href={`/api/approval/attachments/preview?key=${encodeURIComponent(item.storageKey)}&name=${encodeURIComponent(item.fileName ?? "전표.pdf")}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <FileText className="w-3.5 h-3.5" /> PDF
                        </a>
                      ) : (
                        <span className="cd-pill cd-pill-idle">파일 없음</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center cd-text-muted text-sm">
                    해당 기간에 올라온 쇼핑몰 전표가 없습니다. 재무 &gt; 쇼핑몰 전표 수집에서 전표를 올린 뒤 다시 조회하세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </CdModal>
  );
}
