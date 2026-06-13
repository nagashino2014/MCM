"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Tags } from "lucide-react";
import { CardFrame, CardSkeleton } from "./CardFrame";
import { fmtFull, type DashboardData } from "./types";
import { CollectionEntryModal } from "@/components/contracts/billing/CollectionEntryModal";
import type { ContractReceivableRow } from "@/lib/ieps/receivables-types";

type AgingFilter = null | "1to2" | "over2";
type UncollectedItem = DashboardData["uncollected"][number];

/** 미수금 항목 → 발행/수금 모달용 행 변환 */
function toReceivableRow(item: UncollectedItem): ContractReceivableRow {
  return {
    contractId: item.contractId,
    contractTitle: item.contractTitle,
    counterpartyName: item.counterpartyName,
    category: item.category,
    milestoneId: item.milestoneId,
    stageLabel: item.stageLabel,
    paymentTerms: item.paymentTerms,
    invoiceIssuedAt: item.invoiceIssuedAt,
    invoiceAmount: item.amount,
    outstandingAmount: item.outstandingAmount,
    agingDays: 0,
    agingMonths: item.agingMonths,
    actionCount: 0,
    actionTypes: [],
  };
}

/**
 * 미수금 현황 — 계산서 발행 후 수금 미완료 목록 (선택 분류 + 기준연도 발행분).
 * 에이징: 1개월 이상 2개월 미만 = warning, 2개월 이상 = error 텍스트 컬러.
 * 상단 범례는 토글 버튼 — 누르면 해당 에이징 구간만 필터링해 표시한다.
 * 리스트를 클릭하면 해당 청구·수금 단계의 발행/수금 모달이 열린다.
 */
export function UncollectedCard({
  items,
  loading,
  onChanged,
}: {
  items: DashboardData["uncollected"] | null;
  loading: boolean;
  /** 수금 입력 저장 후 대쉬보드 데이터 갱신 */
  onChanged: () => void;
}) {
  const [aging, setAging] = useState<AgingFilter>(null);
  const [modalRow, setModalRow] = useState<ContractReceivableRow | null>(null);

  const filtered = useMemo(() => {
    if (!items) return [];
    if (aging === "1to2") return items.filter((i) => i.agingMonths >= 1 && i.agingMonths < 2);
    if (aging === "over2") return items.filter((i) => i.agingMonths >= 2);
    return items;
  }, [items, aging]);

  const toggle = (target: Exclude<AgingFilter, null>) =>
    setAging((prev) => (prev === target ? null : target));

  return (
    <>
    <CardFrame
      area="cd-a-uncol"
      icon={<Tags className="w-4 h-4" />}
      title="미수금 현황"
      delay={1}
      titleSuffix={
        <Link
          href="/contracts/billing"
          className="cd-chip ml-1.5 inline-flex items-center"
          style={{ fontSize: "0.6875rem", padding: "0.3rem 0.6rem" }}
        >
          상세 보기
        </Link>
      }
      extra={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cd-legend px-2 py-1 rounded-lg border transition-colors"
            style={{
              borderColor: aging === null ? "var(--cd-primary)" : "transparent",
              background: aging === null ? "var(--cd-primary-soft)" : "transparent",
            }}
            onClick={() => setAging(null)}
          >
            <span className="swatch" style={{ background: "var(--cd-primary)" }} />
            전체
          </button>
          <button
            type="button"
            className="cd-legend px-2 py-1 rounded-lg border transition-colors"
            style={{
              borderColor: aging === "1to2" ? "var(--cd-warning)" : "transparent",
              background: aging === "1to2" ? "var(--cd-warning-soft)" : "transparent",
            }}
            onClick={() => toggle("1to2")}
          >
            <span className="swatch" style={{ background: "var(--cd-warning)" }} />
            1개월 이상 2개월 미만
          </button>
          <button
            type="button"
            className="cd-legend px-2 py-1 rounded-lg border transition-colors"
            style={{
              borderColor: aging === "over2" ? "var(--cd-error)" : "transparent",
              background: aging === "over2" ? "var(--cd-error-soft)" : "transparent",
            }}
            onClick={() => toggle("over2")}
          >
            <span className="swatch" style={{ background: "var(--cd-error)" }} />
            2개월 이상
          </button>
        </div>
      }
    >
      {loading || !items ? (
        <CardSkeleton lines={7} />
      ) : (
        <div className="flex flex-col text-[11px] flex-1 min-h-0">
          <div
            className="grid grid-cols-[70px_1fr_56px_84px] gap-x-2 px-2 py-2 rounded-lg font-bold shrink-0"
            style={{ background: "var(--cd-surface)", color: "var(--cd-muted)" }}
          >
            <span>발행일</span>
            <span>용역명</span>
            <span>구분</span>
            <span className="text-right">발행액</span>
          </div>
          <div className="mt-1 flex-1 overflow-y-auto scrollbar-hide">
            {filtered.map((item) => {
              const color =
                item.agingMonths >= 2
                  ? "var(--cd-error)"
                  : item.agingMonths >= 1
                    ? "var(--cd-warning)"
                    : "var(--cd-text)";
              return (
                <div
                  key={item.milestoneId || item.contractId + item.stageLabel + (item.invoiceIssuedAt ?? "")}
                  role="button"
                  className="cd-row-hover grid grid-cols-[70px_1fr_56px_84px] gap-x-2 items-center px-2 py-1.5 rounded-lg cursor-pointer"
                  title={`${item.counterpartyName} · ${item.contractTitle} — 클릭하면 수금 정보를 입력합니다`}
                  onClick={() => setModalRow(toReceivableRow(item))}
                >
                  <span className="tabular-nums" style={{ color: "var(--cd-faint)" }}>
                    {item.invoiceIssuedAt ?? "-"}
                  </span>
                  <span className="truncate font-bold" style={{ color }}>
                    {item.contractTitle}
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
                {aging ? "해당 구간의 미수금이 없습니다." : "미수금 내역이 없습니다."}
              </p>
            )}
          </div>
        </div>
      )}
    </CardFrame>
    {/* 발행/수금 모달 — CardFrame 의 transform 영향을 피해 형제로 렌더링 */}
    {modalRow && (
      <CollectionEntryModal
        row={modalRow}
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
