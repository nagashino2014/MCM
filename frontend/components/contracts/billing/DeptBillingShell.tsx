"use client";

// 부서 수주·수금 현황(299) — 부서장 전용 한 화면. 2026-10-19 사용자 요청·결정:
//   - 범위 = 수행부서가 본인 부서인 계약만(부서원 참여 타 부서 계약 제외).
//   - 구성 = 상단 요약 4칸(연간 수주·발행·수금 + 현재 미수금) + 기존 현황 표를 수주·미발행·미수금·수금 4탭으로 재사용.
//   - 조작 = 조회와 엑셀 내려받기만(수금 입력·미수 조치·발행 입력 이동은 숨김).
// 관리자(billing.dept.view scope=all)는 부서를 골라 같은 화면을 본다.

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Building2, FileClock, Handshake, Hourglass, Wallet } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdHelp } from "@/components/cdash/CdHelp";
import { OrdersStatusSection } from "./OrdersStatusSection";
import { ReceivablesSection } from "./ReceivablesSection";
import { UnbilledSection } from "./UnbilledSection";
import { CollectionsSection } from "./CollectionsSection";

type Tab = "orders" | "unissued" | "uncollected" | "collections";

const TABS: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "orders", label: "수주 현황", icon: Handshake },
  { id: "unissued", label: "미발행 현황", icon: FileClock },
  { id: "uncollected", label: "미수금 현황", icon: Hourglass },
  { id: "collections", label: "수금 현황", icon: Wallet },
];

interface Kpi {
  count: number;
  amount: number;
}
interface Summary {
  dept: { deptId: string; deptName: string } | null;
  depts: Array<{ deptId: string; deptName: string }>;
  year: string;
  availableYears: string[];
  contractCount: number;
  kpi: { orders: Kpi; issued: Kpi; collected: Kpi; outstanding: Kpi };
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

export function DeptBillingShell() {
  const { theme } = useCdashTheme();
  const [tab, setTab] = useState<Tab>("orders");
  const [deptId, setDeptId] = useState<string>("");
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const p = new URLSearchParams({ year });
    if (deptId) p.set("dept", deptId);
    fetch(`/api/contracts/dept-billing?${p.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((body as { error?: string })?.error ?? `HTTP ${res.status}`);
        return body as Summary;
      })
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        if (!deptId && s.dept) setDeptId(s.dept.deptId);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [deptId, year]);

  const activeDept = summary?.dept ?? null;
  const scopeQuery = activeDept ? `scope=dept&dept=${encodeURIComponent(activeDept.deptId)}` : "";
  const years = Array.from(new Set([String(new Date().getFullYear()), ...(summary?.availableYears ?? [])]))
    .filter((y) => /^\d{4}$/.test(y))
    .sort()
    .reverse();
  const k = summary?.kpi;

  return (
    <div className="cdash min-h-[calc(100vh-136px)] flex flex-col rounded-lg p-4 md:p-5" data-theme={theme}>
      <header className="flex items-center justify-between gap-3 flex-wrap mb-4 reveal">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center justify-center w-10 h-10 rounded-lg"
            style={{ background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }}
          >
            <Building2 className="w-5 h-5" />
          </span>
          <div>
            <p className="text-[11px] font-medium" style={{ color: "var(--cd-primary)" }}>
              Department · Orders · Collections
            </p>
            <h1 className="text-[22px] font-semibold tracking-tight flex items-center gap-2" style={{ color: "var(--cd-text)" }}>
              부서 수주·수금 현황
              {activeDept && (
                <span className="text-sm font-semibold" style={{ color: "var(--cd-faint)" }}>
                  {activeDept.deptName}
                </span>
              )}
              <CdHelp label="부서 수주·수금 현황 도움말">
                수행부서가 이 부서인 계약만 집계합니다(부서원이 참여한 다른 부서 계약은 제외). 수주·발행·수금은 선택 연도 기준,
                미수금은 현재 시점 잔액입니다. 이 화면은 조회와 엑셀 내려받기만 할 수 있고, 수금 입력·미수 조치는 회계 담당이
                처리합니다.
              </CdHelp>
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {summary && summary.depts.length > 1 && (
            <select
              className="cd-select"
              style={{ width: "auto" }}
              value={activeDept?.deptId ?? ""}
              onChange={(e) => setDeptId(e.target.value)}
              aria-label="부서 선택"
            >
              {summary.depts.map((d) => (
                <option key={d.deptId} value={d.deptId}>{d.deptName}</option>
              ))}
            </select>
          )}
          <select className="cd-select" style={{ width: "auto" }} value={year} onChange={(e) => setYear(e.target.value)} aria-label="요약 연도">
            {years.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
        </div>
      </header>

      {error && <div className="cd-error-bg cd-error-text rounded-lg px-4 py-3 text-sm mb-3">{error}</div>}

      {summary && !activeDept ? (
        <div className="cd-text-faint text-sm p-6 text-center">소속 부서가 지정되지 않아 표시할 현황이 없습니다. 인사 담당에게 소속 부서 등록을 요청하세요.</div>
      ) : (
        <>
          {/* 요약 4칸 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {[
              { label: `${year}년 수주`, kpi: k?.orders },
              { label: `${year}년 계산서 발행`, kpi: k?.issued },
              { label: `${year}년 수금`, kpi: k?.collected },
              { label: "현재 미수금", kpi: k?.outstanding },
            ].map(({ label, kpi }) => (
              <div key={label} className="cdb-kpi">
                <span className="cdb-kpi-label">{label}</span>
                <span className="cdb-kpi-value tabular-nums">{kpi ? won(kpi.amount) : "—"}</span>
                <span className="cdb-kpi-sub tabular-nums">{kpi ? `${kpi.count.toLocaleString()}건` : ""}</span>
              </div>
            ))}
          </div>

          <nav className="cdb-tabs" aria-label="부서 수주·수금 현황 서브메뉴">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" className="cdb-tab" data-active={tab === id} onClick={() => setTab(id)}>
                <span className="cdb-tab-icon">
                  <Icon className="w-3.5 h-3.5" />
                </span>
                {label}
              </button>
            ))}
          </nav>

          {/* 부서가 바뀌면 key 로 표를 다시 마운트해 새 범위로 다시 불러온다 */}
          <section className="cdb-panel reveal delay-1 flex-1" key={`${activeDept?.deptId ?? "none"}-${tab}`}>
            {!activeDept ? null : tab === "orders" ? (
              <OrdersStatusSection theme={theme} scopeQuery={scopeQuery} readOnly />
            ) : tab === "unissued" ? (
              <UnbilledSection theme={theme} scopeQuery={scopeQuery} readOnly />
            ) : tab === "uncollected" ? (
              <ReceivablesSection theme={theme} scopeQuery={scopeQuery} readOnly />
            ) : (
              <CollectionsSection theme={theme} scopeQuery={scopeQuery} readOnly />
            )}
          </section>
        </>
      )}
    </div>
  );
}
