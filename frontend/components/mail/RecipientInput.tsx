"use client";

// 메일 수신자 입력 — 확정 수신자는 태그(칩)로, 입력 중인 마지막 토큰만 텍스트로 유지한다.
// 자동완성은 주소록(임직원·별칭/배포리스트·외부 담당자, /api/directory/suggest)에서 찾아
// "이름 직함 <주소>" 형식으로 채운다.
// 값(value)은 기존과 동일한 콤마 구분 문자열이라 드래프트 저장·발송 파이프라인과 호환된다.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AtSign, Building2, User, X } from "lucide-react";
import type { RecipientSuggestion } from "@/lib/directory";

const KIND_ICON: Record<RecipientSuggestion["kind"], typeof User> = {
  employee: User,
  alias: AtSign,
  contact: Building2,
};

/** "이름 직함 <주소>" / "주소" 형태의 한 토큰 — 칩 표시용 파싱 결과. */
interface Token {
  raw: string;
  label: string;
  address: string;
}

function parseToken(raw: string): Token {
  const t = raw.trim();
  const m = t.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { raw: t, label: m[1].trim() || m[2].trim(), address: m[2].trim() };
  return { raw: t, label: t, address: t };
}

/** 확정 토큰(칩) + 입력 중 토큰 분리 — 문자열 끝이 콤마면 전부 확정으로 본다. */
function splitValue(value: string): { tokens: Token[]; draft: string } {
  const parts = value.split(",");
  // 토큰 뒤 구분자(", ")의 공백이 입력창 앞에 남지 않도록 걷어낸다.
  const draft = (parts.pop() ?? "").replace(/^\s+/, "");
  const tokens = parts.map((p) => p.trim()).filter(Boolean).map(parseToken);
  return { tokens, draft };
}

function joinValue(tokens: Token[], draft: string): string {
  const head = tokens.map((t) => t.raw).join(", ");
  if (!head) return draft;
  return draft.trim() ? `${head}, ${draft}` : `${head}, `;
}

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
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { tokens, draft } = splitValue(value);
  const query = draft.trim();

  useEffect(() => {
    abortRef.current?.abort();
    if (!query) {
      setItems([]);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/directory/suggest?q=${encodeURIComponent(query)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!r.ok) return;
        const d = await r.json();
        setItems(Array.isArray(d.suggestions) ? (d.suggestions as RecipientSuggestion[]) : []);
        setHover(0);
      } catch {
        // 무시(abort 포함)
      }
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  // 외부 클릭 시 닫기.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  /** 제안 선택 — 이름 뒤에 직함을 붙여 확정 토큰으로 추가한다. */
  const pick = (s: RecipientSuggestion) => {
    const display = [s.name, s.title].filter(Boolean).join(" ");
    onChange(joinValue([...tokens, parseToken(`${display} <${s.address}>`)], ""));
    setOpen(false);
    setItems([]);
    inputRef.current?.focus();
  };

  /** 입력 중 토큰을 그대로 확정(직접 입력한 주소). */
  const commitDraft = () => {
    if (!query) return;
    onChange(joinValue([...tokens, parseToken(query)], ""));
    setItems([]);
  };

  const removeToken = (index: number) => {
    onChange(joinValue(tokens.filter((_, i) => i !== index), draft));
    inputRef.current?.focus();
  };

  const showList = open && query.length >= 1 && items.length > 0;

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1">
      <span className="cd-label flex items-center justify-between">
        <span>
          {label}
          {required && <span className="cd-error-text ml-0.5">*</span>}
        </span>
        {labelExtra}
      </span>

      {/* 칩 + 입력 — cd-input 과 같은 외형의 컨테이너(클릭 시 입력에 포커스) */}
      <div
        className="cd-input flex flex-wrap items-center gap-1.5 min-h-[2.5rem] h-auto py-1.5 cursor-text"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) inputRef.current?.focus();
        }}
      >
        {tokens.map((t, i) => (
          <span
            key={`${t.raw}-${i}`}
            className="inline-flex items-center gap-1 rounded-full cd-tint-primary pl-2.5 pr-1 py-0.5 text-[12px] max-w-full"
            title={t.raw}
          >
            {/* 동명이인·외부 담당자 식별을 위해 이름(직함)과 메일 주소를 함께 표시한다. */}
            <span className="truncate font-medium">{t.label}</span>
            {t.label !== t.address && <span className="truncate opacity-70">{t.address}</span>}
            <button
              type="button"
              onClick={() => removeToken(i)}
              className="shrink-0 rounded-full p-0.5 hover:opacity-60"
              aria-label={`${t.label} 제거`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="flex-1 min-w-[12rem] bg-transparent border-0 outline-none text-sm p-0"
          value={draft}
          placeholder={tokens.length === 0 ? placeholder : ""}
          autoComplete="off"
          onChange={(e) => {
            onChange(joinValue(tokens, e.target.value));
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (showList) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHover((h) => Math.min(h + 1, items.length - 1));
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setHover((h) => Math.max(h - 1, 0));
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                pick(items[hover] ?? items[0]);
                return;
              }
              if (e.key === "Escape") {
                e.stopPropagation();
                setOpen(false);
                return;
              }
            }
            // 콤마·Enter 로 직접 입력 확정, 빈 입력에서 Backspace 는 마지막 칩 삭제.
            if ((e.key === "Enter" || e.key === ",") && query) {
              e.preventDefault();
              commitDraft();
            } else if (e.key === "Backspace" && !draft && tokens.length) {
              e.preventDefault();
              removeToken(tokens.length - 1);
            }
          }}
        />
      </div>
      {hint && <span className="text-xs cd-text-faint">{hint}</span>}

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
                <span className="text-[12.5px] cd-text font-semibold shrink-0">
                  {s.name}
                  {s.title && <span className="ml-1 font-normal cd-text-muted">{s.title}</span>}
                </span>
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
