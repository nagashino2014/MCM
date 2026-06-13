"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, CalendarClock, FileWarning, Hourglass, ListChecks, Wallet } from "lucide-react";
import type { ContractReceivableRow } from "@/lib/ieps/receivables-types";
import { filterReceivableRows, type ReceivableAgingFilter } from "@/lib/ieps/receivables-filter";
import { CATEGORY_META, DASHBOARD_CATEGORIES, fmtFull, type CdTheme } from "@/components/contracts/dashboard/types";
import { filenameFromDisposition } from "@/lib/client-download";
import { CollectionEntryModal } from "./CollectionEntryModal";
import { ReceivableActionsCard } from "./ReceivableActionsCard";

const AGING_UNDER2_COLOR = "#FFD966";
const AGING_OVER2_COLOR = "#FF7575";
const LONG_TERM_MONTHS = 3;

/** 장기 미수금 리스트에 표시하는 대응 조치 유형 태그 레이블 */
const ACTION_TAG_LABELS: Record<string, string> = {
  verbal_dunning: "구두독촉",
  content_proof: "내용증명",
  debt_collection: "채권추심",
  rehabilitation: "회생절차",
  debt_waiver: "채권포기",
};

const AGING_FILTERS: Array<{ id: ReceivableAgingFilter; label: string; color: string }> = [
  { id: "all", label: "전체", color: "var(--cd-primary)" },
  { id: "under2", label: "2개월 미만", color: AGING_UNDER2_COLOR },
  { id: "over2", label: "2개월 이상", color: AGING_OVER2_COLOR },
];

interface ReceivablesPayload {
  rows: ContractReceivableRow[];
}

/**
 * 미수금 현황 — 용역 필터 + KPI 카드 + 미수금 리스트(수금 입력) +
 * 3개월 이상 장기 미수금 리스트 + 대응 조치 관리.
 */
