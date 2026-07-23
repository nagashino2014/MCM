"use client";

// 근태·초과근무 관리(/approval/attendance, admin) — ADT캡스 근태 수신분의 주별 초과근무 리포트.
// 탭: ①주별 초과근무(주 선택·직원별 연장/야간/12h초과, 행 펼침→일별) ②미매칭 매핑(ADT 사번↔직원) ③산정 정책.
// 사규: 주 52h(일요일 시작)·야간 22:00~06:00 2.0배·그외 연장 1.5배·주 12h 초과분은 특별휴가 대상(리포트).
// 설계: docs/ADT_attendance_integration_handoff.md §7-1.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmClockCheck,
  CalendarClock,
  Link2,
  Moon,
  Save,
  TriangleAlert,
  UserRoundCheck,
} from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import { EmployeeAvatar } from "@/components/ui/EmployeeAvatar";
import type { AttendanceSettings } from "@/lib/adt/types";
import type { DailyRow, MappableEmployee, UnmatchedRow, WeeklyRow } from "@/lib/adt/queries";
import "@/components/cdash/cdash.css";

/* ---------- 표시 헬퍼 ---------- */
const hm = (min: number | null | undefined): string => {
  const m = Math.max(0, Math.round(Number(min ?? 0)));
  if (m === 0) return "0";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? (r > 0 ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
};
const toH = (min: number): string => (min / 60).toFixed(1);
const clock = (iso: string | null): string => {
  if (!iso) return "-";
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : "-";
};
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const dowOf = (d: string): string => {
  const t = Date.parse(`${d}T12:00:00Z`);
  return Number.isNaN(t) ? "" : DOW[new Date(t).getUTCDay()];
};

type Tab = "weekly" | "mapping" | "settings";

export function AttendanceBoard() {
  const { theme, toggleTheme } = useCdashTheme();
  const [tab, setTab] = useState<Tab>("weekly");
  const [unmatchedCount, setUnmatchedCount] = useState<number | null>(null);

  return (
    <div className="cdash cd-fields-white min-h-screen" data-theme={theme}>
      <div className="max-w-6xl mx-auto px-4 py-6">
        <CdPageHeader
          icon={<CalendarClock className="w-5 h-5" />}
          eyebrow="ATTENDANCE"
          title="근태 · 초과근무 관리"
          subtitle="ADT캡스 근태 수신분을 주 단위(일요일 시작)로 집계합니다. 야간 22:00~06:00 2.0배·그 외 연장 1.5배, 주 12시간 초과분은 특별휴가 보상 대상입니다."
          actions={<CdThemeToggle theme={theme} onToggle={toggleTheme} />}
        />

        {/* 탭 */}
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          {([
            ["weekly", "주별 초과근무"],
            ["mapping", "미매칭 매핑"],
            ["settings", "산정 정책"],
          ] as [Tab, string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold border transition-colors ${
                tab === k ? "cd-fill-primary border-transparent text-white" : "cd-border-c cd-text hover:cd-tint-primary"
              }`}
            >
              {label}
              {k === "mapping" && unmatchedCount != null && unmatchedCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold" style={{ background: "var(--cd-danger,#FA896B)", color: "#fff" }}>
                  {unmatchedCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "weekly" && <WeeklyPanel />}
        {tab === "mapping" && <MappingPanel onCount={setUnmatchedCount} />}
        {tab === "settings" && <SettingsPanel />}
      </div>
    </div>
  );
}

/* ================= 주별 초과근무 ================= */
function WeeklyPanel() {
  const [weeks, setWeeks] = useState<string[]>([]);
  const [weekStart, setWeekStart] = useState<string>("");
  const [rows, setRows] = useState<WeeklyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [daily, setDaily] = useState<Record<string, DailyRow[]>>({});

  const load = useCallback(async (ws?: string) => {
    setLoading(true);
    setError(null);
    try {
      const q = ws ? `?weekStart=${ws}` : "";
      const res = await fetch(`/api/approval/attendance${q}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "근태 현황을 불러오지 못했습니다.");
      setWeeks(data.weeks ?? []);
      setWeekStart(data.weekStart ?? "");
      setRows(data.rows ?? []);
      setExpanded(null);
      setDaily({});
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (adtEmpNo: string) => {
    if (expanded === adtEmpNo) {
      setExpanded(null);
      return;
    }
    setExpanded(adtEmpNo);
    if (!daily[adtEmpNo]) {
      const res = await fetch(`/api/approval/attendance?weekStart=${weekStart}&adtEmpNo=${encodeURIComponent(adtEmpNo)}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDaily((p) => ({ ...p, [adtEmpNo]: data.daily ?? [] }));
    }
  };

  const kpi = useMemo(() => {
    const totalOt = rows.reduce((a, r) => a + r.overtimeMinutes, 0);
    const totalNight = rows.reduce((a, r) => a + r.overtimeNightMinutes, 0);
    const overLimit = rows.filter((r) => r.overLimit).length;
    return { totalOt, totalNight, overLimit, people: rows.length };
  }, [rows]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] cd-text-faint">주 선택</span>
        <select className="cd-select" style={{ width: 220 }} value={weekStart} onChange={(e) => { setWeekStart(e.target.value); load(e.target.value); }}>
          {weeks.length === 0 && <option value="">데이터 없음</option>}
          {weeks.map((w) => (
            <option key={w} value={w}>{w} (일) ~ {addDays(w, 6)} (토)</option>
          ))}
        </select>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<AlarmClockCheck className="w-4 h-4" />} label="주 인정연장 합" value={`${toH(kpi.totalOt)}h`} />
        <Kpi icon={<Moon className="w-4 h-4" />} label="야간(2.0배) 합" value={`${toH(kpi.totalNight)}h`} />
        <Kpi icon={<TriangleAlert className="w-4 h-4" />} label="12h 초과 인원" value={`${kpi.overLimit}명`} danger={kpi.overLimit > 0} />
        <Kpi icon={<UserRoundCheck className="w-4 h-4" />} label="대상 인원" value={`${kpi.people}명`} />
      </div>

      {error && <p className="text-[13px]" style={{ color: "var(--cd-danger,#FA896B)" }}>{error}</p>}
      {loading ? (
        <p className="text-[13px] cd-text-faint">불러오는 중입니다.</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] cd-text-faint py-4">해당 주의 근태 데이터가 없습니다. 컨트롤러 전송·인제스트 배치를 확인하세요.</p>
      ) : (
        <div className="rounded-2xl border cd-border-c overflow-hidden">
          {/* 헤더 */}
          <div className="hidden md:grid px-3 py-2 text-[11px] font-bold cd-text-faint border-b cd-border-c" style={gridCols}>
            <span>직원</span>
            <span className="text-center">근무일</span>
            <span className="text-right">실근무</span>
            <span className="text-right">연장(1.5배)</span>
            <span className="text-right">야간(2.0배)</span>
            <span className="text-right">12h 초과</span>
            <span className="text-center">상태</span>
          </div>
          {rows.map((r) => (
            <div key={r.adtEmpNo} className="border-b cd-border-c last:border-b-0">
              <button type="button" onClick={() => toggle(r.adtEmpNo)} className="w-full grid items-center px-3 py-2.5 text-left hover:cd-tint-primary transition-colors" style={gridCols}>
                <span className="flex items-center gap-2 min-w-0">
                  <EmployeeAvatar employeeId={r.employeeId} photoPath={r.photoPath} size={30} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold cd-text truncate">{r.name ?? <span className="cd-text-faint">미매칭 · {r.adtEmpNo}</span>}</span>
                    <span className="block text-[11px] cd-text-faint truncate">{r.deptName ?? "-"}{r.positionName ? ` · ${r.positionName}` : ""}</span>
                  </span>
                </span>
                <span className="text-center font-mono text-[12px] cd-text-faint">{r.daysWorked}일</span>
                <span className="text-right font-mono text-[13px] cd-text">{hm(r.workedMinutes)}</span>
                <span className="text-right font-mono text-[13px] cd-text-primary font-semibold">{hm(r.overtimeDayMinutes)}</span>
                <span className="text-right font-mono text-[13px] font-semibold" style={{ color: r.overtimeNightMinutes > 0 ? "var(--cd-primary)" : "var(--cd-faint)" }}>{hm(r.overtimeNightMinutes)}</span>
                <span className="text-right font-mono text-[13px] font-bold" style={{ color: r.excessMinutes > 0 ? "var(--cd-danger,#FA896B)" : "var(--cd-faint)" }}>{r.excessMinutes > 0 ? hm(r.excessMinutes) : "-"}</span>
                <span className="text-center">
                  {r.overLimit ? (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-0.5" style={{ background: "var(--cd-danger,#FA896B)", color: "#fff" }}>특별휴가 대상</span>
                  ) : r.overtimeMinutes > 0 ? (
                    <span className="text-[11px] cd-text-faint">정상</span>
                  ) : (
                    <span className="text-[11px] cd-text-faint">-</span>
                  )}
                </span>
              </button>
              {expanded === r.adtEmpNo && (
                <div className="px-3 pb-3">
                  <DailyDetail rows={daily[r.adtEmpNo]} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const gridCols = { display: "grid", gridTemplateColumns: "minmax(0,2.4fr) 0.7fr 1fr 1.1fr 1.1fr 1fr 1.1fr", gap: "8px" } as const;

function DailyDetail({ rows }: { rows?: DailyRow[] }) {
  if (!rows) return <p className="text-[11.5px] cd-text-faint py-2">불러오는 중입니다.</p>;
  if (rows.length === 0) return <p className="text-[11.5px] cd-text-faint py-2">일별 기록이 없습니다.</p>;
  return (
    <div className="rounded-xl border cd-border-c overflow-hidden">
      <div className="grid px-3 py-1.5 text-[10.5px] font-bold cd-text-faint border-b cd-border-c" style={dailyGrid}>
        <span>일자</span>
        <span className="text-center">출근</span>
        <span className="text-center">퇴근</span>
        <span className="text-right">실근무</span>
        <span className="text-right">야간</span>
        <span className="text-right">벤더연장</span>
        <span className="text-center">비고</span>
      </div>
      {rows.map((d) => (
        <div key={d.workDate} className="grid px-3 py-1.5 text-[12px] border-b cd-border-c last:border-b-0" style={dailyGrid}>
          <span className="font-mono cd-text">{d.workDate.slice(5)} ({dowOf(d.workDate)})</span>
          <span className="text-center font-mono cd-text">{clock(d.inAt)}</span>
          <span className="text-center font-mono cd-text">{clock(d.outAt)}</span>
          <span className="text-right font-mono cd-text">{d.workedMinutes != null ? hm(d.workedMinutes) : <span className="cd-text-faint">누락</span>}</span>
          <span className="text-right font-mono" style={{ color: (d.nightMinutes ?? 0) > 0 ? "var(--cd-primary)" : "var(--cd-faint)" }}>{d.nightMinutes ? hm(d.nightMinutes) : "-"}</span>
          <span className="text-right font-mono cd-text-faint">{d.vendorOverRaw ?? "-"}</span>
          <span className="text-center">
            {d.isLeaveDay ? <span className="text-[10px] rounded px-1.5 py-0.5 cd-tint-primary cd-text-primary font-semibold">휴가</span> : <span className="cd-text-faint text-[11px]">{d.source}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

const dailyGrid = { display: "grid", gridTemplateColumns: "1.2fr 0.9fr 0.9fr 1fr 0.9fr 1fr 0.9fr", gap: "6px" } as const;

/* ================= 미매칭 매핑 ================= */
function MappingPanel({ onCount }: { onCount: (n: number) => void }) {
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [employees, setEmployees] = useState<MappableEmployee[]>([]);
  const [sel, setSel] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/approval/attendance?unmatched=1`, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) {
      setUnmatched(data.unmatched ?? []);
      setEmployees(data.employees ?? []);
      onCount((data.unmatched ?? []).length);
    }
    setLoading(false);
  }, [onCount]);
  useEffect(() => {
    load();
  }, [load]);

  const doMap = async (adtEmpNo: string) => {
    const employeeId = sel[adtEmpNo];
    if (!employeeId) {
      alert("매핑할 직원을 선택하세요.");
      return;
    }
    setBusy(adtEmpNo);
    try {
      const res = await fetch("/api/approval/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ map: { employeeId, adtEmpNo } }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "매핑 실패");
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const alreadyMapped = employees.filter((e) => e.adtEmpNo);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] cd-text-muted">
        ADT 컨트롤러 사원번호(e_idno)가 앱의 직원과 자동으로 연결되지 않은 항목입니다. 아래에서 직원을 지정하면 즉시 이름이 반영되고, 다음 인제스트 주기에 휴가일 판정까지 정밀 재산정됩니다.
      </p>

      {loading ? (
        <p className="text-[13px] cd-text-faint">불러오는 중입니다.</p>
      ) : unmatched.length === 0 ? (
        <div className="rounded-2xl border cd-border-c p-6 text-center">
          <UserRoundCheck className="w-7 h-7 mx-auto mb-2" style={{ color: "var(--cd-primary)" }} />
          <p className="text-[13px] cd-text">미매칭 항목이 없습니다. 모든 근태가 직원과 연결되어 있습니다.</p>
        </div>
      ) : (
        <div className="rounded-2xl border cd-border-c overflow-hidden">
          <div className="hidden md:grid px-3 py-2 text-[11px] font-bold cd-text-faint border-b cd-border-c" style={mapGrid}>
            <span>ADT 사번 / 성명(스냅샷)</span>
            <span className="text-center">기록</span>
            <span>매핑할 직원</span>
            <span className="text-center">적용</span>
          </div>
          {unmatched.map((u) => (
            <div key={u.adtEmpNo} className="grid items-center px-3 py-2.5 border-b cd-border-c last:border-b-0" style={mapGrid}>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold cd-text font-mono">{u.adtEmpNo}</span>
                <span className="block text-[11px] cd-text-faint truncate">{u.empName ?? "-"}{u.deptSnapshot ? ` · ${u.deptSnapshot}` : ""}</span>
              </span>
              <span className="text-center text-[11.5px] cd-text-faint">{u.days}일<br />~{u.lastDate.slice(5)}</span>
              <select className="cd-select" value={sel[u.adtEmpNo] ?? ""} onChange={(e) => setSel((p) => ({ ...p, [u.adtEmpNo]: e.target.value }))}>
                <option value="">직원 선택…</option>
                {employees.map((e) => (
                  <option key={e.employeeId} value={e.employeeId}>
                    {e.name}{e.deptName ? ` (${e.deptName})` : ""}{e.adtEmpNo ? ` · 매핑됨:${e.adtEmpNo}` : ""}
                  </option>
                ))}
              </select>
              <span className="text-center">
                <button type="button" disabled={busy === u.adtEmpNo} onClick={() => doMap(u.adtEmpNo)} className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                  <Link2 className="w-3.5 h-3.5 inline" /> 매핑
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {alreadyMapped.length > 0 && (
        <div className="rounded-2xl border cd-border-c p-3">
          <div className="text-[11px] font-bold cd-text-faint mb-2">매핑된 직원 ({alreadyMapped.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {alreadyMapped.map((e) => (
              <span key={e.employeeId} className="inline-flex items-center gap-1.5 rounded-lg border cd-border-c px-2 py-1 text-[11.5px]">
                <span className="cd-text font-medium">{e.name}</span>
                <span className="cd-text-faint font-mono">{e.adtEmpNo}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const mapGrid = { display: "grid", gridTemplateColumns: "minmax(0,1.8fr) 0.8fr minmax(0,2fr) 0.9fr", gap: "8px" } as const;

/* ================= 산정 정책 ================= */
function SettingsPanel() {
  const [s, setS] = useState<AttendanceSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/approval/attendance?settings=1`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setS(data.settings);
    })();
  }, []);

  if (!s) return <p className="text-[13px] cd-text-faint">불러오는 중입니다.</p>;

  const set = <K extends keyof AttendanceSettings>(k: K, v: AttendanceSettings[K]) => { setS({ ...s, [k]: v }); setSaved(false); };
  const numField = (k: keyof AttendanceSettings, label: string, hint?: string) => (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold cd-text">{label}</span>
      <input className="cd-input" inputMode="numeric" value={String(s[k] as number)} onChange={(e) => set(k, Number(e.target.value.replace(/[^\d.]/g, "")) as never)} />
      {hint && <span className="text-[10.5px] cd-text-faint">{hint}</span>}
    </label>
  );

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/approval/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: s }) });
      if (!res.ok) throw new Error((await res.json())?.error ?? "저장 실패");
      setSaved(true);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <p className="text-[13px] cd-text-muted">사규 기준 자체 산정 정책입니다. 규정 변경 시 여기서 조정하면 다음 재산정부터 반영됩니다.</p>
      <div className="rounded-2xl border cd-border-c p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
        {numField("weeklyStandardMinutes", "주 소정근로(분)", "40h = 2400")}
        {numField("weeklyOvertimeLimitMinutes", "주 연장 한도(분)", "12h = 720, 초과분=특별휴가")}
        {numField("dailyStandardMinutes", "1일 소정(분)", "참고, 8h = 480")}
        {numField("breakMinutes", "휴게 공제(분)", "재실에서 차감")}
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold cd-text">야간 시작 (HHMM)</span>
          <input className="cd-input" value={s.nightStartHhmm} onChange={(e) => set("nightStartHhmm", e.target.value.replace(/\D/g, "").slice(0, 4))} />
          <span className="text-[10.5px] cd-text-faint">2.0배 구간 시작</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold cd-text">야간 종료 (HHMM)</span>
          <input className="cd-input" value={s.nightEndHhmm} onChange={(e) => set("nightEndHhmm", e.target.value.replace(/\D/g, "").slice(0, 4))} />
          <span className="text-[10.5px] cd-text-faint">익일, 기본 0600</span>
        </label>
        {numField("overtimeRateDay", "연장 배수(주간)", "기본 1.5")}
        {numField("overtimeRateNight", "연장 배수(야간)", "기본 2.0")}
        {numField("wageDivisorHours", "통상시급 제수", "월 소정근로시간, 기본 209")}
        {numField("roundUnitMinutes", "라운딩 단위(분)", "내림, 0=미적용")}
        {numField("minOvertimeMinutes", "연장 인정 최소(분)", "주 단위")}
        <label className="flex flex-col gap-1 justify-end">
          <span className="text-[12px] font-semibold cd-text">휴가일 제외</span>
          <label className="inline-flex items-center gap-2 cd-text text-[13px] mt-1">
            <input type="checkbox" checked={s.excludeLeaveDays} onChange={(e) => set("excludeLeaveDays", e.target.checked)} />
            연장 산정에서 제외
          </label>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={save} className="cd-btn cd-btn-primary rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50">
          <Save className="w-4 h-4 inline mr-1" /> 정책 저장
        </button>
        {saved && <span className="text-[12px]" style={{ color: "var(--cd-primary)" }}>저장되었습니다.</span>}
      </div>
      <p className="text-[11.5px] cd-text-faint">
        ※ 수당 금액(월평균임금 ÷ {s.wageDivisorHours} × 배수)은 직원별 급여 데이터 연동 후 지원됩니다. 현재는 시간·배수 대상까지 산정합니다.
      </p>
    </div>
  );
}

/* ---------- 공용 소품 ---------- */
function Kpi({ icon, label, value, danger }: { icon: React.ReactNode; label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-2xl border cd-border-c p-3.5 flex items-center gap-3">
      <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0" style={{ background: danger ? "var(--cd-danger,#FA896B)" : "var(--cd-primary-soft)", color: danger ? "#fff" : "var(--cd-primary)" }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] cd-text-faint">{label}</span>
        <span className="block text-[17px] font-extrabold cd-text tracking-tight">{value}</span>
      </span>
    </div>
  );
}

function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(t)) return date;
  const d = new Date(t + n * 86400000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
