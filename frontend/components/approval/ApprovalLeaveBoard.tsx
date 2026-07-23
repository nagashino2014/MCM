"use client";

// 직원별 휴가 관리(/approval/leave, admin) — 연차 + 연차 외 모든 휴가를 날짜별 이력으로 관리.
// 사용 이력은 휴가신청 승인 시 자동 적재(그룹웨어)되거나 엑셀 임포트/수기로 입력한다.
// 이력은 연차/비연차(3:2)로 나누고 월 태그(6열/4열)로 접어, 월 클릭 시 일별 내역(3열/2열)을 편다.
// 연차 발생 기준(회계연도/입사일) 전환. KPI·인원 리스트는 modernize(cdash) 스타일.
// 설계: docs/leave-management-blueprint.md §3·§4.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BellRing,
  CalendarCheck2,
  CalendarPlus,
  Gauge,
  HeartHandshake,
  Plus,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { EmployeeAvatar } from "@/components/ui/EmployeeAvatar";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { LeaveCharts } from "@/components/approval/LeaveCharts";
import type { CdTheme } from "@/components/contracts/dashboard/types";
import type { LeaveTypeItem } from "@/lib/approval/leave-types";
import type { AccrualBasis } from "@/lib/approval/leave-accrual";
import "@/components/cdash/cdash.css";

interface SummaryRow {
  employeeId: string;
  name: string;
  deptName: string | null;
  positionName: string | null;
  hiredAt: string | null;
  photoPath: string | null;
  granted: number;
  usedAnnual: number;
  remaining: number;
  otherUsed: number;
  accrual: number | null;
}

interface EntryRow {
  entryId: string;
  entryType: string; // grant|use|adjust
  days: number;
  usedOn: string | null;
  leaveTypeKey: string | null;
  leaveLabel: string | null;
  deduct: "full" | "half" | null;
  source: "groupware" | "excel" | "manual";
  note: string | null;
}

