"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, Check, Plus } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { loadKsicList, type KsicEntry } from "@/lib/ieps/ksic-lookup";

type SearchMode = "code" | "name";

const MAX_RESULTS = 300;

/**
 * 표준산업분류(KSIC-11) 업종 검색 모달.
 * 코드 기반 / 업종명 키워드 기반으로 검색해 선택하면 onAdd 로 전달한다.
 * public/ksic11.json 을 loadKsicList 로 지연 로드(클라이언트 캐시).
 */
export default function KsicSearchModal({
  existingCodes,
  onAdd,
  onClose,
}: {
  existingCodes: string[];
  onAdd: (entry: { code: string; name: string }) => void;
  onClose: () => void;
}) {
  const { theme } = useCdashTheme();
  const [mode, setMode] = useState<SearchMode>("name");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<KsicEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set(existingCodes));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
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
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return list.slice(0, MAX_RESULTS);
    if (mode === "code") {
      const digits = q.replace(/\D/g, "");
      if (!digits) return [];
      return list.filter((item) => item.code.includes(digits)).slice(0, MAX_RESULTS);
    }
    const lower = q.toLowerCase();
    return list
      .filter(
        (item) =>
          item.name.toLowerCase().includes(lower) ||
          (item.name_eng ?? "").toLowerCase().includes(lower)
      )
      .slice(0, MAX_RESULTS);
  }, [list, query, mode]);

  const handleAdd = (entry: KsicEntry) => {
    onAdd({ code: entry.code, name: entry.name });
    setAdded((prev) => new Set(prev).add(entry.code));
  };

  const modal = (
    <div
      className="cdash-vars cd-fields-white fixed inset-0 z-[80] bg-stone-950/20 flex items-center justify-center p-4"
      data-theme={theme}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cd-card rounded-3xl p-5 w-[min(680px,calc(100vw-32px))] max-h-[min(760px,calc(100vh-32px))] flex flex-col shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-xl font-bold cd-text flex items-center gap-2">
              <Search className="w-5 h-5 cd-text-primary" /> 업종 검색
            </h3>
            <p className="text-xs cd-text-faint mt-1">
              표준산업분류(KSIC-11) 코드 또는 업종명으로 검색해 선택합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cd-btn cd-btn-ghost rounded-xl px-2.5 py-2 cd-text-muted"
            aria-label="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 검색 모드 토글 */}
        <div className="flex items-center gap-1 mb-2">
          <div className="inline-flex rounded-xl border cd-border-c cd-surface-bg p-0.5">
            <button
              type="button"
              onClick={() => setMode("name")}
              className={
                "rounded-lg px-3 py-1.5 text-xs font-bold " +
                (mode === "name" ? "cd-fill-primary text-white" : "cd-text-muted")
              }
            >
              업종명
            </button>
            <button
              type="button"
              onClick={() => setMode("code")}
              className={
                "rounded-lg px-3 py-1.5 text-xs font-bold " +
                (mode === "code" ? "cd-fill-primary text-white" : "cd-text-muted")
              }
            >
              코드
            </button>
          </div>
        </div>

        {/* 검색 입력 */}
        <div className="relative mb-3">
          <Search className="w-4 h-4 cd-text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            className="cd-input pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === "code" ? "업종 코드 (예: 20119)" : "업종명 키워드 (예: 플라스틱, 도금)"
            }
            inputMode={mode === "code" ? "numeric" : "text"}
          />
        </div>

        {/* 결과 */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide border cd-border-c rounded-2xl">
          {loading ? (
            <div className="py-10 text-center text-sm cd-text-faint">불러오는 중…</div>
          ) : error ? (
            <div className="py-10 text-center text-sm cd-error-text">{error}</div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center text-sm cd-text-faint">
              {query.trim() ? "검색 결과가 없습니다." : "검색어를 입력하세요."}
            </div>
          ) : (
            <ul>
              {results.map((entry) => {
                const isAdded = added.has(entry.code);
                return (
                  <li
                    key={entry.code}
                    className="flex items-center gap-3 px-3 py-2 border-b cd-border-c last:border-b-0 hover:bg-[color:var(--cd-surface)]"
                  >
                    <span className="font-mono text-xs font-bold cd-text-primary w-14 shrink-0">
                      {entry.code}
                    </span>
                    <span className="flex-1 text-sm cd-text truncate" title={entry.name}>
                      {entry.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAdd(entry)}
                      disabled={isAdded}
                      className={
                        "shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-bold flex items-center gap-1 " +
                        (isAdded
                          ? "cd-tint-primary cd-text-primary cursor-default"
                          : "cd-fill-primary text-white")
                      }
                    >
                      {isAdded ? (
                        <>
                          <Check className="w-3 h-3" /> 추가됨
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" /> 추가
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 mt-3">
          <span className="text-[11px] cd-text-faint">
            {loading
              ? ""
              : `${results.length.toLocaleString()}건 표시${
                  results.length >= MAX_RESULTS ? " (상위 " + MAX_RESULTS + "건, 검색어를 좁혀주세요)" : ""
                }`}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="cd-btn cd-btn-ghost rounded-xl px-4 py-2 text-xs font-bold cd-text-muted"
          >
            완료
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
