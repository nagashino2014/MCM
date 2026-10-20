"use client";

// 사용 매뉴얼 전역 컨텍스트 — 상단바 버튼·F1·? 도움말의 "자세히"·전역 검색이 같은 드로어를 연다.
// 새 소식 점: 마지막으로 본 변경 기록 날짜를 localStorage 에 둔다(없거나 막혀도 정상 동작).

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { visibleChangelog } from "@/lib/manual/match";
import { ManualDrawer } from "./ManualDrawer";

const SEEN_KEY = "mcm-manual-seen";

export interface ManualOpenOptions {
  article?: string;
  section?: string;
}

interface ManualApi {
  perms: readonly string[];
  open: (opts?: ManualOpenOptions) => void;
  close: () => void;
  isOpen: boolean;
  /** 아직 보지 않은 변경 기록이 있음 */
  hasUnseen: boolean;
}

const ManualCtx = createContext<ManualApi | null>(null);

/** 매뉴얼 컨텍스트 — AppShell 밖(디자인 미리보기 등)에서는 null. */
export function useManual(): ManualApi | null {
  return useContext(ManualCtx);
}

function readSeen(): string {
  try {
    return window.localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function ManualProvider({ perms, children }: { perms: readonly string[]; children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; article?: string; section?: string; nonce: number }>({ open: false, nonce: 0 });
  const latest = useMemo(() => visibleChangelog(perms).reduce((max, e) => (e.date > max ? e.date : max), ""), [perms]);
  const [hasUnseen, setHasUnseen] = useState(false);

  useEffect(() => {
    setHasUnseen(!!latest && readSeen() < latest);
  }, [latest]);

  const open = useCallback(
    (opts?: ManualOpenOptions) => {
      setState((s) => ({ open: true, article: opts?.article, section: opts?.section, nonce: s.nonce + 1 }));
      if (latest) {
        try {
          window.localStorage.setItem(SEEN_KEY, latest);
        } catch {
          // 저장소가 막혀 있으면 점만 계속 보인다.
        }
        setHasUnseen(false);
      }
    },
    [latest]
  );
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), []);

  // F1 — 브라우저 도움말 대신 앱 매뉴얼을 연다(열려 있으면 닫는다).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F1") return;
      e.preventDefault();
      if (state.open) close();
      else open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.open, open, close]);

  const api = useMemo<ManualApi>(() => ({ perms, open, close, isOpen: state.open, hasUnseen }), [perms, open, close, state.open, hasUnseen]);

  return (
    <ManualCtx.Provider value={api}>
      {children}
      <ManualDrawer
        key={state.nonce}
        open={state.open}
        onClose={close}
        perms={perms}
        initialArticle={state.article}
        initialSection={state.section}
      />
    </ManualCtx.Provider>
  );
}
