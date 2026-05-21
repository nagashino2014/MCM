"use client";

interface Props {
  total: number;
  limit: number;
  offset: number;
  loading?: boolean;
  onPageChange: (nextOffset: number) => void;
}

export function PaginationControls({ total, limit, offset, loading, onPageChange }: Props) {
  const safeLimit = Math.max(1, limit);
  const pageCount = Math.max(1, Math.ceil(total / safeLimit));
  const pageIndex = Math.min(pageCount - 1, Math.floor(offset / safeLimit));
  const start = total === 0 ? 0 : pageIndex * safeLimit + 1;
  const end = Math.min(total, pageIndex * safeLimit + safeLimit);

  if (total <= safeLimit && pageIndex === 0) {
    return (
      <div className="text-[11px] text-stone-400 font-medium">
        {total === 0 ? "표시 0건" : `표시 ${start}-${end} / 총 ${total}`}
      </div>
    );
  }

  const pages = Array.from({ length: pageCount }, (_, i) => i).filter((idx) => {
    if (idx === 0 || idx === pageCount - 1) return true;
    return Math.abs(idx - pageIndex) <= 2;
  });

  return (
    <div className="flex items-center justify-between gap-3 flex-wrap text-[11px] text-stone-500">
      <span className="font-medium">
        표시 {start}-{end} / 총 {total}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={loading || pageIndex <= 0}
          onClick={() => onPageChange(Math.max(0, offset - safeLimit))}
          className="glass-button rounded-lg px-2 py-1 font-bold disabled:opacity-40"
        >
          이전
        </button>
        {pages.map((idx, arrayIdx) => {
          const prev = pages[arrayIdx - 1];
          const needsGap = prev != null && idx - prev > 1;
          return (
            <span key={idx} className="flex items-center gap-1">
              {needsGap && <span className="px-1 text-stone-300">…</span>}
              <button
                type="button"
                disabled={loading}
                onClick={() => onPageChange(idx * safeLimit)}
                className={
                  "rounded-lg px-2 py-1 font-bold " +
                  (idx === pageIndex
                    ? "bg-primary text-white"
                    : "glass-button text-stone-600")
                }
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
          className="glass-button rounded-lg px-2 py-1 font-bold disabled:opacity-40"
        >
          다음
        </button>
      </div>
    </div>
  );
}
