"use client";

// 전역 검색(⌘K 커맨드 팔레트, G1) — 1차 범위는 메뉴·화면 바로가기 네비게이션.
// 콘텐츠 검색(메일·문서·연락처)은 G2+ 에서 스코프 탭으로 확장한다(§2.2).
// Ctrl/⌘+K 오픈, ↑↓ 이동, Enter 이동. CdModal 재사용.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { MENU_ITEMS, isMenuVisibleForRole, type Role } from "@/config/menu";
import { CdModal } from "@/components/cdash/CdModal";
import { cn } from "@/lib/utils";

interface Entry {
  title: string;
  section: string;
  href: string;
  comingSoon?: boolean;
}

export function GlobalSearch({ role, open, onClose }: { role: Role; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 메뉴 → 평탄화된 검색 엔트리(권한 필터 적용).
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const m of MENU_ITEMS.filter((m) => isMenuVisibleForRole(m, role))) {
      out.push({ title: m.title, section: m.title, href: m.href, comingSoon: m.comingSoon });
      for (const s of m.submenu ?? []) out.push({ title: s.title, section: m.title, href: s.href });
    }
    return out;
  }, [role]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 12);
    return entries.filter((e) => e.title.toLowerCase().includes(q) || e.section.toLowerCase().includes(q)).slice(0, 12);
  }, [entries, query]);

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
      router.push(e.href);
    },
    [onClose, router]
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
            placeholder="메뉴·화면 검색… (콘텐츠 검색은 준비 중)"
            className="flex-1 bg-transparent outline-none text-sm cd-text placeholder:cd-text-faint"
          />
          <kbd className="text-[10px] cd-text-faint border cd-border-c rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="flex flex-col max-h-[50vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm cd-text-faint">결과가 없습니다.</p>
          ) : (
            filtered.map((e, i) => (
              <button
                key={`${e.href}-${e.title}`}
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
                  {e.comingSoon && <span className="text-[10px] cd-text-faint">예정</span>}
                </span>
                {i === cursor && <CornerDownLeft className="w-3.5 h-3.5 cd-text-faint shrink-0" />}
              </button>
            ))
          )}
        </div>
      </div>
    </CdModal>
  );
}
