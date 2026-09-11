"use client";

// cdash 공통 테이블 — 정렬·행 선택(체크박스)·클릭 행·빈 상태·로딩(G0).
// 컬럼 정의 기반 제어 컴포넌트. 페이지네이션은 기존 PaginationControls 를 밖에서 조합.

import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";

export interface CdColumn<Row> {
  key: string;
  header: ReactNode;
  render: (row: Row, index: number) => ReactNode;
  /** 정렬 가능 여부 — 정렬 상태는 부모 제어(onSortChange). */
  sortable?: boolean;
  widthClass?: string;
  align?: "left" | "center" | "right";
}

export interface CdSortState {
  key: string;
  dir: "asc" | "desc";
}

export interface CdTableProps<Row> {
  columns: CdColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  loading?: boolean;
  /** 빈 상태 표현(미지정 시 기본 문구). */
  empty?: ReactNode;
  sort?: CdSortState | null;
  onSortChange?: (next: CdSortState) => void;
  /** 행 클릭(상세 열기). 지정 시 커서 포인터. */
  onRowClick?: (row: Row) => void;
  /** 선택 기능 — selectedKeys 지정 시 체크박스 컬럼 활성. */
  selectedKeys?: Set<string>;
  onSelectChange?: (keys: Set<string>) => void;
  /** compact 밀도(그룹웨어 목록용). */
  dense?: boolean;
  className?: string;
}

export function CdTable<Row>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  sort,
  onSortChange,
  onRowClick,
  selectedKeys,
  onSelectChange,
  dense,
  className,
}: CdTableProps<Row>) {
  const selectable = selectedKeys != null && onSelectChange != null;
  const allKeys = rows.map((r, i) => rowKey(r, i));
  const allSelected = selectable && allKeys.length > 0 && allKeys.every((k) => selectedKeys!.has(k));
  const someSelected = selectable && allKeys.some((k) => selectedKeys!.has(k));
  const columnCount = columns.length + (selectable ? 1 : 0);

  const toggleAll = () => {
    if (!selectable) return;
    const next = new Set(selectedKeys);
    allKeys.forEach((key) => allSelected ? next.delete(key) : next.add(key));
    onSelectChange!(next);
  };
  const toggleOne = (key: string) => {
    if (!selectable) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectChange!(next);
  };

  const cellPad = "px-3 py-2";

  return (
    <div className={cn("relative min-w-0 overflow-x-auto", className)} aria-busy={loading || undefined}>
      <table className="cd-table" data-dense={dense || undefined}>
        <thead>
          <tr className="border-b cd-border-c">
            {selectable && (
              <th className={cn(cellPad, "w-10")}>
                <input type="checkbox" checked={allSelected} ref={(input) => { if (input) input.indeterminate = !!someSelected && !allSelected; }} onChange={toggleAll} className="w-4 h-4 accent-[var(--cd-primary)] cursor-pointer" aria-label="현재 페이지 전체 선택" />
              </th>
            )}
            {columns.map((c) => {
              const isSorted = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={isSorted ? sort!.dir === "asc" ? "ascending" : "descending" : c.sortable ? "none" : undefined}
                  className={cn(
                    cellPad,
                    "text-xs font-medium cd-text-muted whitespace-nowrap",
                    c.widthClass,
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                    c.sortable && "select-none"
                  )}
                >
                  {c.sortable && onSortChange ? <button type="button" className="inline-flex items-center gap-1 hover:text-[color:var(--cd-text)]" onClick={() => onSortChange({ key: c.key, dir: isSorted && sort!.dir === "asc" ? "desc" : "asc" })}>
                    {c.header}
                    {isSorted && (sort!.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </button> : c.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-8 text-center text-sm cd-text-faint">
                불러오는 중입니다.
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columnCount}>
                {empty ?? <CdEmptyState title="데이터가 없습니다." />}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const key = rowKey(row, i);
              return (
                <tr
                  key={key}
                  className={cn("border-b cd-border-c last:border-b-0 transition-colors", onRowClick && "cursor-pointer cd-row-hover")}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? (event) => { if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) { event.preventDefault(); onRowClick(row); } } : undefined}
                  aria-selected={selectable ? selectedKeys!.has(key) : undefined}
                  onClick={onRowClick ? (event) => {
                    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, [role="button"]')) return;
                    onRowClick(row);
                  } : undefined}
                >
                  {selectable && (
                    <td className={cn(cellPad, "w-10")} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedKeys!.has(key)}
                        onChange={() => toggleOne(key)}
                        className="w-4 h-4 accent-[var(--cd-primary)] cursor-pointer"
                        aria-label="행 선택"
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        cellPad,
                        "cd-text align-middle",
                        c.align === "right" ? "text-right tabular-nums" : c.align === "center" ? "text-center" : "text-left"
                      )}
                    >
                      {c.render(row, i)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