export function ReceivablesSection({ theme }: { theme: CdTheme }) {
  void theme;
  const [data, setData] = useState<ReceivablesPayload | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [aging, setAging] = useState<ReceivableAgingFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const [modalRow, setModalRow] = useState<ContractReceivableRow | null>(null);
  const [selectedLongTermId, setSelectedLongTermId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/contracts/billing/receivables", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string })?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as ReceivablesPayload;
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const allRows = useMemo(() => data?.rows ?? [], [data]);
  // 용역 필터만 적용된 행 (KPI/장기 미수금 용)
  const categoryRows = useMemo(
    () => filterReceivableRows(allRows, { category }),
    [allRows, category]
  );
  // 리스트용: 경과 필터까지 적용
  const listRows = useMemo(
    () => filterReceivableRows(categoryRows, { aging }),
    [categoryRows, aging]
  );
  const longTermRows = useMemo(
    () => categoryRows.filter((r) => r.agingMonths >= LONG_TERM_MONTHS),
    [categoryRows]
  );
  const selectedLongTerm = useMemo(
    () => longTermRows.find((r) => r.milestoneId === selectedLongTermId) ?? null,
    [longTermRows, selectedLongTermId]
  );

  // ---------------- KPI ----------------
  const kpi = useMemo(() => {
    const sum = (rows: ContractReceivableRow[]) => rows.reduce((acc, r) => acc + r.outstandingAmount, 0);
    const totalAll = sum(allRows);
    const totalCategory = sum(categoryRows);
    const avgDays =
      categoryRows.length > 0
        ? Math.round(categoryRows.reduce((acc, r) => acc + r.agingDays, 0) / categoryRows.length)
        : 0;
    const under1 = categoryRows.filter((r) => r.agingMonths < 1);
    const under2 = categoryRows.filter((r) => r.agingMonths >= 1 && r.agingMonths < 2);
    const over2 = categoryRows.filter((r) => r.agingMonths >= 2);
    return {
      totalAll,
      totalCategory,
      avgDays,
      under1: { amount: sum(under1), count: under1.length },
      under2: { amount: sum(under2), count: under2.length },
      over2: { amount: sum(over2), count: over2.length },
    };
  }, [allRows, categoryRows]);

  const listTotal = useMemo(
    () => listRows.reduce((acc, r) => acc + r.outstandingAmount, 0),
    [listRows]
  );

  const handleExport = async (format: "xlsx" | "pdf") => {
    if (exporting) return;
    setExporting(format);
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (aging !== "all") params.set("aging", aging);
      params.set("format", format);
      const res = await fetch("/api/contracts/billing/receivables/export?" + params.toString());
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.download = filenameFromDisposition(res, `미수금리스트_${stamp}.${format}`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.alert("내보내기에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setExporting(null);
    }
  };

  const agingTag = (row: ContractReceivableRow) => {
    const over2 = row.agingMonths >= 2;
    return (
      <span
        className="cdb-aging-tag"
        style={{ background: over2 ? AGING_OVER2_COLOR : AGING_UNDER2_COLOR }}
      >
        {over2 ? "2개월 이상" : "2개월 미만"}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 필터 바: 용역 선택 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-extrabold mr-1" style={{ color: "var(--cd-faint)" }}>
          용역 선택
        </span>
        <button
          type="button"
          className="cd-chip cd-chip-sm"
          data-active={category === null}
          onClick={() => setCategory(null)}
        >
          전체 용역
        </button>
        {DASHBOARD_CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className="cd-chip cd-chip-sm inline-flex items-center gap-1.5"
            data-active={category === cat}
            onClick={() => setCategory(cat)}
          >
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ background: CATEGORY_META[cat]?.color ?? "var(--cd-faint)" }}
            />
            {cat}
          </button>
        ))}
      </div>

      {error && (
        <p
          className="text-[11px] font-bold px-3 py-2 rounded-lg"
          style={{ background: "var(--cd-error-soft, rgba(250,137,107,0.14))", color: "var(--cd-error, #fa896b)" }}
        >
          불러오기 실패: {error}
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4 items-start">
        {/* ---------------- 좌측: KPI + 장기 미수금 + 대응 조치 ---------------- */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* KPI 1행 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="cdb-kpi">
              <span className="cdb-kpi-label">
                <Wallet className="w-3.5 h-3.5" style={{ color: "var(--cd-primary)" }} />
                미수금 총액
              </span>
              <span className="cdb-kpi-value tabular-nums">{fmtFull(kpi.totalAll)}원</span>
              <span className="cdb-kpi-sub tabular-nums">{allRows.length.toLocaleString()}건</span>
            </div>
            <div className="cdb-kpi">
              <span className="cdb-kpi-label">
                <ListChecks className="w-3.5 h-3.5" style={{ color: "var(--cd-primary)" }} />
                선택 용역 미수금 총액
              </span>
              <span className="cdb-kpi-value tabular-nums">{fmtFull(kpi.totalCategory)}원</span>
              <span className="cdb-kpi-sub">{category ?? "전체 용역"}</span>
            </div>
            <div className="cdb-kpi">
              <span className="cdb-kpi-label">
                <CalendarClock className="w-3.5 h-3.5" style={{ color: "var(--cd-primary)" }} />
                평균 경과일수
              </span>
              <span className="cdb-kpi-value tabular-nums">
                {categoryRows.length > 0 ? `${kpi.avgDays.toLocaleString()}일` : "-"}
              </span>
              <span className="cdb-kpi-sub">발행일 기준</span>
            </div>
          </div>

          {/* KPI 2행 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="cdb-kpi">
              <span className="cdb-kpi-label">
                <Hourglass className="w-3.5 h-3.5" style={{ color: "#7EBA56" }} />
                1개월 미만
              </span>
              <span className="cdb-kpi-value tabular-nums">{fmtFull(kpi.under1.amount)}원</span>
              <span className="cdb-kpi-sub tabular-nums">{kpi.under1.count.toLocaleString()}건</span>
            </div>
            <div className="cdb-kpi">
              <span className="cdb-kpi-label">
                <Hourglass className="w-3.5 h-3.5" style={{ color: AGING_UNDER2_COLOR }} />
                2개월 미만
              </span>
              <span className="cdb-kpi-value tabular-nums">{fmtFull(kpi.under2.amount)}원</span>
              <span className="cdb-kpi-sub tabular-nums">{kpi.under2.count.toLocaleString()}건 · 1개월 이상</span>
            </div>
            <div className="cdb-kpi">
              <span className="cdb-kpi-label">
                <AlarmClock className="w-3.5 h-3.5" style={{ color: AGING_OVER2_COLOR }} />
                2개월 이상
              </span>
              <span className="cdb-kpi-value tabular-nums">{fmtFull(kpi.over2.amount)}원</span>
              <span className="cdb-kpi-sub tabular-nums">{kpi.over2.count.toLocaleString()}건</span>
            </div>
          </div>

          {/* 3개월 이상 장기 미수금 리스트 */}
          <div className="cdb-box p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="cd-card-title">
                <span className="cd-title-icon">
                  <FileWarning className="w-4 h-4" />
                </span>
                3개월 이상 장기 미수금 리스트
              </p>
              <span className="text-[11px] font-extrabold tabular-nums" style={{ color: AGING_OVER2_COLOR }}>
                {longTermRows.length.toLocaleString()}건
              </span>
            </div>

            <div
              className="cdb-longterm-row !cursor-default text-[10px] font-extrabold"
              style={{ color: "var(--cd-faint)", background: "transparent" }}
            >
              <span>용역명</span>
              <span>조건</span>
              <span className="text-center">발행일</span>
              <span className="text-right">미수금액</span>
            </div>

            <div className="max-h-[250px] overflow-y-auto scrollbar-hide">
              {loading && !data ? (
                <p className="py-6 text-center text-xs animate-pulse" style={{ color: "var(--cd-faint)" }}>
                  미수금 데이터를 불러오는 중…
                </p>
              ) : longTermRows.length === 0 ? (
                <p className="py-6 text-center text-xs" style={{ color: "var(--cd-faint)" }}>
                  3개월 이상 경과한 장기 미수금이 없습니다.
                </p>
              ) : (
                longTermRows.map((row) => (
                  <div
                    key={row.milestoneId}
                    className="cdb-longterm-row text-xs"
                    data-selected={selectedLongTermId === row.milestoneId}
                    title="클릭하면 아래 대응 조치 카드에서 이력을 관리합니다"
                    onClick={() =>
                      setSelectedLongTermId((prev) => (prev === row.milestoneId ? null : row.milestoneId))
                    }
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-bold" style={{ color: "var(--cd-text)" }}>
                        {row.contractTitle}
                      </span>
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate text-[10px]" style={{ color: "var(--cd-faint)" }}>
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
                            style={{ background: CATEGORY_META[row.category]?.color ?? "var(--cd-faint)" }}
                          />
                          {row.counterpartyName || "-"}
                        </span>
                        <span className="cdb-aging-tag cdb-tag-xs shrink-0" style={{ background: AGING_OVER2_COLOR }}>
                          {row.agingMonths}개월
                        </span>
                        {row.actionTypes.length > 0 ? (
                          row.actionTypes.map((type) => (
                            <span key={type} className="cdb-action-tag shrink-0">
                              {ACTION_TAG_LABELS[type] ?? type}
                            </span>
                          ))
                        ) : (
                          <span className="cdb-action-tag shrink-0">미대응</span>
                        )}
                      </span>
                    </span>
                    <span className="truncate text-[10px]" style={{ color: "var(--cd-muted)" }} title={row.stageLabel || undefined}>
                      {row.stageLabel || "-"}
                    </span>
                    <span className="text-center tabular-nums text-[10px]" style={{ color: "var(--cd-muted)" }}>
                      {row.invoiceIssuedAt ?? "-"}
                    </span>
                    <span className="text-right tabular-nums font-bold" style={{ color: "var(--cd-text)" }}>
                      {fmtFull(row.outstandingAmount)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 장기 미수금 대응 조치 */}
          <ReceivableActionsCard selected={selectedLongTerm} onActionsChanged={() => void reload()} />
        </div>

        {/* ---------------- 우측: 미수금 리스트 ---------------- */}
        <div className="cdb-box p-4 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <p className="cd-card-title">
              <span className="cd-title-icon">
                <Hourglass className="w-4 h-4" />
              </span>
              미수금 리스트
            </p>
            <div className="flex items-center gap-1 ml-auto">
              <button
                type="button"
                onClick={() => handleExport("xlsx")}
                disabled={exporting !== null || listRows.length === 0}
                title="현재 리스트를 엑셀로 다운로드"
                className="flex items-center justify-center disabled:opacity-40"
                style={{ width: 30, height: 30 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/excelico.png" alt="엑셀 다운로드" className="w-full h-full object-contain" />
              </button>
              <button
                type="button"
                onClick={() => handleExport("pdf")}
                disabled={exporting !== null || listRows.length === 0}
                title="현재 리스트를 PDF로 다운로드"
                className="flex items-center justify-center disabled:opacity-40"
                style={{ width: 30, height: 30 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/pdfico.png" alt="PDF 다운로드" className="w-full h-full object-contain" />
              </button>
            </div>
          </div>

          {/* 경과 필터 태그 + 요약 */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {AGING_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="cd-chip cd-chip-sm inline-flex items-center gap-1.5"
                data-active={aging === f.id}
                onClick={() => setAging(f.id)}
              >
                <span className="w-2.5 h-2.5 rounded-[4px] inline-block" style={{ background: f.color }} />
                {f.label}
              </button>
            ))}
            <span className="ml-auto text-[11px] font-bold" style={{ color: "var(--cd-muted)" }}>
              총 미수금 건수{" "}
              <span className="tabular-nums font-extrabold" style={{ color: "var(--cd-text)" }}>
                {listRows.length.toLocaleString()}건
              </span>
            </span>
            <span className="text-[11px] font-bold" style={{ color: "var(--cd-muted)" }}>
              총 미수금 금액{" "}
              <span className="tabular-nums font-extrabold" style={{ color: "var(--cd-text)" }}>
                {listTotal > 0 ? `${fmtFull(listTotal)}원` : "-"}
              </span>
            </span>
          </div>

          {/* 열 레이블 */}
          <div
            className="cdb-recv-row !cursor-default text-[11px] font-extrabold"
            style={{ color: "var(--cd-faint)", background: "transparent" }}
          >
            <span>용역명</span>
            <span>조건</span>
            <span className="text-center">발행일</span>
            <span className="text-right">발행금액</span>
          </div>

          {/* 한 번에 16건이 보이도록 (행 높이 약 50px 기준) */}
          <div className="max-h-[810px] overflow-y-auto scrollbar-hide">
            {loading && !data ? (
              <p className="py-10 text-center text-xs animate-pulse" style={{ color: "var(--cd-faint)" }}>
                미수금 데이터를 불러오는 중…
              </p>
            ) : listRows.length === 0 ? (
              <p className="py-10 text-center text-xs" style={{ color: "var(--cd-faint)" }}>
                조건에 맞는 미수금 건이 없습니다.
              </p>
            ) : (
              listRows.map((row) => (
                <div
                  key={row.milestoneId}
                  className="cdb-recv-row text-xs"
                  title="클릭하면 수금 정보를 바로 입력할 수 있습니다"
                  onClick={() => setModalRow(row)}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate font-bold" style={{ color: "var(--cd-text)" }}>
                        {row.contractTitle}
                      </span>
                      {agingTag(row)}
                    </span>
                    <span className="block truncate text-[10px]" style={{ color: "var(--cd-faint)" }}>
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
                        style={{ background: CATEGORY_META[row.category]?.color ?? "var(--cd-faint)" }}
                      />
                      {row.counterpartyName || "-"}
                    </span>
                  </span>
                  <span className="truncate text-[11px]" style={{ color: "var(--cd-muted)" }} title={row.stageLabel || undefined}>
                    {row.stageLabel || "-"}
                  </span>
                  <span className="text-center tabular-nums text-[11px]" style={{ color: "var(--cd-muted)" }}>
                    {row.invoiceIssuedAt ?? "-"}
                  </span>
                  <span className="text-right tabular-nums font-bold" style={{ color: "var(--cd-text)" }}>
                    {fmtFull(row.invoiceAmount)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 수금 입력 모달 */}
      {modalRow && (
        <CollectionEntryModal
          row={modalRow}
          onClose={() => setModalRow(null)}
          onSaved={() => {
            setModalRow(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}