const ENTRY_LABEL: Record<string, string> = { grant: "부여", use: "사용", adjust: "조정" };
const SOURCE_LABEL: Record<string, string> = { groupware: "그룹웨어", excel: "엑셀", manual: "수기" };
const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function ApprovalLeaveBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [basis, setBasis] = useState<AccrualBasis>("jan1");
  const [catalog, setCatalog] = useState<LeaveTypeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, EntryRow[]>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, cat] = await Promise.all([
        fetch(`/api/approval/leave?year=${year}`, { cache: "no-store" }),
        fetch("/api/approval/leave-types", { cache: "no-store" }),
      ]);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "휴가 현황을 불러오지 못했습니다.");
      setRows(data.rows ?? []);
      if (data.settings?.accrualBasis) setBasis(data.settings.accrualBasis);
      if (cat.ok) {
        const cd = await cat.json();
        setCatalog(cd.types ?? []);
      }
      setEntries({});
      setExpanded(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [year]);
  useEffect(() => {
    load();
  }, [load]);

  const loadEntries = useCallback(
    async (employeeId: string) => {
      const res = await fetch(`/api/approval/leave?year=${year}&employeeId=${encodeURIComponent(employeeId)}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setEntries((prev) => ({ ...prev, [employeeId]: data.entries ?? [] }));
    },
    [year]
  );

  const toggleExpand = async (employeeId: string) => {
    if (expanded === employeeId) {
      setExpanded(null);
      return;
    }
    setExpanded(employeeId);
    if (!entries[employeeId]) await loadEntries(employeeId);
  };

  const post = async (payload: unknown): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch("/api/approval/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      return true;
    } catch (err) {
      alert((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const changeBasis = async (next: AccrualBasis) => {
    setBasis(next);
    if (await post({ accrualBasis: next })) await load();
  };

  const refreshRow = async (employeeId: string) => {
    await loadEntries(employeeId);
    await load();
    setExpanded(employeeId);
  };

  const kpi = useMemo(() => {
    if (!rows.length) return null;
    const n = rows.length;
    const sum = rows.reduce((a, r) => ({ g: a.g + r.granted, u: a.u + r.usedAnnual, o: a.o + r.otherUsed }), { g: 0, u: 0, o: 0 });
    return { granted: sum.g / n, used: sum.u / n, rate: sum.g > 0 ? (sum.u / sum.g) * 100 : 0, other: sum.o / n };
  }, [rows]);

  const KPIS: { label: string; value: string; hint: string; icon: LucideIcon; primary?: boolean }[] = kpi
    ? [
        { label: "평균 연차 부여", value: `${kpi.granted.toFixed(1)}`, hint: "재직자 1인 평균 · 일", icon: CalendarPlus, primary: true },
        { label: "평균 연차 사용", value: `${kpi.used.toFixed(1)}`, hint: "연차·반차 차감 평균 · 일", icon: CalendarCheck2 },
        { label: "평균 연차 소진율", value: `${kpi.rate.toFixed(0)}%`, hint: "사용 ÷ 부여", icon: Gauge },
        { label: "평균 연차 외 휴가", value: `${kpi.other.toFixed(1)}`, hint: "경조·공가·병가 평균 · 일", icon: HeartHandshake },
      ]
    : [];

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<CalendarCheck2 className="w-5 h-5" />}
        eyebrow="Approval · Leave"
        title="직원별 휴가 관리"
        subtitle="연차와 연차 외 휴가(경조·공가·병가)를 날짜별 이력으로 관리합니다. 사용은 휴가신청 승인 시 자동 반영되며 직접 보정할 수 있습니다."
        actions={
          <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5" onClick={() => router.push("/approval/leave-promotion")}>
            <BellRing className="w-3.5 h-3.5" /> 연차촉진제 관리
          </button>
        }
      />
      {error && <p className="text-sm text-[color:var(--cd-danger,#FA896B)]">{error}</p>}

      {/* KPI (modernize) */}
      {KPIS.length > 0 && (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {KPIS.map((k) => {
            const Icon = k.icon;
            return (
              <div key={k.label} className={`rounded-2xl p-4 border cd-border-c transition-shadow ${k.primary ? "cd-tint-primary shadow-sm" : "cd-card-bg"}`}>
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 shrink-0 ${k.primary ? "cd-text-primary" : "cd-text-faint"}`} />
                  <div className="text-[10px] font-bold uppercase tracking-wider cd-text-faint truncate">{k.label}</div>
                </div>
                <div className={`mt-2 text-3xl font-extrabold leading-tight ${k.primary ? "cd-text" : "cd-text"}`}>{k.value}</div>
                <div className="text-[10px] cd-text-faint font-medium mt-1 truncate">{k.hint}</div>
              </div>
            );
          })}
        </section>
      )}

      {/* 인포그래픽 (LM-P4) */}
      {!loading && rows.length > 0 && <LeaveCharts year={year} theme={theme as CdTheme} />}

      <div className="cd-card rounded-3xl p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <select className="cd-select" style={{ width: 110 }} value={year} onChange={(e) => setYear(e.target.value)}>
            {Array.from({ length: 4 }, (_, i) => String(thisYear + 1 - i)).map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-1.5 text-[11.5px] cd-text-faint">
            연차 발생 기준
            <select className="cd-select" style={{ width: 150 }} value={basis} onChange={(e) => changeBasis(e.target.value as AccrualBasis)}>
              <option value="jan1">회계연도(매년 1/1)</option>
              <option value="hire_date">입사일 기준</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {/* 헤더 */}
            <div className="hidden md:grid grid-cols-[1.6fr_1fr_repeat(5,0.7fr)] gap-2 px-3 text-[10.5px] font-bold uppercase tracking-wider cd-text-faint">
              <span>직원</span>
              <span>부서</span>
              <span className="text-right">부여</span>
              <span className="text-right">사용</span>
              <span className="text-right">잔여</span>
              <span className="text-right">규정 발생</span>
              <span className="text-right">연차 외</span>
            </div>
            {rows.map((r) => (
              <RowBlock
                key={r.employeeId}
                row={r}
                expanded={expanded === r.employeeId}
                entries={entries[r.employeeId]}
                catalog={catalog}
                busy={busy}
                theme={theme}
                onToggle={() => toggleExpand(r.employeeId)}
                onChanged={() => refreshRow(r.employeeId)}
                post={post}
                year={year}
              />
            ))}
          </div>
        )}
        <p className="text-[10.5px] cd-text-faint">
          직원 행을 클릭하면 날짜별 이력이 연차·연차 외로 나뉘어 월별로 펼쳐집니다. 월 태그를 누르면 일별 내역이 표시되고, 직접 추가·수정·삭제할 수 있습니다(초기값 보정).
          &apos;규정 발생&apos;은 근로기준법 기준 자동 계산값(참고)입니다.
        </p>
      </div>

    </div>
  );
}

