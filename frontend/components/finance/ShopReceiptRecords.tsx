"use client";

/* ================= 올라온 쇼핑몰 전표 — 카드 원장 매칭 보드 =================
 *
 * 수집은 개인 PC 에서만 되지만 이 화면은 어디서든 된다 — 스테이징에서 부가세 신고 시 보는 화면.
 * 전표(승인번호·카드끝4·금액·날짜)를 법인카드 원장(card_transactions)과 잇고,
 * 원장 기준으로 전표가 빠진 쇼핑몰 결제도 보여 준다(수집 누락 확인).
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ban, CheckCircle2, Download, FileText, Link2, Loader2, RefreshCw, RotateCcw, Unlink, Wand2 } from "lucide-react";

interface MatchedTxn {
  approvedAt: string;
  amountTotal: number;
  storeName: string;
  cardAlias: string;
  cardLast4: string;
}

interface ShopReceiptRow {
  receiptId: string;
  site: string;
  orderNo: string;
  orderDate: string;
  title: string;
  amount: number;
  receiptType: string;
  approvalNum: string;
  cardLast4: string;
  storageKey: string | null;
  excluded: boolean;
  matchStatus: "auto" | "manual" | null;
  matchBasis: string | null;
  matchedTxn: MatchedTxn | null;
}

interface CandidateTxn {
  cardTxnId: string;
  approvedAt: string;
  approvedDate: string;
  amountTotal: number;
  approvalNum: string;
  storeName: string;
  cardAlias: string;
  cardCompany: string;
  cardLast4: string;
  matchedCount: number;
}

const SITE_NAMES: Record<string, string> = {
  "11st": "11번가",
  gmarket: "G마켓",
  auction: "옥션",
  naver: "네이버페이",
  coupang: "쿠팡",
};

/**
 * 매칭 검증 — 전표의 주문일과 원장 승인일이 이틀 넘게 벌어지면 의심 건으로 표시한다.
 * (전표 날짜 오추출로 잘못 붙은 매칭을 눈으로 골라내는 용도)
 */
function dateSuspicious(row: ShopReceiptRow): boolean {
  if (!row.matchedTxn || !row.orderDate) return false;
  const approved = row.matchedTxn.approvedAt.slice(0, 10);
  if (!approved) return false;
  const diff = Math.abs(new Date(row.orderDate).getTime() - new Date(approved).getTime());
  return diff > 2 * 86400000;
}

/** Content-Disposition 의 filename*=UTF-8''… 에서 저장 파일명을 꺼낸다 */
function fileNameFromDisposition(header: string | null, fallback: string): string {
  const m = /filename\*=UTF-8''([^;]+)/i.exec(header ?? "");
  if (!m) return fallback;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return fallback;
  }
}

const BASIS_LABELS: Record<string, string> = {
  approval: "승인번호 일치",
  card: "카드끝4+금액+날짜",
  "order-sum": "주문 합산 일치",
  manual: "수동 연결",
};

interface Props {
  /** 위 수집 카드에서 고른 기간을 그대로 쓴다 */
  from: string;
  to: string;
  /** 올리기가 끝난 뒤 다시 읽도록 부모가 올려 주는 값 */
  reloadToken?: number;
  /** 기간 선택 줄 — 수집 카드가 없는 웹(스테이징) 화면에서 부모가 넣는다 */
  periodControls?: ReactNode;
}

