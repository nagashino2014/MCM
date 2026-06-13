"use client";

import { useMemo, useState } from "react";
import { ShoppingBasket } from "lucide-react";
import { CardFrame, CardSkeleton } from "./CardFrame";
import { fmtFull, type DashboardData } from "./types";
import { CollectionEntryModal } from "@/components/contracts/billing/CollectionEntryModal";
import type { ContractReceivableRow } from "@/lib/ieps/receivables-types";

type RecencyFilter = null | "2weeks" | "1month";
type RecentCollectionItem = DashboardData["recentCollections"][number];

/** 수금내역 항목 → 발행/수금 모달용 행 변환 */
function toReceivableRow(item: RecentCollectionItem): ContractReceivableRow {
  return {
    contractId: item.contractId,
    contractTitle: item.contractTitle,
    counterpartyName: item.counterpartyName,
    category: item.category,
    milestoneId: item.milestoneId,
    stageLabel: item.stageLabel,
    paymentTerms: item.paymentTerms,
    invoiceIssuedAt: item.invoiceIssuedAt,
    invoiceAmount: item.invoiceAmount,
    outstandingAmount: Math.max(0, item.invoiceAmount - item.amount),
    agingDays: 0,
    agingMonths: 0,
    actionCount: 0,
    actionTypes: [],
  };
}

/**
 * 수금내역 (최근 2개월 수금 완료 기준).
 * DB에 수금 예정일 필드가 없어 엑셀 원본(예정 내역) 대신 완료 내역을 표시한다.
 * 구간: 2주 이내 수금(0~14일) = primary, 1개월 이내 수금(0~30일) = success.
 * 상단 범례는 토글 버튼 — 누르면 해당 구간만 필터링해 표시한다.
 * 리스트를 클릭하면 해당 청구·수금 단계의 발행/수금 모달이 열린다.
 */
export function RecentCollectionsCard({
  items,
  loading,
  onChanged,
}: {
  items: DashboardData["recentCollections"] | null;
  loading: boolean;
  /** 수금 정보 수정 저장 후 대쉬보드 데이터 갱신 */
  onChanged: () => void;
}) {
  const [recency, setRecency] = useState<RecencyFilter>(null);
  const [modalRow, setModalRow] = useState<RecentCollectionItem | null>(null);

  const filtered = useMemo(() => {
    if (!items) return [];
    if (recency === "2weeks") return items.filter((i) => i.daysAgo <= 14);
    if (recency === "1month") return items.filter((i) => i.daysAgo <= 30);
    return items;
  }, [items, recency]);

  const toggle = (target: Exclude<RecencyFilter, null>) =>
    setRecency((prev) => (prev === target ? null : target));

  return (
    <>
    <CardFrame
      area="cd-a-recent"
      icon={<ShoppingBasket className="w-4 h-4" />}
      title="수금내역"
      titleSuffix={
        <span className="text-[11px] font-bold" style={{ color: "var(--cd-faint)" }}>
          (2개월 내)
        </span>
      }
      delay={3}
      extra={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cd-legend px-2 py-1 rounded-lg border transition-colors"
            style={{
              borderColor: recency === null ? "var(--cd-accent)" : "transparent",
              background: recency === null ? "var(--cd-accent-soft)" : "transparent",
            }}
            onClick={() => setRecency(null)}
          >
            <span className="swatch" style={{ background: "var(--cd-accent)" }} />
            전체
          </button>
          <button
            type="button"
            className="cd-legend px-2 py-1 rounded-lg border transition-colors"
            style={{
              borderColor: recency === "2weeks" ? "var(--cd-primary)" : "transparent",
              background: recency === "2weeks" ? "var(--cd-primary-soft)" : "transparent",
            }}
            onClick={() => toggle("2weeks")}
          >
            <span className="swatch" style={{ background: "var(--cd-primary)" }} />
            2주 이내 수금
          </button>
          <button
            type="button"
            className="cd-legend px-2 py-1 rounded-lg border transition-colors"
            style={{
              borderColor: recency === "1month" ? "var(--cd-success)" : "transparent",
              background: recency === "1month" ? "var(--cd-success-soft)" : "transparent",
            }}
            onClick={() => toggle("1month")}
          >
            <span className="swatch" style={{ background: "var(--cd-success)" }} />
            1개월 이내 수금
          </button>
        </div>
      }
    >
      {loading || !items ? (
        <CardSkeleton lines={7} />
      ) : (
        <div className="flex flex-col text-[11px] flex-1 min-h-0">
          <div
            className="grid grid-cols-[70px_1fr_64px_52px_80px] gap-x-2 px-2 py-2 rounded-lg font-bold shrink-0"
            style={{ background: "var(--cd-surface)", color: "var(--cd-muted)" }}
          >
            <span>수금일</span>
            <span>계약명</span>
            <span>용역분류</span>
            <span>구분</span>
            <span className="text-right">금액</span>
          </div>
          <div className="mt-1 flex-1 overflow-y-auto scrollbar-hide">
            {filtered.map((item, idx) => {
              const color =
                item.daysAgo <= 14
                  ? "var(--cd-primary)"
                  : item.daysAgo <= 30
                    ? "var(--cd-success)"
                    : "var(--cd-text)";
              return (
                <div
                  key={item.milestoneId || item.contractId + item.stageLabel + idx}
                  role="button"
                  className="cd-row-hover grid grid-cols-[70px_1fr_64px_52px_80px] gap-x-2 items-center px-2 py-1.5 rounded-lg cursor-pointer"
                  title={`${item.contractTitle} — 클릭하면 수금 정보를 확인/수정합니다`}
                  onClick={() => setModalRow(item)}
                >
                  <span className="tabular-nums" style={{ color: "var(--cd-faint)" }}>
                    {item.collectedAt || "-"}
                  </span>
                  <span className="truncate font-bold" style={{ color }}>
                    {item.contractTitle}
                  </span>
                  <span className="truncate" style={{ color: "var(--cd-muted)" }}>
                    {item.category}
                  </span>
                  <span style={{ color: "var(--cd-muted)" }}>{item.stageLabel}</span>
                  <span className="text-right tabular-nums font-extrabold" style={{ color }}>
                    {fmtFull(item.amount)}
                  </span>
                </div>
              );
            })}
            {filtered.length === 0 && (
              <p className="px-2 py-8 text-center" style={{ color: "var(--cd-faint)" }}>
                {recency ? "해당 구간의 수금 내역이 없습니다." : "최근 2개월 내 수금 내역이 없습니다."}
              </p>
            )}
          </div>
        </div>
      )}
    </CardFrame>
    {/* 발행/수금 모달 — 기존 수금 정보를 초기값으로 채워 수정 가능 */}
    {modalRow && (
      <CollectionEntryModal
        row={toReceivableRow(modalRow)}
        initial={{ collectedAt: modalRow.collectedAt, collectedAmount: modalRow.amount }}
        onClose={() => setModalRow(null)}
        onSaved={() => {
          setModalRow(null);
          onChanged();
        }}
      />
    )}
    </>
  );
}
