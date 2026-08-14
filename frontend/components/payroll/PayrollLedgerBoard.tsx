"use client";

import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import type { PayrollEntryRow, PayrollItemDef, PayrollLedgerMonth } from "@/lib/payroll/queries";

/**
 * 급여대장 보드 (PL-P1, 블루프린트 §4-1)
 * - 월별 대장: 플랫 그리드(직원 1행, 열=값 있는 항목만) + KPI + 행 클릭 상세 패널
 * - 직원별 연간: 성명 선택 → 항목×월 피벗
 * 원본 3단 구조의 합계(지급/공제/차인)는 검증 기준값 그대로 표시한다.
 */

const KIND_LABELS: Record<string, string> = { salary: "급여", bonus: "상여", intern: "인턴" };

function fmt(v: number | null | undefined): string {
  if (v == null || v === 0) return "";
  return Math.round(v).toLocaleString();
}

function fmtTotal(v: number): string {
  return Math.round(v).toLocaleString();
}

type AnnualItem = PayrollItemDef & { amounts: Record<number, number>; total: number };

export default function PayrollLedgerBoard() {
  const [view, setView] = useState<"month" | "annual">("month");
  const [ledgers, setLedgers] = useState<PayrollLedgerMonth[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [kind, setKind] = useState<string>("salary");
  const [items, setItems] = useState<PayrollItemDef[]>([]);
  const [entries, setEntries] = useState<PayrollEntryRow[]>([]);
  const [selected, setSelected] = useState<PayrollEntryRow | null>(null);
  const [loading, setLoading] = useState(false);

  // 연간 뷰 상태
  const [names, setNames] = useState<string[]>([]);
  const [annualName, setAnnualName] = useState<string>("");
  const [annualItems, setAnnualItems] = useState<AnnualItem[]>([]);
  const [monthTotals, setMonthTotals] = useState<Record<number, { pay: number; ded: number; net: number }>>({});

  // 대장 목록 1회 로드 → 최신 연·월 기본 선택
  useEffect(() => {
    fetch("/api/payroll/ledgers", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list: PayrollLedgerMonth[] = d.ledgers ?? [];
        setLedgers(list);
        if (list.length) {
          setYear(list[0].payYear);
          setMonth(list[0].payMonth);
          setKind(list[0].ledgerKind);
        }
      })
      .catch(() => setLedgers([]));
  }, []);

  const years = useMemo(
    () => [...new Set(ledgers.map((l) => l.payYear))].sort((a, b) => b - a),
    [ledgers]
  );
  const monthsOfYear = useMemo(
    () => [...new Set(ledgers.filter((l) => l.payYear === year).map((l) => l.payMonth))].sort((a, b) => a - b),
    [ledgers, year]
  );
  const kindsOfMonth = useMemo(
    () => ledgers.filter((l) => l.payYear === year && l.payMonth === month).map((l) => l.ledgerKind),
    [ledgers, year, month]
  );
  const current = useMemo(
    () =>
      ledgers.find((l) => l.payYear === year && l.payMonth === month && l.ledgerKind === kind) ??
      ledgers.find((l) => l.payYear === year && l.payMonth === month) ??
      null,
    [ledgers, year, month, kind]
  );

  // 월/종류 변경 시 유효 종류로 보정
  useEffect(() => {
    if (kindsOfMonth.length && !kindsOfMonth.includes(kind)) setKind(kindsOfMonth[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindsOfMonth]);

  // 대장 상세 로드
  useEffect(() => {
    if (!current) return;
    setLoading(true);
    setSelected(null);
    fetch(`/api/payroll/ledgers?ledgerId=${encodeURIComponent(current.ledgerId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items ?? []);
        setEntries(d.entries ?? []);
      })
      .catch(() => {
        setItems([]);
        setEntries([]);
      })
      .finally(() => setLoading(false));
  }, [current]);

  // 연간 뷰: 성명 목록
  useEffect(() => {
    if (view !== "annual" || !year) return;
    fetch(`/api/payroll/annual?year=${year}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list: string[] = d.names ?? [];
        setNames(list);
        if (list.length && !list.includes(annualName)) setAnnualName(list[0]);
      })
      .catch(() => setNames([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, year]);

  // 연간 뷰: 피벗 로드
  useEffect(() => {
    if (view !== "annual" || !year || !annualName) return;
    setLoading(true);
    fetch(`/api/payroll/annual?year=${year}&name=${encodeURIComponent(annualName)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setAnnualItems(d.items ?? []);
        setMonthTotals(d.monthTotals ?? {});
      })
      .catch(() => {
        setAnnualItems([]);
        setMonthTotals({});
      })
      .finally(() => setLoading(false));
  }, [view, year, annualName]);

  const payItems = items.filter((i) => i.kind === "pay");
  const dedItems = items.filter((i) => i.kind === "deduction");
  const kpi = useMemo(
    () => ({
      pay: entries.reduce((a, e) => a + e.payTotal, 0),
      ded: entries.reduce((a, e) => a + e.deductionTotal, 0),
      net: entries.reduce((a, e) => a + e.netPay, 0),
      count: entries.length,
    }),
    [entries]
  );

  const annualMonths = useMemo(
    () => Object.keys(monthTotals).map(Number).sort((a, b) => a - b),
    [monthTotals]
  );

  return (
    <>
      <CdPageHeader
        title="급여대장"
        meta={current ? `${current.title ?? `${year}년 ${month}월분`} · ${kpi.count}명` : undefined}
        actions={
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <div className="flex rounded-xl border cd-border-c overflow-hidden text-sm font-semibold">
              {(["month", "annual"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 transition ${view === v ? "cd-fill-primary text-white" : "cd-text"}`}
                >
                  {v === "month" ? "월별 대장" : "직원별 연간"}
                </button>
              ))}
            </div>
            <select
              className="cd-select text-sm"
              style={{ width: 92 }}
              value={year ?? ""}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
            {view === "month" && (
              <>
                <select
                  className="cd-select text-sm"
                  style={{ width: 76 }}
                  value={month ?? ""}
                  onChange={(e) => setMonth(Number(e.target.value))}
                >
                  {monthsOfYear.map((m) => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
                {kindsOfMonth.length > 1 && (
                  <select className="cd-select text-sm" style={{ width: 84 }} value={kind} onChange={(e) => setKind(e.target.value)}>
                    {kindsOfMonth.map((k) => (
                      <option key={k} value={k}>{KIND_LABELS[k] ?? k}</option>
                    ))}
                  </select>
                )}
              </>
            )}
            {view === "annual" && (
              <select
                className="cd-select text-sm"
                value={annualName}
                onChange={(e) => setAnnualName(e.target.value)}
                style={{ width: 110 }}
              >
                {names.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            )}
          </div>
        }
      />

      {view === "month" && (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "지급합계", value: kpi.pay, cls: "cd-text" },
              { label: "공제합계", value: kpi.ded, cls: "cd-text" },
              { label: "차인지급액", value: kpi.net, cls: "" },
              { label: "인원", value: kpi.count, cls: "cd-text", suffix: "명" },
            ].map((k) => (
              <section key={k.label} className="cd-card rounded-3xl px-5 py-4 cd-reveal">
                <p className="text-xs font-bold cd-text-faint">{k.label}</p>
                <p
                  className={`text-xl font-extrabold tracking-tight mt-1 ${k.cls}`}
                  style={k.cls ? undefined : { color: "var(--cd-primary)" }}
                >
                  {fmtTotal(k.value)}
                  <span className="text-xs font-bold ml-1 cd-text-faint">{k.suffix ?? "원"}</span>
                </p>
              </section>
            ))}
          </div>

          {/* 그리드 */}
          <section className="cd-card rounded-3xl flex-1 min-h-0 flex flex-col cd-reveal delay-1">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="text-[15px] font-extrabold tracking-tight cd-text">월별 대장</h2>
              {current?.sourceFile && (
                <span className="flex items-center gap-1.5 text-[11px] cd-text-faint" title={current.sourceFile}>
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  {current.sourceFile}
                </span>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
              {loading ? (
                <p className="p-4 text-sm cd-text-faint">불러오는 중…</p>
              ) : (
                <table className="w-full text-sm" style={{ minWidth: 640 + (payItems.length + dedItems.length) * 96 }}>
                  <thead>
                    <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                      <th className="text-left font-semibold p-2.5 sticky left-0 z-10" style={{ background: "var(--cd-card-solid)", boxShadow: "-14px 0 0 var(--cd-card-solid)" }}>성명</th>
                      <th className="text-left font-semibold p-2.5">직급</th>
                      <th className="text-left font-semibold p-2.5">부서</th>
                      {payItems.map((i) => (
                        <th key={i.itemId} className="text-right font-semibold p-2.5 whitespace-nowrap">{i.name}</th>
                      ))}
                      <th className="text-right font-semibold p-2.5 whitespace-nowrap" style={{ color: "var(--cd-primary)" }}>지급합계</th>
                      {dedItems.map((i) => (
                        <th key={i.itemId} className="text-right font-semibold p-2.5 whitespace-nowrap">{i.name}</th>
                      ))}
                      <th className="text-right font-semibold p-2.5 whitespace-nowrap" style={{ color: "var(--cd-warning)" }}>공제합계</th>
                      <th className="text-right font-semibold p-2.5 whitespace-nowrap" style={{ color: "var(--cd-primary)" }}>차인지급액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr
                        key={e.entryId}
                        onClick={() => setSelected(e)}
                        className="border-b cd-border-c last:border-0 cursor-pointer transition hover:bg-[color:var(--cd-surface)]"
                      >
                        <td className="p-2.5 font-semibold cd-text sticky left-0 z-10 whitespace-nowrap" style={{ background: "var(--cd-card-solid)", boxShadow: "-14px 0 0 var(--cd-card-solid)" }}>
                          {e.name}
                          {!e.employeeId && (
                            <span
                              className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                              style={{ color: "var(--cd-warning)", background: "var(--cd-warning-soft)" }}
                            >
                              퇴사
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 cd-text whitespace-nowrap">{e.positionName ?? "-"}</td>
                        <td className="p-2.5 cd-text whitespace-nowrap">{e.deptName ?? "-"}</td>
                        {payItems.map((i) => (
                          <td key={i.itemId} className="p-2.5 text-right cd-text tabular-nums">{fmt(e.lines[i.itemId])}</td>
                        ))}
                        <td className="p-2.5 text-right font-bold tabular-nums" style={{ color: "var(--cd-primary)" }}>{fmtTotal(e.payTotal)}</td>
                        {dedItems.map((i) => (
                          <td key={i.itemId} className="p-2.5 text-right cd-text tabular-nums">{fmt(e.lines[i.itemId])}</td>
                        ))}
                        <td className="p-2.5 text-right font-bold tabular-nums" style={{ color: "var(--cd-warning)" }}>{fmtTotal(e.deductionTotal)}</td>
                        <td className="p-2.5 text-right font-extrabold tabular-nums" style={{ color: "var(--cd-primary)" }}>{fmtTotal(e.netPay)}</td>
                      </tr>
                    ))}
                    {!entries.length && (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-sm cd-text-faint">해당 월 대장이 없습니다.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}

      {view === "annual" && (
        <section className="cd-card rounded-3xl flex-1 min-h-0 flex flex-col cd-reveal">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <h2 className="text-[15px] font-extrabold tracking-tight cd-text">
              {annualName || "-"} · {year}년 연간 추이
            </h2>
          </div>
          <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
            {loading ? (
              <p className="p-4 text-sm cd-text-faint">불러오는 중…</p>
            ) : (
              <table className="w-full text-sm" style={{ minWidth: 320 + annualMonths.length * 92 }}>
                <thead>
                  <tr className="cd-text-faint text-[11px] border-b cd-border-c">
                    <th className="text-left font-semibold p-2.5 sticky left-0 z-10" style={{ background: "var(--cd-card-solid)", boxShadow: "-14px 0 0 var(--cd-card-solid)" }}>항목</th>
                    {annualMonths.map((m) => (
                      <th key={m} className="text-right font-semibold p-2.5">{m}월</th>
                    ))}
                    <th className="text-right font-semibold p-2.5" style={{ color: "var(--cd-primary)" }}>연간 합계</th>
                  </tr>
                </thead>
                <tbody>
                  {(["pay", "deduction"] as const).map((kd) =>
                    annualItems
                      .filter((i) => i.kind === kd)
                      .map((i) => (
                        <tr key={i.itemId} className="border-b cd-border-c last:border-0">
                          <td className="p-2.5 font-semibold cd-text sticky left-0 z-10 whitespace-nowrap" style={{ background: "var(--cd-card-solid)", boxShadow: "-14px 0 0 var(--cd-card-solid)" }}>
                            {i.name}
                            {kd === "deduction" && <span className="ml-1 text-[10px] cd-text-faint">공제</span>}
                          </td>
                          {annualMonths.map((m) => (
                            <td key={m} className="p-2.5 text-right cd-text tabular-nums">{fmt(i.amounts[m])}</td>
                          ))}
                          <td className="p-2.5 text-right font-bold tabular-nums cd-text">{fmtTotal(i.total)}</td>
                        </tr>
                      ))
                  )}
                  {[
                    { label: "지급합계", get: (m: number) => monthTotals[m]?.pay ?? 0, color: "var(--cd-primary)" },
                    { label: "공제합계", get: (m: number) => monthTotals[m]?.ded ?? 0, color: "var(--cd-warning)" },
                    { label: "차인지급액", get: (m: number) => monthTotals[m]?.net ?? 0, color: "var(--cd-primary)" },
                  ].map((row) => (
                    <tr key={row.label} className="border-t-2 cd-border-c">
                      <td className="p-2.5 font-extrabold sticky left-0 z-10 whitespace-nowrap" style={{ color: row.color, background: "var(--cd-card-solid)", boxShadow: "-14px 0 0 var(--cd-card-solid)" }}>
                        {row.label}
                      </td>
                      {annualMonths.map((m) => (
                        <td key={m} className="p-2.5 text-right font-bold tabular-nums" style={{ color: row.color }}>
                          {fmtTotal(row.get(m))}
                        </td>
                      ))}
                      <td className="p-2.5 text-right font-extrabold tabular-nums" style={{ color: row.color }}>
                        {fmtTotal(annualMonths.reduce((a, m) => a + row.get(m), 0))}
                      </td>
                    </tr>
                  ))}
                  {!annualItems.length && (
                    <tr>
                      <td colSpan={2} className="p-6 text-center text-sm cd-text-faint">데이터가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {/* 행 상세 패널 */}
      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={() => setSelected(null)}>
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.28)" }} />
          <aside
            className="cd-solid-bg relative z-10 h-full w-[380px] max-w-[92vw] overflow-y-auto p-5 flex flex-col gap-4"
            style={{ boxShadow: "var(--cd-shadow)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-extrabold cd-text">{selected.name}</h3>
                <p className="text-xs cd-text-faint mt-0.5">
                  {[selected.positionName, selected.deptName].filter(Boolean).join(" · ") || "-"}
                </p>
              </div>
              <button type="button" className="cd-btn rounded-xl p-1.5" onClick={() => setSelected(null)} aria-label="닫기">
                <X className="w-4 h-4" />
              </button>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <dt className="cd-text-faint">사원번호</dt>
              <dd className="cd-text text-right">{selected.empNo ?? "-"}</dd>
              <dt className="cd-text-faint">입사일</dt>
              <dd className="cd-text text-right">{selected.hiredAt ?? "-"}</dd>
              {selected.resignedAt && (
                <>
                  <dt className="cd-text-faint">퇴사일</dt>
                  <dd className="cd-text text-right">{selected.resignedAt}</dd>
                </>
              )}
            </dl>
            {(["pay", "deduction"] as const).map((kd) => {
              const list = (kd === "pay" ? payItems : dedItems).filter((i) => selected.lines[i.itemId]);
              return (
                <div key={kd} className="border cd-border-c rounded-2xl p-3.5">
                  <h4 className="text-xs font-bold cd-text-faint mb-2">{kd === "pay" ? "기본급여 및 제수당" : "공제"}</h4>
                  {list.map((i) => (
                    <div key={i.itemId} className="flex justify-between py-1 text-sm">
                      <span className="cd-text">{i.name}</span>
                      <span className="cd-text font-semibold tabular-nums">{fmtTotal(selected.lines[i.itemId])}원</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-2 mt-1 border-t cd-border-c text-sm font-extrabold">
                    <span className="cd-text">{kd === "pay" ? "지급합계" : "공제합계"}</span>
                    <span className="tabular-nums" style={{ color: kd === "pay" ? "var(--cd-primary)" : "var(--cd-warning)" }}>
                      {fmtTotal(kd === "pay" ? selected.payTotal : selected.deductionTotal)}원
                    </span>
                  </div>
                </div>
              );
            })}
            <div
              className="rounded-2xl p-3.5 flex justify-between items-center text-sm font-extrabold"
              style={{ background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }}
            >
              <span>차인지급액</span>
              <span className="tabular-nums">{fmtTotal(selected.netPay)}원</span>
            </div>
            {selected.note && (
              <p className="text-[11px] leading-relaxed rounded-xl p-3" style={{ color: "var(--cd-warning)", background: "var(--cd-warning-soft)" }}>
                {selected.note}
              </p>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
