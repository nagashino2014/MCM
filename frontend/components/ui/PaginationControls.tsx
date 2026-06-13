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

  // Modernize(cdash) 토큰 기반 버튼 — cdash 밖에서도 깨지지 않도록 hex 폴백을 둔다.
  const navBtn =
    "rounded-lg px-2 py-1 font-bold border transition-colors bg-[var(--cd-surface,#f2f6fa)] border-[color:var(--cd-border,#e5eaef)] text-[color:var(--cd-muted,#5a6a85)] hover:border-[color:var(--cd-primary,#5d87ff)] hover:text-[color:var(--cd-primary,#5d87ff)] disabled:opacity-40";
  const activeBtn = "rounded-lg px-2 py-1 font-bold text-white bg-[color:var(--cd-primary,#5d87ff)]";

  if (total <= safeLimit && pageIndex === 0) {
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
        표시 {start}-{end} / 총 {total}
      </span>
      <div className="flex items-center gap-1">
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
