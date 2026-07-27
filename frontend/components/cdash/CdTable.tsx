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

  const toggleAll = () => {
    if (!selectable) return;
    onSelectChange!(allSelected ? new Set() : new Set(allKeys));
  };
  const toggleOne = (key: string) => {
    if (!selectable) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectChange!(next);
  };

  const cellPad = dense ? "px-3 py-2" : "px-4 py-3";

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b cd-border-c">
            {selectable && (
              <th className={cn(cellPad, "w-10")}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 accent-[var(--cd-primary)] cursor-pointer" aria-label="전체 선택" />
              </th>
            )}
            {columns.map((c) => {
              const isSorted = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  className={cn(
                    cellPad,
                    "text-xs font-bold cd-text-faint uppercase tracking-wide whitespace-nowrap",
                    c.widthClass,
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                    c.sortable && "cursor-pointer select-none hover:text-[color:var(--cd-text)]"
                  )}
                  onClick={
                    c.sortable && onSortChange
                      ? () => onSortChange({ key: c.key, dir: isSorted && sort!.dir === "asc" ? "desc" : "asc" })
                      : undefined
                  }
                >
                  <span className="inline-flex items-center gap-0.5">
                    {c.header}
                    {isSorted && (sort!.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-8 text-center text-sm cd-text-faint">
                불러오는 중입니다.
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)}>
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
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
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
                        c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"
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
