"use client";

// 공문 불러오기(2026-11-26 사용자 요청) — 같은 수신처에 비슷한 공문을 다시 보낼 때 예전 공문을
// 골라 작성 화면에 옮긴다. 위 검색창(공문명·수신처명·공문번호·기안자) + 연도별 트리 목록 +
// 오른쪽 PDF 미리보기. 고른 공문의 값은 GET /api/letters/{id}/copy 로 받아 onPick 에 넘긴다.
// 문서번호·시행일·동봉 첨부파일·결재선은 옮기지 않는다(lib/letter/types.ts LetterCopySource).

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, FileText, FolderClosed, FolderOpen, Search, X } from "lucide-react";
import type { LetterCopySource } from "@/lib/letter/types";

interface CopyableLetter {
  letterId: string;
  letterNo: string | null;
  year: string;
  title: string;
  recipientNames: string[];
  drafterName: string | null;
  issueDate: string | null;
}

export function LetterCopyModal({
  theme,
  recipientNames,
  onClose,
  onPick,
}: {
  theme: string;
  /** 작성 중인 공문의 수신처 이름 — 검색창 아래 빠른 검색 버튼으로 보여 준다 */
  recipientNames: string[];
  onClose: () => void;
  onPick: (source: LetterCopySource) => void;
}) {
  const [q, setQ] = useState("");
  const [letters, setLetters] = useState<CopyableLetter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 사용자가 직접 펼치거나 접은 연도 — 없으면 기본값(검색 중 = 전부, 평소 = 최근 연도)을 따른다
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  // 입력이 멎으면 서버 검색(수신처·참조는 JSON 안에 있어 서버에서 찾는다)
  useEffect(() => {
    const ac = new AbortController();
    const timer = setTimeout(() => {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      fetch(`/api/letters/copyable${qs}`, { cache: "no-store", signal: ac.signal })
        .then(async (r) => {
          const d = await r.json().catch(() => null);
          if (!r.ok) throw new Error(d?.error ?? "공문 목록을 불러오지 못했습니다.");
          setLetters(Array.isArray(d?.letters) ? d.letters : []);
          setError(null);
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") setError(err.message);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const years = useMemo(() => {
    const map = new Map<string, CopyableLetter[]>();
    for (const l of letters ?? []) {
      const list = map.get(l.year) ?? [];
      list.push(l);
      map.set(l.year, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [letters]);

  const searching = q.trim().length > 0;
  const isOpen = (year: string, index: number) => toggled[year] ?? (searching || index === 0);
  const selected = letters?.find((l) => l.letterId === selectedId) ?? null;
  const quickNames = [...new Set(recipientNames.map((n) => n.trim()).filter(Boolean))];

  // 두 번 누르면 바로 불러온다(목록에서 고른 뒤 [불러오기]와 같다)
  const load = async (letterId = selectedId) => {
    if (!letterId || busy) return;
    setSelectedId(letterId);
    setBusy(true);
    try {
      const res = await fetch(`/api/letters/${encodeURIComponent(letterId)}/copy`, { cache: "no-store" });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.source) throw new Error(d?.error ?? "공문 내용을 불러오지 못했습니다.");
      onPick(d.source as LetterCopySource);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    // 포털 모달 — .cdash 밖이라 cdash-vars + cd-fields-white + data-theme 부여(UI 규칙)
    <div
      className="cdash-vars cd-fields-white fixed inset-0 z-[80] flex items-center justify-center p-4"
      data-theme={theme}
      style={{ background: "rgba(15,20,34,0.45)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="공문 불러오기"
        className="rounded-lg bg-[color:var(--cd-card)] shadow-[var(--cd-shadow-dialog)] w-full max-w-[1280px] h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b cd-border-c">
          <FileText className="w-4 h-4 cd-text-primary shrink-0" />
          <span className="text-[14px] font-semibold cd-text whitespace-nowrap">공문 불러오기</span>
          <span className="cd-hint truncate hidden sm:inline">예전 공문을 골라 제목·수신처·본문을 그대로 가져온 뒤 고쳐 씁니다.</span>
          <button type="button" className="ml-auto cd-btn rounded-lg border cd-border-c p-1.5" onClick={onClose} aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {/* 왼쪽: 검색창 + 연도별 트리 */}
          <div className="md:w-[420px] shrink-0 flex flex-col min-h-0 max-h-[60%] md:max-h-none border-b md:border-b-0 md:border-r cd-border-c">
            <div className="p-3 flex flex-col gap-2 border-b cd-border-c">
              <label className="relative block">
                <Search className="w-4 h-4 cd-text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  autoFocus
                  className="cd-input !pl-9"
                  placeholder="공문명·수신처명·공문번호·기안자 검색"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </label>
              {quickNames.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] cd-text-faint">지금 수신처로 찾기</span>
                  {quickNames.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="cd-btn rounded-lg border cd-border-c px-2 py-1 text-[11px] cd-text-muted max-w-[220px] truncate"
                      onClick={() => setQ(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2" role="tree" aria-label="연도별 공문">
              {error ? (
                <p className="p-3 text-[12px] cd-error-text">{error}</p>
              ) : letters == null ? (
                <p className="p-3 text-[12px] cd-text-faint">불러오는 중입니다.</p>
              ) : years.length === 0 ? (
                <p className="p-3 text-[12px] cd-text-faint">
                  {searching ? "검색 결과가 없습니다." : "불러올 수 있는 공문이 없습니다."}
                </p>
              ) : (
                years.map(([year, list], index) => {
                  const open = isOpen(year, index);
                  return (
                    <div key={year} role="treeitem" aria-expanded={open} aria-selected={false}>
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left cd-text cd-row-hover"
                        onClick={() => setToggled((t) => ({ ...t, [year]: !open }))}
                      >
                        <span className="w-4 h-4 flex items-center justify-center cd-text-faint">
                          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </span>
                        {open ? (
                          <FolderOpen className="w-4 h-4 cd-text-primary" />
                        ) : (
                          <FolderClosed className="w-4 h-4 cd-text-primary" />
                        )}
                        <span className="text-[13px] font-semibold">{year}년</span>
                        <span className="ml-auto mr-1 text-[11px] font-semibold cd-text-faint">{list.length}</span>
                      </button>
                      {open && (
                        <div role="group" className="relative ml-[17px] pl-2 border-l cd-border-c flex flex-col gap-0.5 pb-1">
                          {list.map((l) => {
                            const active = l.letterId === selectedId;
                            return (
                              <button
                                key={l.letterId}
                                type="button"
                                role="treeitem"
                                aria-selected={active}
                                className={
                                  "w-full flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left " +
                                  (active ? "cd-soft-primary" : "cd-row-hover")
                                }
                                onClick={() => setSelectedId(l.letterId)}
                                onDoubleClick={() => void load(l.letterId)}
                              >
                                <span className="text-[13px] cd-text truncate">{l.title || "(제목 없음)"}</span>
                                <span className="flex items-center gap-2 text-[11px] cd-text-faint min-w-0">
                                  <span className="font-mono shrink-0">{l.letterNo ?? "미채번"}</span>
                                  <span className="truncate">{l.recipientNames.join(", ") || "수신처 없음"}</span>
                                  <span className="ml-auto shrink-0">{(l.issueDate ?? "").slice(0, 10)}</span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 오른쪽: 고른 공문 미리보기 */}
          <div className="relative flex-1 min-h-[160px] bg-[color:var(--cd-surface)]">
            {selected ? (
              <iframe
                key={selected.letterId}
                title="공문 미리보기"
                src={`/api/letters/${encodeURIComponent(selected.letterId)}/pdf?disposition=inline`}
                className="absolute inset-0 w-full h-full"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] cd-text-faint">
                왼쪽 목록에서 공문을 고르면 여기에 미리 보입니다.
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t cd-border-c flex-wrap">
          <span className="cd-hint w-full sm:w-auto sm:flex-1">
            문서번호·시행일·첨부파일·결재선은 가져오지 않습니다. 과거 이관 공문은 본문 원본이 없어 목록에 나오지 않습니다.
          </span>
          <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs ml-auto" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
            disabled={!selectedId || busy}
            onClick={() => void load()}
          >
            {busy ? "불러오는 중..." : "불러오기"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