/* ---------- 인원 행(카드) + 펼침 ---------- */
function RowBlock({
  row: r,
  expanded,
  entries,
  catalog,
  busy,
  theme,
  onToggle,
  onChanged,
  post,
  year,
}: {
  row: SummaryRow;
  expanded: boolean;
  entries?: EntryRow[];
  catalog: LeaveTypeItem[];
  busy: boolean;
  theme: string;
  onToggle: () => void;
  onChanged: () => void;
  post: (payload: unknown) => Promise<boolean>;
  year: string;
}) {
  const rate = r.granted > 0 ? Math.min(100, (r.usedAnnual / r.granted) * 100) : 0;
  return (
    <div className={`rounded-2xl border cd-border-c overflow-hidden ${expanded ? "cd-card-bg" : ""}`}>
      {/* 행 헤더 */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full grid grid-cols-[1.6fr_1fr_repeat(5,0.7fr)] gap-2 items-center px-3 py-2.5 text-left hover:bg-[color:var(--cd-surface)] transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <EmployeeAvatar employeeId={r.employeeId} photoPath={r.photoPath} size={34} />
          <div className="min-w-0">
            <div className="text-[13px] font-bold cd-text truncate">
              {r.name}
              {r.positionName && <span className="cd-text-faint font-normal text-[11px]"> {r.positionName}</span>}
            </div>
            {/* 소진율 미니바 */}
            <div className="mt-1 h-1.5 rounded-full cd-surface-bg overflow-hidden w-28">
              <div className="h-full rounded-full" style={{ width: `${rate}%`, background: rate >= 90 ? "var(--cd-danger,#FA896B)" : "var(--cd-primary)" }} />
            </div>
          </div>
        </div>
        <span className="text-[12px] cd-text-faint truncate">{r.deptName ?? "-"}</span>
        <span className="text-right font-mono text-[13px] cd-text">{fmtDays(r.granted)}</span>
        <span className="text-right font-mono text-[13px] cd-text">{fmtDays(r.usedAnnual)}</span>
        <span className={`text-right font-mono text-[13px] font-bold ${r.remaining < 0 ? "text-[color:var(--cd-danger,#FA896B)]" : "cd-text-primary"}`}>{fmtDays(r.remaining)}</span>
        <span className="text-right font-mono text-[12px] cd-text-faint">{r.accrual != null ? fmtDays(r.accrual) : "-"}</span>
        <span className="text-right font-mono text-[12px] cd-text-faint">{r.otherUsed > 0 ? fmtDays(r.otherUsed) : "-"}</span>
      </button>

      {expanded && (
        <div className="border-t cd-border-c p-3 flex flex-col gap-3">
          <UsageHistory row={r} entries={entries} catalog={catalog} busy={busy} onChanged={onChanged} post={post} />
          <GrantAdjust row={r} entries={entries} busy={busy} onChanged={onChanged} post={post} year={year} />
        </div>
      )}
    </div>
  );
}

/* ---------- 날짜별 이력(연차 3 : 비연차 2, 월 태그) ---------- */
function UsageHistory({
  row: r,
  entries,
  catalog,
  busy,
  onChanged,
  post,
}: {
  row: SummaryRow;
  entries?: EntryRow[];
  catalog: LeaveTypeItem[];
  busy: boolean;
  onChanged: () => void;
  post: (payload: unknown) => Promise<boolean>;
}) {
  const usage = (entries ?? []).filter((e) => e.entryType === "use");
  const annual = usage.filter((e) => e.deduct);
  const other = usage.filter((e) => !e.deduct);

  const [addForm, setAddForm] = useState<{ usedOn: string; typeKey: string; days: string; note: string }>({ usedOn: "", typeKey: "annual", days: "1", note: "" });

  const addUsage = async () => {
    if (!addForm.usedOn || !addForm.typeKey || !(Number(addForm.days) > 0)) {
      alert("사용일·종류·일수를 입력하세요.");
      return;
    }
    if (await post({ usage: { employeeId: r.employeeId, usedOn: addForm.usedOn, leaveTypeKey: addForm.typeKey, days: Number(addForm.days), note: addForm.note || null } })) {
      setAddForm({ usedOn: "", typeKey: addForm.typeKey, days: "1", note: "" });
      onChanged();
    }
  };
  const del = async (entryId: string) => {
    if (!confirm("이 이력을 삭제할까요?")) return;
    if (await post({ deleteEntryId: entryId })) onChanged();
  };
  const updDays = async (e: EntryRow, days: number) => {
    if (!(days > 0) || !e.usedOn || !e.leaveTypeKey || days === e.days) return;
    if (await post({ usage: { entryId: e.entryId, employeeId: r.employeeId, usedOn: e.usedOn, leaveTypeKey: e.leaveTypeKey, days, note: e.note } })) onChanged();
  };

  return (
    <div className="rounded-xl border cd-border-c p-3">
      <div className="text-[11px] font-bold cd-text-faint mb-2.5">날짜별 휴가 사용 이력</div>
      {!entries ? (
        <p className="text-[11.5px] cd-text-faint">불러오는 중입니다.</p>
      ) : (
        <div className="flex flex-col md:flex-row gap-4">
          {/* 연차(3) */}
          <div className="md:flex-[3] min-w-0">
            <MonthGrouped title="연차 · 반차" cols={6} detailCols={3} entries={annual} onDelete={del} onUpdateDays={updDays} />
          </div>
          {/* 비연차(2) */}
          <div className="md:flex-[2] min-w-0 md:border-l cd-border-c md:pl-4">
            <MonthGrouped title="연차 외 휴가" cols={4} detailCols={2} entries={other} onDelete={del} onUpdateDays={updDays} />
          </div>
        </div>
      )}
      {/* 사용 이력 추가 */}
      <div className="flex items-center gap-1.5 flex-wrap mt-3 pt-3 border-t cd-border-c">
        <AutoDateInput className="cd-input" style={{ width: 120 }} value={addForm.usedOn} onChange={(usedOn) => setAddForm({ ...addForm, usedOn })} />
        <select
          className="cd-select"
          style={{ width: 150 }}
          value={addForm.typeKey}
          onChange={(e) => {
            const c = catalog.find((x) => x.key === e.target.value);
            setAddForm({ ...addForm, typeKey: e.target.value, days: c?.deduct === "half" ? "0.5" : c?.days != null ? String(c.days) : addForm.days });
          }}
        >
          {catalog.filter((c) => c.active).map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <input className="cd-input text-right" style={{ width: 56 }} inputMode="decimal" value={addForm.days} onChange={(e) => setAddForm({ ...addForm, days: e.target.value })} />
        <span className="cd-text-faint text-[11px]">일</span>
        <input className="cd-input" style={{ width: 140 }} placeholder="비고(선택)" value={addForm.note} onChange={(e) => setAddForm({ ...addForm, note: e.target.value })} />
        <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy} onClick={addUsage}>
          <Plus className="w-3.5 h-3.5 inline" /> 사용 추가
        </button>
      </div>
    </div>
  );
}

/** 월별 그룹 — 월 태그(cols 열) + 선택 월 일별 내역(detailCols 열) */
function MonthGrouped({
  title,
  cols,
  detailCols,
  entries,
  onDelete,
  onUpdateDays,
}: {
  title: string;
  cols: number;
  detailCols: number;
  entries: EntryRow[];
  onDelete: (entryId: string) => void;
  onUpdateDays: (e: EntryRow, days: number) => void;
}) {
  const months = useMemo(() => {
    const m = new Map<string, EntryRow[]>();
    for (const e of entries) {
      if (!e.usedOn) continue;
      const key = e.usedOn.slice(0, 7);
      m.set(key, [...(m.get(key) ?? []), e]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);
  const [sel, setSel] = useState<string | null>(null);
  const total = entries.reduce((a, e) => a + e.days, 0);
  const detail = sel ? months.find((m) => m[0] === sel)?.[1] ?? [] : [];

  const gridCols = (n: number) => ({ display: "grid", gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: "6px" });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="font-bold cd-text">{title}</span>
        <span className="cd-text-faint">{fmtDays(total)}일</span>
      </div>
      {months.length === 0 ? (
        <p className="text-[11.5px] cd-text-faint py-2">이력이 없습니다.</p>
      ) : (
        <>
          <div style={gridCols(cols)}>
            {months.map(([m, list]) => {
              const days = list.reduce((a, e) => a + e.days, 0);
              const active = sel === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSel(active ? null : m)}
                  className={`rounded-lg border px-1.5 py-1 text-[10.5px] font-mono flex flex-col items-center ${active ? "cd-fill-primary border-transparent text-white" : "cd-border-c cd-text hover:cd-tint-primary"}`}
                  title={`${m} · ${fmtDays(days)}일`}
                >
                  <span>{m}</span>
                  <span className={active ? "text-white/80" : "cd-text-faint"}>{fmtDays(days)}일</span>
                </button>
              );
            })}
          </div>
          {sel && detail.length > 0 && (
            <div className="mt-1" style={gridCols(detailCols)}>
              {detail.map((e) => (
                <div key={e.entryId} className="rounded-lg border cd-border-c p-2 flex flex-col gap-1 cd-card-bg">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[11px] cd-text">{e.usedOn?.slice(5) ?? ""}</span>
                    <span className={`text-[9.5px] rounded-full px-1.5 py-0.5 shrink-0 ${e.deduct ? "cd-tint-primary" : "border cd-border-c cd-text-faint"}`}>{e.leaveLabel ?? e.leaveTypeKey}</span>
                    <button type="button" className="ml-auto cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" title="삭제" onClick={() => onDelete(e.entryId)}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1 text-[10.5px]">
                    <input
                      className="cd-input text-right"
                      style={{ width: 44, padding: "2px 4px" }}
                      defaultValue={fmtDays(e.days)}
                      onBlur={(ev) => {
                        const v = Number(ev.target.value);
                        if (v > 0) onUpdateDays(e, v);
                      }}
                    />
                    <span className="cd-text-faint">일</span>
                    <span className="ml-auto text-[9.5px] cd-text-faint">({SOURCE_LABEL[e.source]})</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- 부여·조정 ---------- */
function GrantAdjust({
  row: r,
  entries,
  busy,
  onChanged,
  post,
  year,
}: {
  row: SummaryRow;
  entries?: EntryRow[];
  busy: boolean;
  onChanged: () => void;
  post: (payload: unknown) => Promise<boolean>;
  year: string;
}) {
  const other = (entries ?? []).filter((e) => e.entryType !== "use");
  const [form, setForm] = useState<{ type: "grant" | "adjust"; days: string; note: string }>({ type: "grant", days: "", note: "" });
  const add = async () => {
    const days = Number(form.days);
    if (!isFinite(days) || days === 0) {
      alert("일수를 입력하세요.");
      return;
    }
    if (await post({ entries: [{ employeeId: r.employeeId, year, entryType: form.type, days, note: form.note || null }] })) {
      setForm({ type: form.type, days: "", note: "" });
      onChanged();
    }
  };
  const del = async (entryId: string) => {
    if (!confirm("이 엔트리를 삭제할까요?")) return;
    if (await post({ deleteEntryId: entryId })) onChanged();
  };
  return (
    <div className="rounded-xl border cd-border-c p-3">
      <div className="text-[11px] font-bold cd-text-faint mb-2">부여 · 조정</div>
      {other.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {other.map((e) => (
            <span key={e.entryId} className="inline-flex items-center gap-1.5 rounded-lg border cd-border-c px-2 py-1 text-[11px]">
              <span className="cd-text-faint">{ENTRY_LABEL[e.entryType] ?? e.entryType}</span>
              <span className="font-mono cd-text">{fmtDays(e.days)}일</span>
              {e.note && <span className="cd-text-faint truncate max-w-[160px]">{e.note}</span>}
              <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" title="삭제" onClick={() => del(e.entryId)}>
                <Trash2 className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        <select className="cd-select" style={{ width: 90 }} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "grant" | "adjust" })}>
          <option value="grant">부여</option>
          <option value="adjust">조정(±)</option>
        </select>
        <input className="cd-input text-right" style={{ width: 64 }} inputMode="decimal" placeholder="일수" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} />
        <input className="cd-input" style={{ width: 170 }} placeholder="메모(선택)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy} onClick={add}>
          <Plus className="w-3.5 h-3.5 inline" /> 추가
        </button>
      </div>
    </div>
  );
}