export function ShopReceiptRecords({ from, to, reloadToken, periodControls }: Props) {
  const [rows, setRows] = useState<ShopReceiptRow[]>([]);
  const [uncovered, setUncovered] = useState<CandidateTxn[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [site, setSite] = useState("");
  const [matching, setMatching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showUncovered, setShowUncovered] = useState(false);

  /** 후보를 펼쳐 둔 전표(행 아래 인라인으로 연다 — 포털 모달의 토큰 문제를 피한다) */
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateTxn[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // 일괄 다운로드(2026-10-14 사용자 요청) — 세무 대리인에게 보낼 전표를 골라 병합 PDF 또는 전표별 PDF(ZIP)로 받는다.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<"merged" | "zip">("merged");
  const [downloading, setDownloading] = useState(false);
  const headCheckRef = useRef<HTMLInputElement | null>(null);

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
      setUncovered(data.uncovered ?? []);
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

  const runAutoMatch = async () => {
    setMatching(true);
    setNotice(null);
    try {
      const res = await fetch("/api/receipts/shop/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "자동 매칭에 실패했습니다.");
      setNotice(`자동 매칭 — 미매칭 ${data.total}건 중 ${data.matched}건을 연결했습니다.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMatching(false);
    }
  };

  const openPicker = async (receiptId: string) => {
    if (pickerFor === receiptId) {
      setPickerFor(null);
      return;
    }
    setPickerFor(receiptId);
    setCandidates([]);
    setPickerLoading(true);
    try {
      const res = await fetch(`/api/receipts/shop/match?receiptId=${encodeURIComponent(receiptId)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "후보를 불러오지 못했습니다.");
      setCandidates(data.candidates ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPickerLoading(false);
    }
  };

  /** 매칭 제외(개인카드 결제 등) / 복원 — 실수로 눌러도 [복원] 으로 바로 되돌린다 */
  const setExcluded = async (receiptId: string, excluded: boolean) => {
    try {
      const res = await fetch("/api/receipts/shop/match", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ receiptId, excluded }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "제외 처리에 실패했습니다.");
      setPickerFor(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const setMatch = async (receiptId: string, txnId: string | null) => {
    try {
      const res = await fetch("/api/receipts/shop/match", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ receiptId, txnId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "연결에 실패했습니다.");
      setPickerFor(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // 목록이 바뀌면(기간·쇼핑몰 변경, 새로고침) 지금 목록에 없는 선택은 버린다.
  useEffect(() => {
    setChecked((prev) => {
      const ids = new Set(rows.map((r) => r.receiptId));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  /** PDF 가 있는 전표만 고를 수 있다 */
  const selectable = useMemo(() => rows.filter((r) => r.storageKey), [rows]);
  const checkedRows = selectable.filter((r) => checked.has(r.receiptId));
  const checkedTotal = checkedRows.reduce((sum, r) => sum + (r.amount || 0), 0);
  const allChecked = selectable.length > 0 && checkedRows.length === selectable.length;

  useEffect(() => {
    if (headCheckRef.current) headCheckRef.current.indeterminate = checkedRows.length > 0 && !allChecked;
  }, [checkedRows.length, allChecked]);

  const toggleChecked = (receiptId: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(receiptId)) next.delete(receiptId);
      else next.add(receiptId);
      return next;
    });
  const selectAll = () => setChecked(new Set(selectable.map((r) => r.receiptId)));
  /** 신고 대상만 — 매칭 제외(개인 결제 등)를 뺀 전표 */
  const selectReportable = () => setChecked(new Set(selectable.filter((r) => !r.excluded).map((r) => r.receiptId)));
  const clearChecked = () => setChecked(new Set());

  const downloadChecked = async () => {
    if (checkedRows.length === 0) return;
    setDownloading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/receipts/shop/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ receiptIds: checkedRows.map((r) => r.receiptId), mode: bulkMode, from, to }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "전표를 내려받지 못했습니다.");
      }
      const blob = await res.blob();
      const fallback = bulkMode === "merged" ? "쇼핑몰전표.pdf" : "쇼핑몰전표.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileNameFromDisposition(res.headers.get("content-disposition"), fallback);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      const files = Number(res.headers.get("x-file-count") ?? 0);
      const skipped = Number(res.headers.get("x-skipped-count") ?? 0);
      const shared = checkedRows.length - files - skipped;
      setNotice(
        (bulkMode === "merged"
          ? `전표 ${checkedRows.length}건을 PDF 한 개로 병합해 내려받았습니다.`
          : `전표 ${checkedRows.length}건을 전표별 PDF ${files}개(ZIP)로 내려받았습니다.`) +
          (shared > 0 ? ` 같은 묶음 파일을 쓰는 ${shared}건은 한 번만 넣었습니다.` : "") +
          (skipped > 0 ? ` 파일이 없는 ${skipped}건은 빠졌습니다.` : "")
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const suspiciousCount = rows.filter(dateSuspicious).length;
  const matchedCount = rows.filter((r) => r.matchStatus).length;
  const excludedCount = rows.filter((r) => r.excluded).length;
  const unmatchedCount = rows.length - matchedCount - excludedCount;

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="cd-card-title mr-auto">올라온 전표 · 카드 원장 매칭</div>

        {/* .cd-select 의 width:100% 가 w-auto 를 이겨 한 줄을 다 차지했다 — 폭은 인라인으로 고정 */}
        <select className="cd-select" style={{ width: 160 }} value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">전체 쇼핑몰</option>
          {Object.entries(SITE_NAMES).map(([key, name]) => (
            <option key={key} value={key}>{name}</option>
          ))}
        </select>

        <button type="button" className="cd-btn cd-btn-sm cd-btn-soft" onClick={() => void runAutoMatch()} disabled={matching || loading}>
          {matching ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} 자동 매칭
        </button>
        <button type="button" className="cd-btn cd-btn-sm" onClick={() => void load()}>
          <RefreshCw size={14} /> 새로고침
        </button>
      </div>

      {periodControls && <div className="mb-3">{periodControls}</div>}

      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      {notice && <div className="text-sm cd-text-primary mb-2">{notice}</div>}

      <div className="flex items-center gap-2 text-xs cd-text-muted mb-3 flex-wrap">
        <span>{from} ~ {to}</span>
        <span className="cd-pill">전표 {rows.length.toLocaleString()}건 · {total.toLocaleString()}원</span>
        <span className="cd-pill cd-pill-success">매칭 {matchedCount}</span>
        {unmatchedCount > 0 && <span className="cd-pill cd-pill-warn">미매칭 {unmatchedCount}</span>}
        {excludedCount > 0 && <span className="cd-pill">제외 {excludedCount}</span>}
        {suspiciousCount > 0 && (
          <span className="cd-pill cd-pill-warn" title="전표 주문일과 원장 승인일이 이틀 넘게 다른 매칭 — 확인 후 필요하면 해제하세요">
            날짜 불일치 {suspiciousCount}
          </span>
        )}
        {uncovered.length > 0 && (
          <button type="button" className="cd-pill cd-pill-warn cursor-pointer" onClick={() => setShowUncovered((v) => !v)}>
            전표 없는 쇼핑몰 결제 {uncovered.length}건 {showUncovered ? "접기" : "보기"}
          </button>
        )}
      </div>

      {/* 원장 기준 커버리지 — 전표가 안 붙은 쇼핑몰 결제(수집 누락 확인) */}
      {showUncovered && uncovered.length > 0 && (
        <div className="border cd-border-c rounded-xl p-3 mb-3">
          <div className="text-xs cd-text-muted mb-3">
            법인카드 원장에서 쇼핑몰/PG 가맹점으로 보이는데 전표가 붙지 않은 결제입니다.
            해당 기간을 다시 수집하거나, 아래 전표의 [연결] 로 직접 이어 주세요.
          </div>
          <table className="w-full text-xs">
            <tbody>
              {uncovered.map((t) => (
                <tr key={t.cardTxnId} className="border-t cd-border-c">
                  <td className="py-1 pr-3 whitespace-nowrap cd-text-muted">{t.approvedDate}</td>
                  <td className="py-1 pr-3">{t.storeName}</td>
                  <td className="py-1 pr-3 whitespace-nowrap cd-text-muted">{t.cardAlias || t.cardCompany} ····{t.cardLast4}</td>
                  <td className="py-1 text-right whitespace-nowrap">{t.amountTotal.toLocaleString()}원</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {loading ? (
        <div className="text-sm cd-text-muted">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm cd-text-muted">
          이 기간에 올라온 전표가 없습니다. 개인 PC 의 전표 수집 앱에서 <b>스테이징으로 올리기</b> 를 실행하세요.
        </div>
      ) : (
        <>
        {/* 일괄 다운로드 — 체크한 전표만 병합 PDF 한 개 또는 전표별 PDF(ZIP)로 */}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <button type="button" className="cd-btn cd-btn-sm" onClick={selectAll} disabled={selectable.length === 0}>
            전체 선택
          </button>
          <button
            type="button"
            className="cd-btn cd-btn-sm"
            onClick={selectReportable}
            disabled={selectable.length === 0}
            title="매칭 제외(개인 결제 등)를 뺀 전표만 고릅니다"
          >
            신고 대상만
          </button>
          <button type="button" className="cd-btn cd-btn-sm cd-btn-ghost" onClick={clearChecked} disabled={checked.size === 0}>
            전체 해제
          </button>
          <span className="cd-text-muted tabular-nums">
            선택 {checkedRows.length}건{checkedRows.length > 0 ? ` · ${checkedTotal.toLocaleString()}원` : ""}
          </span>
          <span className="hidden sm:inline cd-text-faint" aria-hidden>|</span>
          <div className="flex items-center gap-3" role="radiogroup" aria-label="다운로드 형식">
            <label className="inline-flex items-center gap-1.5 cursor-pointer cd-text">
              <input type="radio" name="shop-receipt-bulk-mode" checked={bulkMode === "merged"} onChange={() => setBulkMode("merged")} />
              PDF 하나로 병합
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer cd-text">
              <input type="radio" name="shop-receipt-bulk-mode" checked={bulkMode === "zip"} onChange={() => setBulkMode("zip")} />
              전표별 PDF(ZIP)
            </label>
          </div>
          <button
            type="button"
            className="cd-btn cd-btn-sm cd-btn-primary"
            onClick={() => void downloadChecked()}
            disabled={checkedRows.length === 0 || downloading}
          >
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 선택 다운로드
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="cd-table-head">
              <tr className="cd-text-muted text-xs">
                <th className="w-8 py-1.5 pr-2 text-left font-normal">
                  <input
                    ref={headCheckRef}
                    type="checkbox"
                    aria-label="전체 선택"
                    checked={allChecked}
                    disabled={selectable.length === 0}
                    onChange={() => (allChecked ? clearChecked() : selectAll())}
                  />
                </th>
                <th className="text-left font-normal py-1.5 pr-3">쇼핑몰</th>
                <th className="text-left font-normal py-1.5 pr-3">주문일</th>
                <th className="text-left font-normal py-1.5 pr-3">주문번호</th>
                <th className="text-left font-normal py-1.5 pr-3">품목</th>
                <th className="text-right font-normal py-1.5 pr-3">금액</th>
                <th className="text-left font-normal py-1.5 pr-3">전표</th>
                <th className="text-left font-normal py-1.5">카드 원장 매칭</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.receiptId}>
                  <tr className={`border-t cd-border-c ${row.excluded ? "opacity-50" : ""}`}>
                    <td className="py-1.5 pr-2">
                      <input
                        type="checkbox"
                        aria-label={`${row.orderDate} ${row.orderNo} 선택`}
                        checked={checked.has(row.receiptId)}
                        disabled={!row.storageKey}
                        title={row.storageKey ? undefined : "PDF 파일이 없는 전표입니다"}
                        onChange={() => toggleChecked(row.receiptId)}
                      />
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{SITE_NAMES[row.site] ?? row.site}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap cd-text-muted">{row.orderDate || "-"}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap cd-text-muted">{row.orderNo}</td>
                    <td className="py-1.5 pr-3">{row.title || "-"}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                      {row.amount ? `${row.amount.toLocaleString()}원` : "-"}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
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
                    <td className="py-1.5">
                      {row.matchedTxn ? (
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          <span className="cd-pill cd-pill-success inline-flex items-center gap-1">
                            <CheckCircle2 size={12} />
                            {row.matchedTxn.cardAlias || row.matchedTxn.storeName} ····{row.matchedTxn.cardLast4}
                          </span>
                          <span className="text-xs cd-text-faint">
                            {row.matchedTxn.approvedAt.slice(5, 16)} · {BASIS_LABELS[row.matchBasis ?? ""] ?? row.matchBasis}
                          </span>
                          {dateSuspicious(row) && (
                            <span className="cd-pill cd-pill-warn" title="전표 주문일과 원장 승인일이 이틀 넘게 다릅니다">
                              날짜 불일치
                            </span>
                          )}
                          <button type="button" className="cd-btn cd-btn-sm cd-btn-ghost" title="연결 해제" onClick={() => void setMatch(row.receiptId, null)}>
                            <Unlink size={12} />
                          </button>
                        </span>
                      ) : row.excluded ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="cd-pill inline-flex items-center gap-1">
                            <Ban size={12} /> 매칭 제외
                          </span>
                          <button
                            type="button"
                            className="cd-btn cd-btn-sm cd-btn-ghost"
                            title="제외를 되돌린다 — 이후 [자동 매칭]이나 [연결] 로 다시 잇는다"
                            onClick={() => void setExcluded(row.receiptId, false)}
                          >
                            <RotateCcw size={12} /> 복원
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <button type="button" className="cd-btn cd-btn-sm cd-btn-soft" onClick={() => void openPicker(row.receiptId)}>
                            <Link2 size={13} /> 연결
                          </button>
                          <button
                            type="button"
                            className="cd-btn cd-btn-sm cd-btn-ghost"
                            title="개인카드 결제 등 법인카드 원장에 없는 건을 매칭 대상에서 뺀다"
                            onClick={() => void setExcluded(row.receiptId, true)}
                          >
                            <Ban size={13} /> 제외
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>

                  {/* 수동 연결 후보 — 행 바로 아래에 펼친다 */}
                  {pickerFor === row.receiptId && (
                    <tr className="border-t cd-border-c">
                      <td colSpan={8} className="py-2 pl-6">
                        {pickerLoading ? (
                          <div className="text-xs cd-text-muted">후보를 찾는 중…</div>
                        ) : candidates.length === 0 ? (
                          <div className="text-xs cd-text-muted">
                            비슷한 원장 건을 찾지 못했습니다. 법인카드 원장이 이 기간까지 동기화됐는지 확인해 주세요.
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {candidates.map((t) => (
                              <div key={t.cardTxnId} className="flex items-center gap-2 text-xs">
                                <button type="button" className="cd-btn cd-btn-sm cd-btn-soft" onClick={() => void setMatch(row.receiptId, t.cardTxnId)}>
                                  이걸로 연결
                                </button>
                                <span className="cd-text-muted whitespace-nowrap">{t.approvedAt.slice(0, 16)}</span>
                                <span className="mr-auto">{t.storeName} · {t.cardAlias || t.cardCompany} ····{t.cardLast4}</span>
                                {t.matchedCount > 0 && <span className="cd-pill">이미 전표 {t.matchedCount}장</span>}
                                <span className={`whitespace-nowrap ${t.amountTotal === row.amount ? "cd-text-primary font-semibold" : "cd-text-muted"}`}>
                                  {t.amountTotal.toLocaleString()}원
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
