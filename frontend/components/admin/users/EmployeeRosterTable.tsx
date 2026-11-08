"use client";

/**
 * 직원 일람표 — 1명 1행(직위·연령·학력·경력·보유 자격증·연봉). 데이터는 인사카드·근로계약을 읽기만 한다.
 * 비어 있는 필수 칸(생년월일·입사일·학력·연봉)은 '미등록'으로 표시하고, 위 칩으로 그런 직원만 걸러 본다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, TableProperties } from "lucide-react";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import { CdHelp } from "@/components/cdash/CdHelp";
import { filenameFromDisposition } from "@/lib/client-download";
import { formatMonths } from "@/lib/admin/employee-roster-rules";
import type { EmployeeRoster, EmployeeRosterRow } from "@/lib/admin/employee-roster";
import { cn } from "@/lib/utils";

const won = (v: number) => v.toLocaleString("ko-KR");

export default function EmployeeRosterTable({ toast }: { toast: (message: string, type?: "success" | "error") => void }) {
  const [roster, setRoster] = useState<EmployeeRoster | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [includeResigned, setIncludeResigned] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const res = await fetch(`/api/admin/employees/roster${includeResigned ? "?resigned=1" : ""}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "조회 실패");
      setRoster(data as EmployeeRoster);
    } catch (err) {
      setFailed((err as Error).message);
    }
  }, [includeResigned]);

  useEffect(() => {
    void load();
  }, [load]);

  const missingCount = useMemo(() => (roster?.rows ?? []).filter((r) => r.missing.length).length, [roster]);
  const rows = useMemo(() => {
    const needle = q.trim();
    return (roster?.rows ?? []).filter(
      (r) =>
        (!onlyMissing || r.missing.length > 0) &&
        (!needle || [r.name, r.deptName, r.positionName].some((v) => v?.includes(needle)))
    );
  }, [roster, q, onlyMissing]);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/admin/employees/roster?format=xlsx${includeResigned ? "&resigned=1" : ""}`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFromDisposition(res, "직원 일람표.xlsx");
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast("내보내기에 실패했습니다. 잠시 후 다시 시도해주세요.", "error");
    } finally {
      setExporting(false);
    }
  };

  if (failed && !roster) {
    return (
      <CdEmptyState
        icon={<TableProperties className="w-7 h-7" />}
        title="직원 일람표를 불러오지 못했습니다"
        description={failed}
      />
    );
  }
  if (!roster) return <p className="text-sm cd-text-faint p-4">불러오는 중입니다.</p>;

  const certs = roster.certificationNames;
  const showStatus = includeResigned;
  const colCount = 13 + certs.length + (roster.salaryVisible ? 1 : 0) + (showStatus ? 1 : 0);
  const missingCell = <span className="text-[11px] font-semibold" style={{ color: "var(--cd-error)" }}>미등록</span>;

  return (
    <section className="cd-card rounded-3xl flex-1 min-h-0 flex flex-col cd-reveal">
      <div className="flex items-center gap-2 flex-wrap px-5 pt-4 pb-3">
        <h2 className="text-[15px] font-extrabold tracking-tight cd-text flex items-center gap-1">
          직원 일람표
          <CdHelp topic="admin.roster" />
        </h2>
        <span className="text-[11px] cd-text-faint">{roster.asOf.replace(/-/g, ".")}. 현재 · {rows.length}명</span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Search className="w-4 h-4 cd-text-faint" />
          <input
            className="cd-input"
            style={{ width: 200, maxWidth: "100%" }}
            placeholder="이름·소속·직위 검색"
            aria-label="직원 일람표 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="button" className="cd-chip cd-chip-sm" data-active={includeResigned || undefined} onClick={() => setIncludeResigned((v) => !v)}>
            퇴사자 포함
          </button>
          {missingCount > 0 && (
            <button type="button" className="cd-chip cd-chip-sm" data-active={onlyMissing || undefined} onClick={() => setOnlyMissing((v) => !v)}>
              미등록 있음 {missingCount}명
            </button>
          )}
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            title="직원 일람표를 엑셀로 다운로드"
            className={cn("shrink-0 flex items-center justify-center disabled:opacity-40", exporting && "cursor-wait")}
            style={{ width: 30, height: 30 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/excelico.png" alt="엑셀 다운로드" className="w-full h-full object-contain" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
        <table className="w-full text-sm" style={{ minWidth: 1240 + certs.length * 92 + (roster.salaryVisible ? 110 : 0) }}>
          <thead className="cd-table-head">
            <tr className="cd-text-faint text-[11px]">
              <Th rowSpan={2} sticky>성명</Th>
              <Th rowSpan={2}>소속</Th>
              <Th rowSpan={2}>직위</Th>
              <Th rowSpan={2}>생년월일</Th>
              <Th rowSpan={2} right>연령</Th>
              <Th rowSpan={2}>입사일</Th>
              <Th rowSpan={2}>최종학력</Th>
              <Th rowSpan={2}>졸업</Th>
              <Th colSpan={3} center>경력</Th>
              <Th rowSpan={2}>기술 등급</Th>
              <Th rowSpan={2}>대행 등급</Th>
              {certs.length > 0 && <Th colSpan={certs.length} center>보유 자격증</Th>}
              {roster.salaryVisible && <Th rowSpan={2} right>연봉</Th>}
              {showStatus && <Th rowSpan={2}>퇴사일</Th>}
            </tr>
            <tr className="cd-text-faint text-[11px] border-b cd-border-c">
              <Th right>당사</Th>
              <Th right>이전</Th>
              <Th right>합계</Th>
              {certs.map((name) => (
                <Th key={name} center>{name}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RosterRow key={r.employeeId} r={r} certs={certs} salaryVisible={roster.salaryVisible} showStatus={showStatus} missingCell={missingCell} />
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={colCount} className="p-6 text-center text-sm cd-text-faint">표시할 직원이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({
  children,
  rowSpan,
  colSpan,
  sticky,
  right,
  center,
}: {
  children: React.ReactNode;
  rowSpan?: number;
  colSpan?: number;
  sticky?: boolean;
  right?: boolean;
  center?: boolean;
}) {
  return (
    <th
      rowSpan={rowSpan}
      colSpan={colSpan}
      className={cn(
        "font-semibold p-2.5 whitespace-nowrap",
        right ? "text-right" : center ? "text-center" : "text-left",
        sticky && "sticky left-0 z-10"
      )}
      style={sticky ? { background: "var(--cd-surface)", boxShadow: "-14px 0 0 var(--cd-surface)" } : undefined}
    >
      {children}
    </th>
  );
}

function RosterRow({
  r,
  certs,
  salaryVisible,
  showStatus,
  missingCell,
}: {
  r: EmployeeRosterRow;
  certs: string[];
  salaryVisible: boolean;
  showStatus: boolean;
  missingCell: React.ReactNode;
}) {
  const td = "p-2.5 cd-text whitespace-nowrap";
  return (
    <tr className="border-b cd-border-c last:border-0">
      <td className={cn(td, "font-semibold sticky left-0 z-10")} style={{ background: "var(--cd-card-solid)", boxShadow: "-14px 0 0 var(--cd-card-solid)" }}>
        {r.name}
        {r.status === "inactive" && (
          <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ color: "var(--cd-warning)", background: "var(--cd-warning-soft)" }}>
            퇴사
          </span>
        )}
      </td>
      <td className={td}>{r.deptName ?? "-"}</td>
      <td className={td}>{r.positionName ?? "-"}</td>
      <td className={cn(td, "tabular-nums")}>{r.birthDate ?? missingCell}</td>
      <td className={cn(td, "text-right tabular-nums")}>{r.age == null ? "" : `${r.age}세`}</td>
      <td className={cn(td, "tabular-nums")}>{r.hiredAt ?? missingCell}</td>
      <td className="p-2.5 cd-text min-w-[220px]">
        {r.education ? (
          <>
            {r.education.schoolName}
            {r.education.major && <span className="cd-text-muted"> {r.education.major}</span>}
            <span className="ml-1 text-[11px] font-semibold cd-text-muted">{r.education.degree}</span>
          </>
        ) : (
          missingCell
        )}
      </td>
      <td className={cn(td, "tabular-nums")}>{r.education?.graduationYear ?? ""}</td>
      <td className={cn(td, "text-right tabular-nums")}>{formatMonths(r.careerCompanyMonths)}</td>
      <td className={cn(td, "text-right tabular-nums")}>{formatMonths(r.careerPriorMonths)}</td>
      <td className={cn(td, "text-right tabular-nums font-semibold")}>{formatMonths(r.careerTotalMonths)}</td>
      <td className={td}>{r.engGrade ?? ""}</td>
      <td className={td}>{r.envGrade ?? ""}</td>
      {certs.map((name) => (
        <td key={name} className={cn(td, "text-center tabular-nums text-xs")}>
          {name in r.certifications ? r.certifications[name] || "보유" : ""}
        </td>
      ))}
      {salaryVisible && (
        <td className={cn(td, "text-right tabular-nums")} title={r.salaryFrom ? `근로계약 ${r.salaryFrom} 기준` : undefined}>
          {r.annualSalary == null ? missingCell : won(r.annualSalary)}
        </td>
      )}
      {showStatus && <td className={cn(td, "tabular-nums")}>{r.resignedAt ?? ""}</td>}
    </tr>
  );
}
