"use client";

// cdash 공통 토스트 — 전역 프로바이더 + useCdToast() 훅(G0).
// 발송/저장/오류 피드백 표준. 우하단 스택, 자동 소멸(기본 3.5초), 수동 닫기.
// AppShell(G1)에서 <CdToastProvider> 로 감싼다. 포털이라 cdash-vars 부여.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, Info, X, XCircle } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";

export type CdToastTone = "success" | "error" | "warn" | "info";

interface ToastItem {
  id: number;
  tone: CdToastTone;
  message: ReactNode;
}

interface ToastContextValue {
  toast: (message: ReactNode, tone?: CdToastTone, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** 토스트 발행 훅 — const { toast } = useCdToast(); toast("저장했습니다", "success"); */
export function useCdToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // 프로바이더 밖(스토리 단위 사용 등)에서도 죽지 않게 콘솔 폴백.
    return { toast: (m) => console.warn("[CdToast] Provider 밖 호출:", m) };
  }
  return ctx;
}

const TONE_ICON: Record<CdToastTone, ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 cd-success-text shrink-0" />,
  error: <XCircle className="w-4 h-4 cd-error-text shrink-0" />,
  warn: <AlertTriangle className="w-4 h-4 cd-warn-text shrink-0" />,
  info: <Info className="w-4 h-4 shrink-0" style={{ color: "var(--cd-primary)" }} />,
};

export function CdToastProvider({ children }: { children: ReactNode }) {
  const { theme } = useCdashTheme();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: ReactNode, tone: CdToastTone = "info", durationMs = 3500) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-4), { id, tone, message }]); // 최대 5개 스택
      if (durationMs > 0) setTimeout(() => dismiss(id), durationMs);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {mounted &&
        createPortal(
          <div className="cdash cdash-vars fixed bottom-4 right-4 z-[200] flex flex-col gap-2 items-end" data-theme={theme}>
            {items.map((t) => (
              <div
                key={t.id}
                className="cd-card-bg rounded-xl border cd-border-c px-3.5 py-2.5 flex items-center gap-2 text-sm cd-text min-w-[220px] max-w-sm"
                style={{ boxShadow: "var(--cd-shadow)" }}
                role="status"
              >
                {TONE_ICON[t.tone]}
                <span className="flex-1">{t.message}</span>
                <button onClick={() => dismiss(t.id)} aria-label="닫기" className="cd-text-faint hover:opacity-70 shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </ToastContext.Provider>
  );
}
