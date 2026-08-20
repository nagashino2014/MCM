"use client";

// 법인카드 내역 불러오기 모달 (블루프린트 P1 F1/F2)
// 지출결의서·출장보고서 기안 화면에서 미사용 매입건을 다중 선택해 지출 내역 표로 넘긴다.
// - 목록 = 결의서 미귀속(doc_id null)·미제외·승인 건. 이미 이 문서 표에 담긴 건은 선택 불가 표시.
// - 분류는 3단 자동(학습→상호 키워드→업태 규칙) 결과를 배지로 보여주고, 실패 건은 표에서 직접 선택.
// - 실측 안내: 매입내역은 카드 사용 후 확정까지 2~5일 지연될 수 있다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";

export interface CardPickerItem {
  cardTxnId: string;
  cardLabel: string;
  approvedAt: string;
  useDate: string;
  amountTotal: number;
  storeName: string | null;
  storeBizType: string | null;
  isPurchased: boolean;
  categoryKey: string | null;
  categoryLabel: string | null;
  categorySource: string | null;
  /** 사전 생성된 전자 전표 PDF key(null = 아직 미생성 — 담을 때 서버가 만든다) */
  slipKey: string | null;
  slipName: string;
  formOption: string | null;
}

const ymdInput = (d: Date) => d.toISOString().slice(0, 10);

export function CardPickerModal({
  open,
  onClose,
  formId,
  existingIds,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  formId: string;
  /** 이미 이 문서의 지출 내역 표에 담긴 카드 건(_cardTxnId) */
  existingIds: string[];
  onPick: (items: CardPickerItem[]) => void;
}) {
  const [from, setFrom] = useState(() => ymdInput(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(() => ymdInput(new Date()));
  const [items, setItems] = useState<CardPickerItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ formId, from, to });
      const res = await fetch(`/api/finance/card-picker?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "카드 내역을 불러오지 못했습니다.");
      setItems(data.items ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [formId, from, to]);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
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

  // 채널 가드(§13.3, 경고만): 지출결의서에 출장성 분류(교통·숙박) 건을 담으면 안내.
  const tripLikeSelected =
    formId === "frm-expense-report" &&
    items.some((i) => selected.has(i.cardTxnId) && (i.categoryKey === "travel" || i.categoryKey === "lodging" || i.categoryKey === "fuel"));

  const submit = () => {
    const picked = items.filter((i) => selected.has(i.cardTxnId));
    if (!picked.length) return;
    onPick(picked);
    onClose();
  };

  return (
    <CdModal
      open={open}
      onClose={onClose}
      title="법인카드 내역 불러오기"
      size="xl"
      footer={
        <>
          <span className="text-xs cd-text-muted mr-auto">{selected.size}건 선택</span>
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
          <input type="date" className="cd-input" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="cd-text-muted">~</span>
          <input type="date" className="cd-input" value={to} onChange={(e) => setTo(e.target.value)} />
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={load} disabled={loading}>
            <RefreshCw className="w-3.5 h-3.5" /> 조회
          </button>
          <span className="text-[11px] cd-text-faint ml-auto">
            매입내역은 카드 사용 후 확정까지 2~5일 걸릴 수 있습니다
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
                <th className="py-2 pr-3 font-normal">사용일</th>
                <th className="py-2 pr-3 font-normal">카드</th>
                <th className="py-2 pr-3 font-normal">상호</th>
                <th className="py-2 pr-3 font-normal text-right">금액</th>
                <th className="py-2 pr-3 font-normal">자동 분류</th>
                <th className="py-2 font-normal">매입</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const used = existing.has(item.cardTxnId);
                return (
                  <tr
                    key={item.cardTxnId}
                    className={`border-t cd-hairline-row-c ${used ? "opacity-45" : "cursor-pointer cd-row-hover"}`}
                    onClick={() => !used && toggle(item.cardTxnId)}
                  >
                    <td className="py-1.5 px-3">
                      <input type="checkbox" checked={selected.has(item.cardTxnId)} disabled={used} readOnly />
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{item.useDate}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{item.cardLabel}</td>
                    <td className="py-1.5 pr-3 max-w-[220px] truncate" title={item.storeName ?? ""}>
                      {item.storeName ?? "-"}
                      {used && <span className="ml-1.5 text-[10px] cd-text-faint">(이미 담김)</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium whitespace-nowrap">{item.amountTotal.toLocaleString("ko-KR")}</td>
                    <td className="py-1.5 pr-3">
                      {item.categoryLabel ? (
                        <span className="cd-pill cd-pill-info" title={`업태: ${item.storeBizType ?? "-"} · 근거: ${item.categorySource}`}>
                          {item.formOption ?? item.categoryLabel}
                        </span>
                      ) : (
                        <span className="cd-pill cd-pill-idle">미분류</span>
                      )}
                    </td>
                    <td className="py-1.5">
                      <span className={`cd-pill ${item.isPurchased ? "cd-pill-success" : "cd-pill-idle"}`}>{item.isPurchased ? "완료" : "대기"}</span>
                    </td>
                  </tr>
                );
              })}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center cd-text-muted text-sm">
                    선택 가능한 매입 내역이 없습니다. 기간을 넓히거나 재무 &gt; 연결 관리에서 수집 상태를 확인하세요.
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
