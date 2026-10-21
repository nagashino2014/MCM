"use client";

// 전역 검색(⌘K 커맨드 팔레트, G1) — 메뉴·화면 바로가기 + 내용 검색(메일·결재·주소록·계약·사업장·할 일, F-13 2026-10-21)
// + 사용 매뉴얼 기사(docs/manual-help-blueprint.md §1.1). 내용 검색은 /api/search 가 화면과 같은 열람 규칙으로 거른다.
// Ctrl/⌘+K 오픈, ↑↓ 이동, Enter 이동. CdModal 재사용.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { MENU_ITEMS, isMenuVisible, menuEntryHref, visibleSubmenu } from "@/config/menu";
import { CdModal } from "@/components/cdash/CdModal";
import { cn } from "@/lib/utils";
import { useManual } from "@/components/manual/ManualContext";
import { articleHref } from "@/lib/manual/match";
import { searchManual } from "@/lib/manual/search";
import { SEARCH_KIND_LABEL, type SearchResultItem } from "@/lib/search/kinds";

interface Entry {
  title: string;
  section: string;
  href: string;
  comingSoon?: boolean;
  /** 내용 검색 결과의 보조 줄 */
  detail?: string | null;
  /** 매뉴얼 기사 — 고르면 매뉴얼 드로어로 연다. */
  manual?: { article: string; section?: string };
}

export function GlobalSearch({ perms, open, onClose }: { perms: readonly string[]; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const manual = useManual();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // 내용 검색 — 입력 250ms 뒤 2글자 이상일 때. 늦게 온 이전 응답은 버린다.
  const [content, setContent] = useState<{ q: string; items: SearchResultItem[] } | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setContent(null);
      setContentLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setContentLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((j: { items?: SearchResultItem[] }) => setContent({ q, items: j.items ?? [] }))
        .catch(() => {})
        .finally(() => {
          if (!ctrl.signal.aborted) setContentLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, open]);

  // 메뉴 → 평탄화된 검색 엔트리(권한 필터 적용).
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    // 사이드바와 같은 권한 요약(perms) 기준 — 숨겨진 메뉴·서브메뉴는 검색 후보에도 나오지 않는다(M-41).
    for (const m of MENU_ITEMS.filter((m) => isMenuVisible(m, perms))) {
      out.push({ title: m.title, section: m.title, href: menuEntryHref(m, perms), comingSoon: m.comingSoon });
      for (const s of visibleSubmenu(m, perms)) out.push({ title: s.title, section: m.title, href: s.href });
    }
    return out;
  }, [perms]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 12);
    const menus = entries.filter((e) => e.title.toLowerCase().includes(q) || e.section.toLowerCase().includes(q)).slice(0, 8);
    const docs: Entry[] = searchManual(q, perms, 5).map((h) => ({
      title: h.article.title,
      section: "매뉴얼",
      href: articleHref(h.article.id, h.section),
      manual: { article: h.article.id, section: h.section },
    }));
    const found: Entry[] =
      content && content.q === query.trim()
        ? content.items.map((it) => ({ title: it.title, section: SEARCH_KIND_LABEL[it.kind], href: it.href, detail: it.detail }))
        : [];
    return [...menus, ...found, ...docs];
  }, [entries, query, perms, content]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // 모달 마운트 후 포커스.
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const go = useCallback(
    (e: Entry) => {
      if (e.comingSoon) return;
      onClose();
      if (e.manual && manual) manual.open(e.manual);
      else router.push(e.href);
    },
    [onClose, router, manual]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && filtered[cursor]) {
      e.preventDefault();
      go(filtered[cursor]);
    }
  };

  return (
    <CdModal open={open} onClose={onClose} size="lg">
      <div className="flex flex-col gap-2 -mx-1">
        <div className="flex items-center gap-2 border-b cd-border-c pb-3">
          <Search className="w-4 h-4 cd-text-faint shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="메뉴·메일·문서·사람·계약·매뉴얼 검색…"
            className="flex-1 bg-transparent outline-none text-sm cd-text placeholder:cd-text-faint"
          />
          <kbd className="text-[10px] cd-text-faint border cd-border-c rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="flex flex-col max-h-[50vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm cd-text-faint">{contentLoading ? "찾는 중…" : "결과가 없습니다."}</p>
          ) : (
            filtered.map((e, i) => (
              <button
                key={`${e.section}-${e.href}-${e.title}-${e.detail ?? ""}`}
                onClick={() => go(e)}
                onMouseEnter={() => setCursor(i)}
                className={cn(
                  "flex items-center justify-between px-3 py-2.5 rounded-lg text-left text-sm transition-colors",
                  i === cursor ? "cd-soft-primary" : "cd-text"
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="font-medium truncate">{e.title}</span>
                  {e.section !== e.title && <span className="text-xs cd-text-faint shrink-0">{e.section}</span>}
                  {e.detail && <span className="text-xs cd-text-faint truncate">{e.detail}</span>}
                  {e.comingSoon && <span className="text-[10px] cd-text-faint">예정</span>}
                </span>
                {i === cursor && <CornerDownLeft className="w-3.5 h-3.5 cd-text-faint shrink-0" />}
              </button>
            ))
          )}
          {contentLoading && filtered.length > 0 && <p className="px-3 py-2 text-xs cd-text-faint">메일·문서·사람 찾는 중…</p>}
        </div>
      </div>
    </CdModal>
  );
}
