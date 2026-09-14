"use client";

// 업종 조회(2026-08-26 사용자 요청) — 신규 계약 입력의 업종 선택 옆 버튼.
// 표준산업분류(KSIC-11) 코드/업종명으로 검색하면 각 항목이 통합허가 대상 20개 업종 중
// 어디에 해당하는지 판정해 보여주고, [적용]으로 계약 업종을 바로 선택한다.
// 검색 UI 는 facilities 의 KsicSearchModal 패턴, 판정은 integrated-permit-industries 정본 매핑.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BadgeCheck, Search, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { loadKsicList, type KsicEntry } from "@/lib/ieps/ksic-lookup";
import { industryCategoryForCode } from "@/lib/ieps/integrated-permit-industries";
import { INTEGRATED_PERMIT_OPTION_SUFFIX } from "@/components/contracts/IndustryOptionsEditor";

type SearchMode = "code" | "name";

const MAX_RESULTS = 200;

export function IndustryPermitLookupButton({ onApply }: { onApply: (optionName: string) => void }) {
  const { theme } = useCdashTheme();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SearchMode>("name");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<KsicEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    loadKsicList()
      .then((arr) => {
        if (cancelled) return;
        setList(arr);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      });
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [] as KsicEntry[];
    if (mode === "code") {
      const digits = q.replace(/\D/g, "");
      if (!digits) return [];
      return list.filter((item) => item.code.startsWith(digits)).slice(0, MAX_RESULTS);
    }
    const lower = q.toLowerCase();
    return list.filter((item) => item.name.toLowerCase().includes(lower)).slice(0, MAX_RESULTS);
  }, [list, query, mode]);

  const apply = (label: string) => {
    onApply(`${label}${INTEGRATED_PERMIT_OPTION_SUFFIX}`);
    setOpen(false);
  };

  const modal = (
    <div
      className="cdash-vars cd-fields-white fixed inset-0 z-[80] bg-stone-950/20 flex items-center justify-center p-4"
      data-theme={theme}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="cd-card rounded-3xl p-5 w-[min(720px,calc(100vw-32px))] max-h-[min(760px,calc(100vh-32px))] flex flex-col shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-xl font-bold cd-text flex items-center gap-2">
              <Search className="w-5 h-5 cd-text-primary" /> 업종 조회 — 통합허가 대상 판정
            </h3>
            <p className="text-xs cd-text-faint mt-1">
              표준산업분류(KSIC-11) 코드 또는 업종명으로 검색하면 통합허가 대상 20개 업종 중 어느 업종인지 표시합니다.
              대상 업종이면 [적용]으로 계약 업종을 바로 선택할 수 있습니다.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="cd-btn cd-btn-ghost rounded-xl px-2.5 py-2 cd-text-muted" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 검색 모드 토글 */}
        <div className="flex items-center gap-1 mb-2">
          <div className="inline-flex rounded-xl border cd-border-c cd-surface-bg p-0.5">
            {([
              ["name", "업종명"],
              ["code", "코드"],
            ] as [SearchMode, string][]).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                className={"rounded-lg px-3 py-1.5 text-xs font-bold " + (mode === k ? "cd-fill-primary text-white" : "cd-text-muted")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="relative mb-3">
          <Search className="w-4 h-4 cd-text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            className="cd-input pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "code" ? "업종 코드 (예: 26121, 261)" : "업종명 키워드 (예: 반도체, 인쇄회로기판)"}
            inputMode={mode === "code" ? "numeric" : "text"}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide border cd-border-c rounded-2xl">
          {loading ? (
            <div className="py-10 text-center text-sm cd-text-faint">불러오는 중…</div>
          ) : error ? (
            <div className="py-10 text-center text-sm cd-error-text">{error}</div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center text-sm cd-text-faint">{query.trim() ? "검색 결과가 없습니다." : "검색어를 입력하세요."}</div>
          ) : (
            <ul>
              {results.map((entry) => {
                const category = industryCategoryForCode(entry.code);
                return (
                  <li key={entry.code} className="flex items-center gap-3 px-3 py-2 border-b cd-border-c last:border-b-0 hover:bg-[color:var(--cd-surface)]">
                    <span className="font-mono text-xs font-bold cd-text-primary w-14 shrink-0">{entry.code}</span>
                    <span className="flex-1 text-sm cd-text truncate" title={entry.name}>
                      {entry.name}
                    </span>
                    {category ? (
                      <>
                        <span className="shrink-0 rounded-full cd-tint-primary cd-text-primary px-2.5 py-0.5 text-[11px] font-bold flex items-center gap-1">
                          <BadgeCheck className="w-3 h-3" /> {category.label}(통합허가)
                        </span>
                        <button
                          type="button"
                          onClick={() => apply(category.label)}
                          className="shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold cd-fill-primary text-white"
                          title="이 업종을 계약 업종으로 선택"
                        >
                          적용
                        </button>
                      </>
                    ) : (
                      <span className="shrink-0 rounded-full border cd-border-c cd-text-faint px-2.5 py-0.5 text-[11px]">대상 아님</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 mt-3">
          <span className="text-[11px] cd-text-faint">
            {loading || !query.trim()
              ? ""
              : `${results.length.toLocaleString()}건 표시${results.length >= MAX_RESULTS ? ` (상위 ${MAX_RESULTS}건, 검색어를 좁혀주세요)` : ""}`}
          </span>
          <button type="button" onClick={() => setOpen(false)} className="cd-btn cd-btn-ghost rounded-xl px-4 py-2 text-xs font-bold cd-text-muted">
            닫기
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cd-btn cd-btn-soft cd-btn-sm shrink-0"
        title="KSIC 코드·업종명으로 통합허가 대상 업종 판정"
      >
        <Search className="w-3.5 h-3.5" /> 업종 조회
      </button>
      {open && typeof document !== "undefined" && createPortal(modal, document.body)}
    </>
  );
}
