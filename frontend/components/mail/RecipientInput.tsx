"use client";

// 메일 수신자 입력 + 주소록 자동완성(G6-A) — 임직원·별칭/배포리스트·외부 담당자(/api/directory/suggest).
// 콤마 구분 다중 수신자 텍스트를 유지하면서 마지막 토큰만 질의·치환한다("홍길동 <hong@...>" 형식 삽입).
// CdInput 과 동일한 셸(label/hint/labelExtra)로 MailComposePage 의 받는사람·참조·숨은참조에 공용.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AtSign, Building2, User } from "lucide-react";
import { CdInput } from "@/components/cdash/CdField";
import type { RecipientSuggestion } from "@/lib/directory";

const KIND_ICON: Record<RecipientSuggestion["kind"], typeof User> = {
  employee: User,
  alias: AtSign,
  contact: Building2,
};

export function RecipientInput({
  label,
  required,
  labelExtra,
  hint,
  placeholder,
  value,
  onChange,
}: {
  label: ReactNode;
  required?: boolean;
  labelExtra?: ReactNode;
  hint?: ReactNode;
  placeholder?: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [items, setItems] = useState<RecipientSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 마지막 콤마 뒤 토큰이 질의어.
  const lastToken = value.split(",").pop()?.trim() ?? "";

  useEffect(() => {
    abortRef.current?.abort();
    if (!lastToken) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/directory/suggest?q=${encodeURIComponent(lastToken)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!r.ok) return;
        const d = await r.json();
        const list = Array.isArray(d.suggestions) ? (d.suggestions as RecipientSuggestion[]) : [];
        setItems(list);
        setHover(0);
      } catch {
        // 무시(abort 포함)
      }
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [lastToken]);

  // 외부 클릭 시 닫기.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const pick = (s: RecipientSuggestion) => {
    const parts = value.split(",");
    parts[parts.length - 1] = ` ${s.name} <${s.address}>`;
    onChange(parts.join(",").replace(/^\s+/, "") + ", ");
    setOpen(false);
    setItems([]);
  };

  const showList = open && lastToken.length >= 1 && items.length > 0;

  return (
    <div ref={rootRef} className="relative">
      <CdInput
        label={label}
        required={required}
        labelExtra={labelExtra}
        hint={hint}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHover((h) => Math.min(h + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHover((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            pick(items[hover] ?? items[0]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        autoComplete="off"
      />
      {showList && (
        <div
          className="absolute z-50 top-full mt-1 left-0 right-0 rounded-xl border cd-border-c cd-card-bg overflow-hidden"
          style={{ boxShadow: "var(--cd-shadow)" }}
        >
          {items.map((s, i) => {
            const Icon = KIND_ICON[s.kind];
            return (
              <button
                key={`${s.address}-${i}`}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHover(i)}
                onClick={() => pick(s)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left ${i === hover ? "bg-[color:var(--cd-surface)]" : ""}`}
              >
                <Icon className="w-3.5 h-3.5 cd-text-primary shrink-0" />
                <span className="text-[12.5px] cd-text font-semibold shrink-0">{s.name}</span>
                <span className="text-[11.5px] cd-text-faint truncate">{s.address}</span>
                {s.detail && <span className="ml-auto text-[10.5px] cd-text-faint shrink-0">{s.detail}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
