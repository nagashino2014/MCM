"use client";

import { useEffect, useMemo, useState } from "react";

/** 목록 화면당 표시 수 선택지(10-21 사용자 지정) — 메일·전자결재·파일함·문서함 공통, 기본 50. */
export const PAGE_SIZE_OPTIONS = [20, 30, 50];
export const DEFAULT_PAGE_SIZE = 50;

/** 화면당 표시 수 — 목록별 storageKey 로 사람마다 기억한다(저장소 차단 시 기본값). */
export function usePageSize(storageKey: string): [number, (n: number) => void] {
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(storageKey));
      if (PAGE_SIZE_OPTIONS.includes(saved)) setSize(saved);
    } catch {
      /* 저장소 차단 — 기본값 유지 */
    }
  }, [storageKey]);
  const change = (n: number) => {
    setSize(n);
    try {
      window.localStorage.setItem(storageKey, String(n));
    } catch {
      /* noop */
    }
  };
  return [size, change];
}

/**
 * 전체 행을 받아 두는 목록의 화면 쪽 나눔. pageRows 를 그리고 pager 를 목록 아래 오른쪽에 둔다.
 * 필터·탭이 바뀔 때는 resetPage() 로 첫 쪽으로 돌린다(행 수가 줄어 쪽이 비면 자동으로 마지막 쪽).
 */
export function useClientPaging<T>(rows: T[], storageKey: string, loading?: boolean) {
  const [pageSize, setPageSize] = usePageSize(storageKey);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (offset > 0 && offset >= rows.length) setOffset(Math.max(0, Math.floor((rows.length - 1) / pageSize) * pageSize));
  }, [rows.length, offset, pageSize]);
  const pageRows = useMemo(() => rows.slice(offset, offset + pageSize), [rows, offset, pageSize]);
  const pager = (
    <PaginationControls
      total={rows.length}
      limit={pageSize}
      offset={offset}
      loading={loading}
      onPageChange={setOffset}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      onPageSizeChange={(n) => {
        setPageSize(n);
        setOffset(0);
      }}
    />
  );
  return { pageRows, pager, resetPage: () => setOffset(0) };
}

interface Props {
  total: number;
  limit: number;
  offset: number;
  loading?: boolean;
  onPageChange: (nextOffset: number) => void;
  /** 화면당 표시 수 선택지(예: [20, 30, 50]). 지정하면 목록박스와 쪽 번호를 항상 표시한다. */
  pageSizeOptions?: number[];
  onPageSizeChange?: (nextLimit: number) => void;
}

export function PaginationControls({ total, limit, offset, loading, onPageChange, pageSizeOptions, onPageSizeChange }: Props) {
  const safeLimit = Math.max(1, limit);
  const pageCount = Math.max(1, Math.ceil(total / safeLimit));
  const pageIndex = Math.min(pageCount - 1, Math.floor(offset / safeLimit));
  const start = total === 0 ? 0 : pageIndex * safeLimit + 1;
  const end = Math.min(total, pageIndex * safeLimit + safeLimit);

  // Modernize(cdash) 토큰 기반 버튼 — cdash 밖에서도 깨지지 않도록 hex 폴백을 둔다.
  const navBtn =
    "rounded-lg px-2 py-1 font-bold border transition-colors bg-[var(--cd-surface,#f2f6fa)] border-[color:var(--cd-border,#e5eaef)] text-[color:var(--cd-muted,#5a6a85)] hover:border-[color:var(--cd-primary,#5d87ff)] hover:text-[color:var(--cd-primary,#5d87ff)] disabled:opacity-40";
  const activeBtn = "rounded-lg px-2 py-1 font-bold text-white bg-[color:var(--cd-primary,#5d87ff)]";

  const sizeSelect =
    pageSizeOptions?.length && onPageSizeChange ? (
      <select
        className="cd-select"
        style={{ width: "auto", minHeight: 0, height: 28, paddingBlock: 0, paddingLeft: 10, paddingRight: 28, fontSize: 11 }}
        value={safeLimit}
        disabled={loading}
        onChange={(e) => onPageSizeChange(Number(e.target.value))}
        aria-label="화면당 표시 수"
      >
        {pageSizeOptions.map((n) => (
          <option key={n} value={n}>
            {n}개씩
          </option>
        ))}
      </select>
    ) : null;

  if (!sizeSelect && total <= safeLimit && pageIndex === 0) {
    return (
      <div className="text-[11px] font-medium text-[color:var(--cd-faint,#7c8fac)]">
        {total === 0 ? "표시 0건" : `표시 ${start}-${end} / 총 ${total}`}
      </div>
    );
  }

  const pages = Array.from({ length: pageCount }, (_, i) => i).filter((idx) => {
    if (idx === 0 || idx === pageCount - 1) return true;
    return Math.abs(idx - pageIndex) <= 2;
  });

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap text-[11px] text-[color:var(--cd-muted,#5a6a85)]">
      <span className="font-medium">
        {total === 0 ? "표시 0건" : `표시 ${start}-${end} / 총 ${total}`}
      </span>
      <div className="flex items-center gap-1">
        {sizeSelect && <span className="mr-1.5">{sizeSelect}</span>}
        <button
          type="button"
          disabled={loading || pageIndex <= 0}
          onClick={() => onPageChange(Math.max(0, offset - safeLimit))}
          className={navBtn}
        >
          이전
        </button>
        {pages.map((idx, arrayIdx) => {
          const prev = pages[arrayIdx - 1];
          const needsGap = prev != null && idx - prev > 1;
          return (
            <span key={idx} className="flex items-center gap-1">
              {needsGap && <span className="px-1 text-[color:var(--cd-faint,#7c8fac)]">…</span>}
              <button
                type="button"
                disabled={loading}
                onClick={() => onPageChange(idx * safeLimit)}
                className={idx === pageIndex ? activeBtn : navBtn}
              >
                {idx + 1}
              </button>
            </span>
          );
        })}
        <button
          type="button"
          disabled={loading || pageIndex >= pageCount - 1}
          onClick={() => onPageChange(Math.min((pageCount - 1) * safeLimit, offset + safeLimit))}
          className={navBtn}
        >
          다음
        </button>
      </div>
    </div>
  );
}
