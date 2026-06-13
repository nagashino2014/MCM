"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  FileClock,
  Handshake,
  Hourglass,
  Moon,
  ReceiptText,
  Sun,
  Wallet,
} from "lucide-react";
import type { CdTheme } from "@/components/contracts/dashboard/types";
import { OrdersStatusSection } from "./OrdersStatusSection";
import { ReceivablesSection } from "./ReceivablesSection";
import { UnbilledSection } from "./UnbilledSection";
import { CollectionsSection } from "./CollectionsSection";
import { CompletionsSection } from "./CompletionsSection";

const THEME_STORAGE_KEY = "cdash-theme";

type BillingTab = "orders" | "uncollected" | "unissued" | "collections" | "completed";

const TABS: Array<{ id: BillingTab; label: string; icon: LucideIcon }> = [
  { id: "orders", label: "수주 현황", icon: Handshake },
  { id: "uncollected", label: "미수금 현황", icon: Hourglass },
  { id: "unissued", label: "미발행 현황", icon: FileClock },
  { id: "collections", label: "수금 현황", icon: Wallet },
  { id: "completed", label: "완료 현황", icon: BadgeCheck },
];

const TAB_IDS: BillingTab[] = ["orders", "uncollected", "unissued", "collections", "completed"];

export function BillingShell() {
  const searchParams = useSearchParams();
  const [theme, setTheme] = useState<CdTheme>("dark");
  // 계약 상세의 "돌아가기" 등 외부 진입 시 ?tab= 으로 초기 탭을 지정할 수 있다.
  const [tab, setTab] = useState<BillingTab>(() => {
    const fromQuery = searchParams.get("tab") as BillingTab | null;
    return fromQuery && TAB_IDS.includes(fromQuery) ? fromQuery : "orders";
  });

  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  };

  const activeMeta = TABS.find((t) => t.id === tab)!;

  return (
    // 100vh - (본문 상단 오프셋 128px + 페이지 상단 패딩 8px) = 좌측 메뉴 바 하단과 동일 높이
    <div
      className="cdash min-h-[calc(100vh-136px)] flex flex-col rounded-3xl p-4 md:p-5"
      data-theme={theme}
    >
      {/* 헤더 */}
      <header className="flex items-center justify-between gap-3 flex-wrap mb-4 reveal">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center justify-center w-10 h-10 rounded-xl"
            style={{ background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }}
          >
            <ReceiptText className="w-5 h-5" />
          </span>
          <div>
            <p
              className="text-[10px] font-extrabold tracking-[0.22em] uppercase"
              style={{ color: "var(--cd-primary)" }}
            >
              Orders · Collections · Invoicing
            </p>
            <h1 className="text-xl font-extrabold tracking-tight" style={{ color: "var(--cd-text)" }}>
              수주/수금/발행 현황
              <span className="ml-2 text-sm font-bold" style={{ color: "var(--cd-faint)" }}>
                {activeMeta.label}
              </span>
            </h1>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="cd-chip inline-flex items-center gap-1.5"
          aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
        >
          {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          {theme === "dark" ? "라이트" : "다크"}
        </button>
      </header>

      {/* 연결형 서브메뉴 탭 바 */}
      <nav className="cdb-tabs" aria-label="수주/수금/발행 현황 서브메뉴">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className="cdb-tab"
            data-active={tab === id}
            onClick={() => setTab(id)}
          >
            <span className="cdb-tab-icon">
              <Icon className="w-3.5 h-3.5" />
            </span>
            {label}
          </button>
        ))}
      </nav>

      {/* 탭과 이어진 콘텐츠 패널 — 좌측 메뉴 바 하단까지 채운다 */}
      <section className="cdb-panel reveal delay-1 flex-1">
        {tab === "orders" ? (
          <OrdersStatusSection theme={theme} />
        ) : tab === "uncollected" ? (
          <ReceivablesSection theme={theme} />
        ) : tab === "unissued" ? (
          <UnbilledSection theme={theme} />
        ) : tab === "collections" ? (
          <CollectionsSection theme={theme} />
        ) : (
          <CompletionsSection theme={theme} />
        )}
      </section>
    </div>
  );
}
