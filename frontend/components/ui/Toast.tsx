"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";

type ToastVariant = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const ToastContext = createContext<{
  show: (message: string, variant?: ToastVariant) => void;
}>({ show: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, variant: ToastVariant = "success") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((i) => i.id !== id));
    }, 2400);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed right-6 bottom-6 z-[200] flex flex-col gap-2 items-end pointer-events-none">
        {items.map((item) => (
          <Toast key={item.id} item={item} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item }: { item: ToastItem }) {
  const Icon =
    item.variant === "success" ? CheckCircle2 : item.variant === "error" ? AlertCircle : Info;
  const color =
    item.variant === "success"
      ? "text-primary"
      : item.variant === "error"
      ? "text-red-600"
      : "text-stone-600";
  return (
    <div className="toast glass-panel rounded-xl pointer-events-auto">
      <Icon className={`w-4 h-4 ${color}`} />
      <span>{item.message}</span>
    </div>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
