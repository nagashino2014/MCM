"use client";

// 개인카드 영수증 불러오기 모달 (accounting-expansion 블루프린트 §2, P1)
// 지출결의서·출장보고서 기안 화면에서 본인이 촬영해 둔 미사용 영수증을 다중 선택해 지출 내역 표로 넘긴다.
// CardPickerModal(법인카드)의 형제 — 목록이 "본인 영수증"이라는 점과, 선택 시 증빙 PDF 가
// 첨부서류에 자동 추가된다는 점만 다르다. 썸네일 클릭으로 원본 이미지를 확인할 수 있다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";

export interface ReceiptPickerItem {
  receiptId: string;
  paidAt: string | null;
  paidDate: string | null;
  storeName: string | null;
  totalAmount: number;
  cardLast4: string | null;
  items: string[];
  memo: string | null;
  docId: string | null;
  /** 촬영일 — 사용일이 없는 건의 날짜 표시에 쓴다. */
  createdAt: string;
  pdfKey: string;
  pdfName: string;
  categoryKey: string | null;
  categoryLabel: string | null;
  categorySource: string | null;
  formOption: string | null;
}

/** 입력용 YYYY-MM-DD (KST 기준) — toISOString 은 UTC 라, 오전 9시 이전에는 "오늘"이 하루 밀려
 *  그날 찍은 영수증이 조회 범위에서 빠졌다. 저장 값(KST)과 기준을 맞춘다. */
const ymdInput = (ms: number) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

export function ReceiptPickerModal({
  open,
  onClose,
  formId,
  existingIds,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  formId: string;
  /** 이미 이 문서의 지출 내역 표에 담긴 영수증(_receiptId) */
  existingIds: string[];
  onPick: (items: ReceiptPickerItem[]) => void;
}) {
  const [from, setFrom] = useState(() => ymdInput(Date.now() - 90 * 86400000));
  const [to, setTo] = useState(() => ymdInput(Date.now()));
  /** 기간 무시하고 전부 — 사용일이 잘못 인식된 건을 찾을 때 쓴다. */
  const [allTime, setAllTime] = useState(false);
  const [items, setItems] = useState<ReceiptPickerItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null); // receiptId — 원본 이미지 확대

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ formId, unusedOnly: "1" });
      if (!allTime) {
        params.set("from", from);
        params.set("to", to);
      }
      const res = await fetch(`/api/receipts?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "영수증을 불러오지 못했습니다.");
      setItems(data.items ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [formId, from, to, allTime]);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setPreview(null);
      load();
    }
  }, [open, load]);

  const existing = useMemo(() => new Set(existingIds), [existingIds]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 채널 가드(법인카드 모달과 동일, 경고만): 지출결의서에 출장성 분류 건을 담으면 안내.
  const tripLikeSelected =
    formId === "frm-expense-report" &&
    items.some((i) => selected.has(i.receiptId) && (i.categoryKey === "travel" || i.categoryKey === "lodging" || i.categoryKey === "fuel"));

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
      title="개인카드 영수증 불러오기"
      size="xl"
      footer={
        <>
          <span className="text-xs cd-text-muted mr-auto">{selected.size}건 선택 — 영수증 PDF가 첨부서류에 함께 추가됩니다</span>
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
          <label className="cd-label text-xs">기간</label>
          <input
            type="date"
            className="cd-input"
            value={from}
            disabled={allTime}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span className="cd-text-muted">~</span>
          <input type="date" className="cd-input" value={to} disabled={allTime} onChange={(e) => setTo(e.target.value)} />
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input type="checkbox" checked={allTime} onChange={(e) => setAllTime(e.target.checked)} />
            전체 기간
          </label>
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={load} disabled={loading}>
            <RefreshCw className="w-3.5 h-3.5" /> 조회
          </button>
          <span className="text-[11px] cd-text-faint ml-auto">
            모바일 앱 "영수증 촬영"으로 찍어둔 본인 영수증만 표시됩니다 — 안 보이면 [전체 기간]으로 조회하세요
          </span>
        </div>

        {error && <div className="cd-error-text text-sm">{error}</div>}
        {tripLikeSelected && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--cd-warning,#FFAE1F)" }}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            출장성 지출(교통·숙박·유류)이 선택돼 있습니다 — 출장 경비는 출장보고서의 경비 내역 사용을 권장합니다.
          </div>
        )}

        <div className="overflow-x-auto max-h-[50vh] overflow-y-auto border cd-border-c rounded-xl">
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: "var(--cd-card-solid)" }}>
              <tr className="cd-text-muted text-left">
                <th className="py-2 px-3 font-normal w-8"></th>
                <th className="py-2 pr-3 font-normal">영수증</th>
                <th className="py-2 pr-3 font-normal">사용일</th>
                <th className="py-2 pr-3 font-normal">상호</th>
                <th className="py-2 pr-3 font-normal text-right">금액</th>
                <th className="py-2 pr-3 font-normal">카드</th>
                <th className="py-2 font-normal">자동 분류</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const used = existing.has(item.receiptId);
                return (
                  <tr
                    key={item.receiptId}
                    className={`border-t cd-hairline-row-c ${used ? "opacity-45" : "cursor-pointer cd-row-hover"}`}
                    onClick={() => !used && toggle(item.receiptId)}
                  >
                    <td className="py-1.5 px-3">
                      <input type="checkbox" checked={selected.has(item.receiptId)} disabled={used} readOnly />
                    </td>
                    <td className="py-1.5 pr-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/receipts/${item.receiptId}/image`}
                        alt=""
                        className="w-9 h-9 object-cover rounded border cd-border-c"
                        loading="lazy"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreview(preview === item.receiptId ? null : item.receiptId);
                        }}
                      />
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-xs">
                      {item.paidDate ?? (
                        <span className="cd-text-faint" title="사용일이 인식되지 않은 건 — 촬영일 기준으로 표시합니다">
                          미상 ({item.createdAt?.slice(0, 10) ?? "-"})
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 max-w-[220px] truncate" title={item.storeName ?? ""}>
                      {item.storeName ?? "-"}
                      {used && <span className="ml-1.5 text-[10px] cd-text-faint">(이미 담김)</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium whitespace-nowrap">{item.totalAmount.toLocaleString("ko-KR")}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{item.cardLast4 ? `****${item.cardLast4}` : "-"}</td>
                    <td className="py-1.5">
                      {item.categoryLabel ? (
                        <span className="cd-pill cd-pill-info" title={`근거: ${item.categorySource}`}>
                          {item.formOption ?? item.categoryLabel}
                        </span>
                      ) : (
                        <span className="cd-pill cd-pill-idle">미분류</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center cd-text-muted text-sm">
                    선택 가능한 영수증이 없습니다. 모바일 앱 홈의 "영수증 촬영"으로 지류 영수증을 찍어 두면 여기에 표시됩니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/receipts/${preview}/image`}
            alt="영수증 원본"
            className="max-h-[40vh] mx-auto rounded-xl border cd-border-c cursor-zoom-out"
            onClick={() => setPreview(null)}
          />
        )}
      </div>
    </CdModal>
  );
}
