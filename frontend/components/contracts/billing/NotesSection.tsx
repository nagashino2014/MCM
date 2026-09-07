"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, CalendarClock, FileSignature, TriangleAlert } from "lucide-react";
import {
  NOTE_PERIOD_UNITS,
  filterNoteRows,
  noteIssuedBasisDate,
  notePeriodOptions,
  notePeriodRange,
  type ContractNoteRow,
  type ContractNoteStatus,
  type NoteBasis,
  type NotePeriodUnit,
} from "@/lib/ieps/note-types";
import { fmtFull, type CdTheme } from "@/components/contracts/dashboard/types";
import { filenameFromDisposition } from "@/lib/client-download";

const withVat = (supply: number) => Math.round(supply * 1.1);

/**
 * 어음 현황 — 월/분기/반기/연간 단위로 어음 발행·만기 도래 건을 총괄 조회한다
 * (2026-09-03 사용자 요청, 세무사 반기별 제출 대응). 단계별 어음 상세(마이그 200·201) 입력이 원천이며,
 * 어음 발행일 미입력 건은 계산서 발행일을 발행 기준일로 폴백한다.
 */
export function NotesSection({ theme }: { theme: CdTheme }) {
  const router = useRouter();
  const [data, setData] = useState<ContractNoteStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [unit, setUnit] = useState<NotePeriodUnit>("half");
  const [seq, setSeq] = useState<number>(new Date().getMonth() < 6 ? 1 : 2);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/contracts/billing/notes", { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string })?.error ?? "HTTP " + res.status);
        }
        const json = (await res.json()) as ContractNoteStatus;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allRows = useMemo(() => data?.rows ?? [], [data]);

  // 연도 선택지 — 어음 발행·만기일이 걸친 연도들(+현재 연도), 최신순.
  const yearOptions = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear()]);
    for (const row of allRows) {
      for (const d of [noteIssuedBasisDate(row), row.noteMaturityDate]) {
        const y = Number((d ?? "").slice(0, 4));
        if (y >= 2000) set.add(y);
      }
    }
    return [...set].sort((a, b) => b - a);
  }, [allRows]);

  const period = useMemo(() => notePeriodRange(year, unit, seq), [year, unit, seq]);
  const issuedRows = useMemo(
    () => sortByBasis(filterNoteRows(allRows, "issued", period.from, period.to), "issued"),
    [allRows, period]
  );
  const maturityRows = useMemo(
    () => sortByBasis(filterNoteRows(allRows, "maturity", period.from, period.to), "maturity"),
    [allRows, period]
  );
  const issuedTotal = useMemo(() => issuedRows.reduce((acc, r) => acc + r.amount, 0), [issuedRows]);
  const maturityTotal = useMemo(() => maturityRows.reduce((acc, r) => acc + r.amount, 0), [maturityRows]);
  // 만기 경과 미수 — 기간과 무관하게 오늘 기준으로 항상 경보를 띄운다(회계 마감 시 반드시 봐야 하는 건).
  const overdueRows = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return allRows.filter((r) => !r.collected && r.noteMaturityDate && r.noteMaturityDate < today);
  }, [allRows]);
  const overdueTotal = useMemo(
    () => overdueRows.reduce((acc, r) => acc + Math.max(0, r.amount - r.collectedAmount), 0),
    [overdueRows]
  );

  const changeUnit = (nextUnit: NotePeriodUnit) => {
    setUnit(nextUnit);
    // 단위를 바꾸면 세부 기간을 "지금"이 속한 구간으로 초기화한다.
    const month = new Date().getMonth() + 1;
    setSeq(nextUnit === "half" ? (month <= 6 ? 1 : 2) : nextUnit === "quarter" ? Math.ceil(month / 3) : nextUnit === "month" ? month : 1);
  };

  const handleExport = async (kind: NoteBasis, format: "xlsx" | "pdf") => {
    const key = `${kind}-${format}`;
    if (exporting) return;
    setExporting(key);
    try {
      const params = new URLSearchParams({ kind, format, year: String(year), unit, seq: String(seq) });
      const res = await fetch("/api/contracts/billing/notes/export?" + params.toString());
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.download = filenameFromDisposition(res, `어음현황_${stamp}.${format}`);
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

  const openContract = (row: ContractNoteRow) => {
    const treeYear = (row.contractDate ?? "").slice(0, 4);
    const params = new URLSearchParams();
    params.set("contract", row.contractId);
    if (/^\d{4}$/.test(treeYear)) params.set("year", treeYear);
    params.set("milestone", row.milestoneId);
    router.push(`/contracts?${params.toString()}`);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 필터 바: 연도 + 단위 + 세부 기간 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-extrabold" style={{ color: "var(--cd-faint)" }}>
            기준 연도
          </span>
          <select
            className="cd-input"
            style={{ width: "6.5rem" }}
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {(yearOptions.includes(year) ? yearOptions : [year, ...yearOptions]).map((item) => (
              <option key={item} value={item}>
                {item}년
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-extrabold mr-1" style={{ color: "var(--cd-faint)" }}>
            기간 단위
          </span>
          {NOTE_PERIOD_UNITS.map(({ unit: u, label }) => (
            <button key={u} type="button" className="cd-chip cd-chip-sm" data-active={unit === u} onClick={() => changeUnit(u)}>
              {label}
            </button>
          ))}
        </div>
        {unit !== "year" && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {notePeriodOptions(unit).map(({ seq: s, label }) => (
              <button key={s} type="button" className="cd-chip cd-chip-sm" data-active={seq === s} onClick={() => setSeq(s)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <span className="ml-auto text-[11px] font-bold tabular-nums" style={{ color: "var(--cd-muted)" }}>
          {period.label} ({period.from} ~ {period.to})
        </span>
      </div>

      {error && (
        <p
          className="text-[11px] font-bold px-3 py-2 rounded-lg"
          style={{ background: "var(--cd-error-soft)", color: "var(--cd-error)" }}
        >
          불러오기 실패: {error}
        </p>
      )}

      {/* 요약 스탯 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatBox
          icon={<FileSignature className="w-4 h-4" />}
          label={`${period.label} 어음 발행`}
          count={issuedRows.length}
          amount={issuedTotal}
        />
        <StatBox
          icon={<CalendarClock className="w-4 h-4" />}
          label={`${period.label} 어음 만기 도래`}
          count={maturityRows.length}
          amount={maturityTotal}
        />
        <StatBox
          icon={<TriangleAlert className="w-4 h-4" />}
          label="만기 경과 미수(오늘 기준)"
          count={overdueRows.length}
          amount={overdueTotal}
          danger
        />
      </div>

      {/* 발행/만기 리스트 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <NoteList
          title={`${period.label} 발행 어음`}
          icon={<FileSignature className="w-4 h-4" />}
          basis="issued"
          rows={issuedRows}
          total={issuedTotal}
          loading={loading && !data}
          exporting={exporting}
          onExport={handleExport}
          onOpen={openContract}
        />
        <NoteList
          title={`${period.label} 만기 어음`}
          icon={<AlarmClock className="w-4 h-4" />}
          basis="maturity"
          rows={maturityRows}
          total={maturityTotal}
          loading={loading && !data}
          exporting={exporting}
          onExport={handleExport}
          onOpen={openContract}
        />
      </div>

      <p className="text-[10px] font-bold" style={{ color: "var(--cd-faint)" }}>
        금액은 청구 공급가액 기준이며, 액면 환산은 공급가액 ×1.1(VAT 포함)로 표기합니다. 어음 발행일이 입력되지 않은 건은
        계산서 발행일을 발행 기준일로 사용합니다(® 표시). 어음 정보는 계약 상세의 단계 수정에서 입력합니다.
      </p>
    </div>
  );
}

function sortByBasis(rows: ContractNoteRow[], basis: NoteBasis): ContractNoteRow[] {
  const dateOf = (r: ContractNoteRow) => (basis === "issued" ? noteIssuedBasisDate(r) ?? "" : r.noteMaturityDate ?? "");
  return [...rows].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
}

function StatBox({
  icon,
  label,
  count,
  amount,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  amount: number;
  danger?: boolean;
}) {
  const accent = danger && count > 0 ? "var(--cd-error)" : "var(--cd-primary)";
  return (
    <div className="cdb-box p-4 flex items-center gap-3">
      <span
        className="inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
        style={{ background: danger && count > 0 ? "var(--cd-error-soft)" : "var(--cd-primary-soft)", color: accent }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-extrabold truncate" style={{ color: "var(--cd-faint)" }}>
          {label}
        </p>
        <p className="text-sm font-extrabold tabular-nums" style={{ color: danger && count > 0 ? "var(--cd-error)" : "var(--cd-text)" }}>
          {count.toLocaleString()}건 · {amount > 0 ? `${fmtFull(amount)}원` : "-"}
        </p>
      </div>
    </div>
  );
}

function NoteList({
  title,
  icon,
  basis,
  rows,
  total,
  loading,
  exporting,
  onExport,
  onOpen,
}: {
  title: string;
  icon: React.ReactNode;
  basis: NoteBasis;
  rows: ContractNoteRow[];
  total: number;
  loading: boolean;
  exporting: string | null;
  onExport: (kind: NoteBasis, format: "xlsx" | "pdf") => void;
  onOpen: (row: ContractNoteRow) => void;
}) {
  return (
    <div className="cdb-box p-4 min-w-0">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <p className="cd-card-title">
          <span className="cd-title-icon">{icon}</span>
          {title}
        </p>
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[11px] font-bold mr-1 tabular-nums" style={{ color: "var(--cd-muted)" }}>
            {rows.length.toLocaleString()}건 · {total > 0 ? `${fmtFull(total)}원` : "-"}
          </span>
          <button
            type="button"
            onClick={() => onExport(basis, "xlsx")}
            disabled={exporting !== null || rows.length === 0}
            title="이 리스트를 엑셀로 다운로드"
            className="flex items-center justify-center disabled:opacity-40"
            style={{ width: 28, height: 28 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/excelico.png" alt="엑셀 다운로드" className="w-full h-full object-contain" />
          </button>
          <button
            type="button"
            onClick={() => onExport(basis, "pdf")}
            disabled={exporting !== null || rows.length === 0}
            title="이 리스트를 PDF로 다운로드"
            className="flex items-center justify-center disabled:opacity-40"
            style={{ width: 28, height: 28 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/pdfico.png" alt="PDF 다운로드" className="w-full h-full object-contain" />
          </button>
        </div>
      </div>

      {/* 열 레이블 */}
      <div
        className="grid grid-cols-[minmax(0,1fr)_92px_76px_96px_58px] gap-2 items-center px-2 py-1.5 text-[11px] font-extrabold"
        style={{ color: "var(--cd-faint)" }}
      >
        <span>발주처 · 용역명</span>
        <span>어음 종류·은행</span>
        <span className="text-center">{basis === "issued" ? "발행일" : "만기일"}</span>
        <span className="text-right">공급가액</span>
        <span className="text-center">상태</span>
      </div>

      <div className="max-h-[520px] overflow-y-auto scrollbar-hide">
        {loading ? (
          <p className="py-10 text-center text-xs animate-pulse" style={{ color: "var(--cd-faint)" }}>
            어음 데이터를 불러오는 중…
          </p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-xs" style={{ color: "var(--cd-faint)" }}>
            해당 기간의 어음 건이 없습니다.
          </p>
        ) : (
          rows.map((row) => {
            const baseDate = basis === "issued" ? noteIssuedBasisDate(row) : row.noteMaturityDate;
            const fallback = basis === "issued" && !row.noteIssuedDate;
            return (
              <div
                key={`${row.milestoneId}-${basis}`}
                className="grid grid-cols-[minmax(0,1fr)_92px_76px_96px_58px] gap-2 items-center px-2 py-2 rounded-lg text-xs cursor-pointer hover:bg-[color:var(--cd-surface)]"
                title="클릭하면 계약 관리에서 해당 계약이 열립니다"
                onClick={() => onOpen(row)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-bold" style={{ color: "var(--cd-text)" }}>
                    {row.counterpartyName || "-"}
                  </span>
                  <span className="block truncate text-[10px]" style={{ color: "var(--cd-faint)" }}>
                    {row.contractTitle}
                    {row.stageLabel ? ` · ${row.stageLabel}` : ""}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px]" style={{ color: "var(--cd-muted)" }}>
                    {row.noteKind ?? "-"}
                  </span>
                  <span className="block truncate text-[10px]" style={{ color: "var(--cd-faint)" }}>
                    {row.noteBank ?? "-"}
                  </span>
                </span>
                <span
                  className="text-center tabular-nums text-[11px]"
                  style={{ color: "var(--cd-muted)" }}
                  title={fallback ? "어음 발행일 미입력 — 계산서 발행일 기준" : undefined}
                >
                  {baseDate ?? "-"}
                  {fallback ? "®" : ""}
                </span>
                <span
                  className="text-right tabular-nums font-bold"
                  style={{ color: "var(--cd-text)" }}
                  title={row.amount > 0 ? `액면 환산(VAT 포함) ${fmtFull(withVat(row.amount))}원` : undefined}
                >
                  {row.amount > 0 ? fmtFull(row.amount) : "-"}
                </span>
                <span className="text-center">
                  {row.collected ? (
                    <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold cd-tint-primary" style={{ color: "var(--cd-primary)" }}>
                      수금
                    </span>
                  ) : (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                      style={{ background: "var(--cd-error-soft)", color: "var(--cd-error)" }}
                    >
                      미수
                    </span>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
