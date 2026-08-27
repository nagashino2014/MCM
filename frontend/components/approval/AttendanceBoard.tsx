"use client";

// 근태·초과근무 관리(/approval/attendance, admin) — ADT캡스 근태 수신분의 주별 초과근무 리포트.
// 탭: ①주별 초과근무(주 선택·직원별 연장/야간/12h초과, 행 펼침→일별) ②신청 대조(초과근무 신청서×근태)
//     ③식대 경고(식대×초과근무 신청 대조 위반 — 경고/불지급/급여 차감 처분, 마이그 203·204)
//     ④미매칭 매핑(ADT 사번↔직원) ⑤산정 정책(엑셀 업로드·산정 기준·직원별 출근시각).
// 사규: 주 52h(일요일 시작)·야간 22:00~06:00 2.0배·그외 연장 1.5배·주 12h 초과분은 특별휴가 대상(리포트).
// 설계: docs/ADT_attendance_integration_handoff.md §7-1.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmClockCheck,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  Link2,
  Moon,
  Save,
  TriangleAlert,
  UploadCloud,
  UserRoundCheck,
  UserRoundX,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { EmployeeAvatar } from "@/components/ui/EmployeeAvatar";
import { WORK_SCHEDULE_KINDS } from "@/lib/adt/types";
import type { AttendanceSettings, WorkScheduleKind, WorkScheduleRow } from "@/lib/adt/types";
import type { DailyRow, IgnoredEmp, MappableEmployee, UnmatchedRow, WeeklyRow } from "@/lib/adt/queries";
import type { OvertimeMatchRow } from "@/lib/payroll/overtime";
import type { MealWarningAction, MealWarningRow } from "@/lib/approval/overtime-meal";
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
const won = (v: number): string => Math.round(v).toLocaleString();
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

type Tab = "weekly" | "match" | "meal" | "mapping" | "settings";

export function AttendanceBoard() {
  const { theme } = useCdashTheme();
  const [tab, setTab] = useState<Tab>("weekly");
  const [unmatchedCount, setUnmatchedCount] = useState<number | null>(null);

  return (
    // 다른 화면과 동일한 풀폭 프레임 — max-w-6xl 중앙 정렬이라 넓은 화면에서 좌우 여백만 남았다.
    <div className="cdash cd-fields-white min-h-full p-4 rounded-3xl" data-theme={theme}>
      <div>
        <CdPageHeader
          icon={<CalendarClock className="w-5 h-5" />}
          title="근태 · 초과근무 관리"
        />

        {/* 탭 */}
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          {([
            ["weekly", "주별 초과근무"],
            ["match", "신청 대조"],
            ["meal", "식대 경고"],
            ["mapping", "미매칭 매핑"],
            ["settings", "산정 정책"],
          ] as [Tab, string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`cd-chip ${tab === k ? "" : "cd-text-muted"}`}
              data-active={tab === k || undefined}
            >
              {label}
              {k === "mapping" && unmatchedCount != null && unmatchedCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold" style={{ background: "var(--cd-error)", color: "#fff" }}>
                  {unmatchedCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "weekly" && <WeeklyPanel />}
        {tab === "match" && <MatchPanel />}
        {tab === "meal" && <MealPanel />}
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
    // 산정 제외(특수관계인·임원)는 집계에서 뺀다.
    const act = rows.filter((r) => !r.excluded);
    const totalOt = act.reduce((a, r) => a + r.overtimeMinutes, 0);
    const totalNight = act.reduce((a, r) => a + r.overtimeNightMinutes, 0);
    const overLimit = act.filter((r) => r.overLimit).length;
    const totalPay = act.reduce((a, r) => a + (r.estimatedPay ?? 0), 0);
    return { totalOt, totalNight, overLimit, totalPay, people: act.length };
  }, [rows]);

  // 주 목록을 연·월로 갈라 3단 선택으로 좁힌다 — 데이터가 쌓이면 단일 목록은 못 쓴다.
  const weekMetas = useMemo(() => weeks.map((w) => ({ w, ...weekMeta(w) })), [weeks]);
  const sel = weekMetas.find((m) => m.w === weekStart);
  const years = useMemo(
    () => [...new Set(weekMetas.map((m) => m.year))].sort((a, b) => b - a),
    [weekMetas]
  );
  const selYear = sel?.year ?? years[0];
  const months = useMemo(
    () => [...new Set(weekMetas.filter((m) => m.year === selYear).map((m) => m.month))].sort((a, b) => b - a),
    [weekMetas, selYear]
  );
  const selMonth = sel?.month ?? months[0];
  const monthWeeks = useMemo(
    () => weekMetas.filter((m) => m.year === selYear && m.month === selMonth).sort((a, b) => a.nth - b.nth),
    [weekMetas, selYear, selMonth]
  );

  /** 연·월을 바꾸면 그 달의 첫 주로 이동한다. */
  const jump = (y: number, mo: number) => {
    const first = weekMetas.filter((m) => m.year === y && m.month === mo).sort((a, b) => a.nth - b.nth)[0];
    if (first) {
      setWeekStart(first.w);
      load(first.w);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] cd-text-faint">주 선택</span>
        <select className="cd-select" style={{ width: 104 }} value={selYear ?? ""} onChange={(e) => jump(Number(e.target.value), selMonth)}>
          {years.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select className="cd-select" style={{ width: 92 }} value={selMonth ?? ""} onChange={(e) => jump(selYear, Number(e.target.value))}>
          {months.map((mo) => <option key={mo} value={mo}>{mo}월</option>)}
        </select>
        <select className="cd-select" style={{ width: 320 }} value={weekStart} onChange={(e) => { setWeekStart(e.target.value); load(e.target.value); }}>
          {monthWeeks.length === 0 && <option value="">데이터 없음</option>}
          {monthWeeks.map((m) => (
            <option key={m.w} value={m.w}>
              {m.month}월 {m.nth}주차 · {m.w} (일) ~ {addDays(m.w, 6)} (토)
            </option>
          ))}
        </select>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi icon={<AlarmClockCheck className="w-4 h-4" />} label="주 인정연장 합" value={`${toH(kpi.totalOt)}h`} />
        <Kpi icon={<Moon className="w-4 h-4" />} label="야간(2.0배) 합" value={`${toH(kpi.totalNight)}h`} />
        <Kpi icon={<Wallet className="w-4 h-4" />} label="예상 수당 합" value={`${won(kpi.totalPay)}원`} />
        <Kpi icon={<TriangleAlert className="w-4 h-4" />} label="12h 초과 인원" value={`${kpi.overLimit}명`} danger={kpi.overLimit > 0} />
        <Kpi icon={<UserRoundCheck className="w-4 h-4" />} label="대상 인원" value={`${kpi.people}명`} />
      </div>

      {error && <p className="text-[13px]" style={{ color: "var(--cd-error)" }}>{error}</p>}
      {loading ? (
        <p className="text-[13px] cd-text-faint">불러오는 중입니다.</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] cd-text-faint py-4">해당 주의 근태 데이터가 없습니다. 컨트롤러 전송·인제스트 배치를 확인하세요.</p>
      ) : (
        <div className="cd-card overflow-hidden">
          {/* 헤더 */}
          <div className="hidden md:grid px-3 py-2 text-[11px] font-bold cd-text-faint border-b cd-border-c" style={gridCols}>
            <span>직원</span>
            <span className="text-center">근무일</span>
            <span className="text-right">실근무</span>
            <span className="text-right">연장(1.5배)</span>
            <span className="text-right">야간(2.0배)</span>
            <span className="text-right" title="통상시급(최신 근로계약 통상임금 ÷ 209) × (1.5×연장 + 2.0×야간). 급여대장 생성 시 전월 26일~금월 25일분이 자동 반영됩니다.">예상 수당</span>
            <span className="text-right">12h 초과</span>
            <span className="text-center">상태</span>
          </div>
          {rows.map((r) => (
            <div key={r.adtEmpNo} className="border-b cd-border-c last:border-b-0">
              <button type="button" onClick={() => toggle(r.adtEmpNo)} className={`w-full grid items-center px-3 py-2.5 text-left hover:cd-tint-primary transition-colors ${r.excluded ? "opacity-45" : ""}`} style={gridCols}>
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
                <span
                  className="text-right font-mono text-[13px] font-semibold"
                  style={{ color: r.estimatedPay ? "var(--cd-text)" : "var(--cd-faint)" }}
                  title={r.hourlyWage ? `통상시급 ${won(r.hourlyWage)}원` : "근로계약 임금 구성 미등록 — 계약 등록 후 산정됩니다"}
                >
                  {r.excluded ? "-" : r.estimatedPay ? `${won(r.estimatedPay)}` : r.overtimeMinutes > 0 ? "계약 필요" : "-"}
                </span>
                <span className="text-right font-mono text-[13px] font-bold" style={{ color: r.excessMinutes > 0 ? "var(--cd-error)" : "var(--cd-faint)" }}>{r.excessMinutes > 0 ? hm(r.excessMinutes) : "-"}</span>
                <span className="text-center">
                  {r.excluded ? (
                    <span className="inline-flex items-center text-[10.5px] font-bold rounded-full px-2 py-0.5 border cd-border-c cd-text-faint">산정 제외</span>
                  ) : r.overLimit ? (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-0.5" style={{ background: "var(--cd-error)", color: "#fff" }}>특별휴가 대상</span>
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

const gridCols = { display: "grid", gridTemplateColumns: "minmax(0,2.2fr) 0.6fr 0.9fr 1fr 1fr 1.2fr 0.9fr 1.1fr", gap: "8px" } as const;

function DailyDetail({ rows }: { rows?: DailyRow[] }) {
  if (!rows) return <p className="text-[11.5px] cd-text-faint py-2">불러오는 중입니다.</p>;
  if (rows.length === 0) return <p className="text-[11.5px] cd-text-faint py-2">일별 기록이 없습니다.</p>;
  return (
    <div className="rounded-xl border cd-border-c cd-surface-bg overflow-hidden">
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

/* ================= 신청 대조 ================= */
interface MatchResponse {
  rows: OvertimeMatchRow[];
  byEmployee: Array<{ employeeId: string; name: string; hourlyWage: number | null; amount: number; dayMin: number; nightMin: number; cappedMin: number; basis: string }>;
  summary: { docs: number; absent: number; short: number; noRecord: number; requestedHours: number; actualHours: number };
}

const VERDICT_LABEL: Record<OvertimeMatchRow["verdict"], { text: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  full: { text: "전량 인정", tone: "ok" },
  short: { text: "조기 퇴근", tone: "warn" },
  absent: { text: "미근무", tone: "bad" },
  "no-record": { text: "근태 없음", tone: "muted" },
  override: { text: "예외 승인", tone: "ok" },
  rejected: { text: "반려", tone: "bad" },
};

function MatchPanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<MatchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/payroll/overtime-match?year=${y}&month=${m}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "대조 내역을 불러오지 못했습니다.");
      setData(d as MatchResponse);
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load(year, month);
  }, [load, year, month]);

  const override = async (r: OvertimeMatchRow, mode: "approve" | "reject" | "clear") => {
    let reason: string | null = null;
    if (mode !== "clear") {
      const label = mode === "approve" ? "예외 승인" : "반려";
      reason = prompt(
        `${r.name} · ${r.workDate} ${r.reqStart}~${r.reqEnd}\n${label} 사유를 입력하세요.` +
          (mode === "approve" ? "\n(예: 실제 근무했으나 지문 미태그 — 부서장 확인)" : ""),
        mode === "approve" ? "지문 미태그 — 실근무 확인" : ""
      );
      if (reason == null) return; // 취소
    }
    setBusy(r.docId);
    try {
      const res = await fetch("/api/payroll/overtime-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: r.docId, employeeId: r.employeeId, workDate: r.workDate, mode, reason }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "처리 실패");
      await load(year, month);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const s = data?.summary;
  const years = [now.getFullYear(), now.getFullYear() - 1];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] cd-text-muted">
        승인된 <b>초과근무 신청서</b>와 <b>실제 근태 기록</b>을 일자별로 대조합니다. 인정 시간은 개인별 소정근로 종료 시각(산정 정책 탭) 이후의
        실제 재실 시간 중 <b>신청 시간을 상한</b>으로 산정됩니다. 지문 미태그 등 확인된 건은 <b>예외 승인</b>으로 신청 시간을 전량 인정할 수 있습니다.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] cd-text-faint">귀속 월</span>
        <select className="cd-select" style={{ width: 110 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select className="cd-select" style={{ width: 100 }} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
        <span className="text-[11.5px] cd-text-faint">
          귀속 구간 {month === 1 ? year - 1 : year}-{String(month === 1 ? 12 : month - 1).padStart(2, "0")}-26 ~ {year}-{String(month).padStart(2, "0")}-25
        </span>
      </div>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi icon={<CalendarClock className="w-4 h-4" />} label="신청 건수" value={`${s.docs}건`} />
          <Kpi icon={<AlarmClockCheck className="w-4 h-4" />} label="신청 시간" value={`${s.requestedHours}h`} />
          <Kpi icon={<CheckCircle2 className="w-4 h-4" />} label="인정 시간" value={`${s.actualHours}h`} />
          <Kpi icon={<UserRoundX className="w-4 h-4" />} label="미근무" value={`${s.absent}건`} danger={s.absent > 0} />
          <Kpi icon={<TriangleAlert className="w-4 h-4" />} label="조기 퇴근" value={`${s.short}건`} danger={s.short > 0} />
        </div>
      )}

      {error && <p className="text-[13px]" style={{ color: "var(--cd-error)" }}>{error}</p>}
      {loading ? (
        <p className="text-[13px] cd-text-faint">불러오는 중입니다.</p>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-[13px] cd-text-faint py-4">해당 월에 승인된 초과근무 신청서가 없습니다.</p>
      ) : (
        <>
          {/* 인원별 요약 */}
          {data.byEmployee.length > 0 && (
            <div className="rounded-2xl border cd-border-c p-3">
              <div className="text-[11px] font-bold cd-text-faint mb-2">인원별 산정 결과 — 급여대장에 이 금액이 반영됩니다</div>
              <div className="flex flex-wrap gap-1.5">
                {data.byEmployee.map((e) => (
                  // 배경을 흰색(카드 solid)으로 — 글라스 배경 위에서 태그 경계가 묻힌다.
                  <span
                    key={e.employeeId}
                    className="inline-flex items-center gap-1.5 rounded-lg border cd-border-c px-2 py-1 text-[11.5px]"
                    style={{ background: "var(--cd-card-solid)" }}
                  >
                    <span className="cd-text font-semibold">{e.name}</span>
                    <span className="font-mono cd-text-primary font-bold">{won(e.amount)}원</span>
                    <span className="cd-text-faint">{toH(e.dayMin + e.nightMin)}h</span>
                    {e.cappedMin > 0 && (
                      <span className="font-mono" style={{ color: "var(--cd-error)" }}>-{toH(e.cappedMin)}h</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 건별 대조 */}
          <div className="cd-card overflow-hidden">
            <div className="hidden md:grid px-3 py-2 text-[11px] font-bold cd-text-faint border-b cd-border-c" style={matchGrid}>
              <span>직원</span>
              <span className="text-center">근무일</span>
              <span className="text-center">신청 시간</span>
              <span className="text-center">실제 출·퇴근</span>
              <span className="text-center" title="개인별 소정근로 종료 시각 — 이 시각 이후부터 초과근무로 인정">초과 시작</span>
              <span className="text-right">신청</span>
              <span className="text-right">인정</span>
              <span className="text-center">판정</span>
              <span className="text-center">예외</span>
            </div>
            {data.rows.map((r) => {
              const v = VERDICT_LABEL[r.verdict];
              const tone =
                v.tone === "ok" ? { background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }
                : v.tone === "bad" ? { background: "var(--cd-error)", color: "#fff" }
                : v.tone === "warn" ? { background: "var(--cd-warning, #FFAE1F)", color: "#fff" }
                : { background: "transparent", color: "var(--cd-faint)" };
              const overridden = r.verdict === "override" || r.verdict === "rejected";
              return (
                <div key={r.docId} className="grid items-center px-3 py-2 border-b cd-border-c last:border-b-0 text-[12.5px]" style={matchGrid}>
                  <span className="cd-text font-semibold truncate">{r.name}</span>
                  <span className="text-center font-mono cd-text">{r.workDate.slice(5)} ({dowOf(r.workDate)})</span>
                  <span className="text-center font-mono cd-text">{r.reqStart}~{r.reqEnd}</span>
                  <span className="text-center font-mono cd-text-muted">
                    {r.inAt && r.outAt ? `${r.inAt}~${r.outAt}` : <span className="cd-text-faint">기록 없음</span>}
                  </span>
                  <span className="text-center font-mono cd-text-faint">{r.otStartAt}</span>
                  <span className="text-right font-mono cd-text-muted">{hm(r.reqMin)}</span>
                  <span className="text-right font-mono font-bold" style={{ color: r.actualMin < r.reqMin ? "var(--cd-error)" : "var(--cd-text)" }}>{hm(r.actualMin)}</span>
                  <span className="text-center">
                    <span className="inline-flex items-center text-[10.5px] font-bold rounded-full px-2 py-0.5" style={tone} title={r.overrideReason ?? undefined}>
                      {v.text}
                    </span>
                  </span>
                  <span className="flex items-center justify-center gap-1">
                    {overridden ? (
                      <button type="button" disabled={busy === r.docId} onClick={() => override(r, "clear")} className="rounded px-1.5 py-0.5 text-[10px] font-bold border cd-border-c cd-text-faint hover:cd-tint-primary disabled:opacity-50">
                        해제
                      </button>
                    ) : r.verdict === "absent" || r.verdict === "short" ? (
                      <>
                        <button type="button" disabled={busy === r.docId} onClick={() => override(r, "approve")} className="rounded px-1.5 py-0.5 text-[10px] font-bold border cd-border-c cd-text-primary hover:cd-tint-primary disabled:opacity-50" title="실근무 확인 — 신청 시간 전량 인정">
                          승인
                        </button>
                        <button type="button" disabled={busy === r.docId} onClick={() => override(r, "reject")} className="rounded px-1.5 py-0.5 text-[10px] font-bold border cd-border-c cd-text-faint hover:cd-tint-primary disabled:opacity-50" title="전량 불인정">
                          반려
                        </button>
                      </>
                    ) : (
                      <span className="cd-text-faint text-[11px]">-</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const matchGrid = { display: "grid", gridTemplateColumns: "minmax(0,1fr) 0.9fr 1.1fr 1.2fr 0.8fr 0.7fr 0.7fr 0.9fr 0.9fr", gap: "8px" } as const;

/* ================= 식대 경고 (마이그 203·204) ================= */
interface MealResponse {
  rows: MealWarningRow[];
  summary: { count: number; people: number; repeat: number; deduct: number; withhold: number; deductTotal: number };
}

const MEAL_ACTION_LABEL: Record<MealWarningAction, string> = {
  warning: "경고",
  withhold: "불지급",
  deduct: "급여 차감",
};

function MealPanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<MealResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (y: number, m: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/payroll/meal-warnings?year=${y}&month=${m}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "식대 경고 내역을 불러오지 못했습니다.");
      setData(d as MealResponse);
    } catch (err) {
      setError((err as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load(year, month);
  }, [load, year, month]);

  const setAction = async (r: MealWarningRow, action: MealWarningAction) => {
    let note: string | null = null;
    if (action !== "warning") {
      note = prompt(
        `${r.empName} · ${r.usedOn} ${r.vendor ?? "사용처 미상"}${r.amount != null ? ` ${won(r.amount)}원` : ""}\n` +
          `${MEAL_ACTION_LABEL[action]} 처분 사유를 입력하세요.` +
          (action === "deduct" ? "\n(사용액이 다음 급여대장 생성 시 '식대환수' 공제로 반영됩니다)" : ""),
        r.priorCount > 0 ? `반복 위반(${r.priorCount + 1}회차)` : ""
      );
      if (note == null) return; // 취소
    }
    setBusy(r.warningId);
    try {
      const res = await fetch("/api/payroll/meal-warnings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warningId: r.warningId, action, note }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "처리 실패");
      await load(year, month);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const s = data?.summary;
  const years = [now.getFullYear(), now.getFullYear() - 1];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] cd-text-muted">
        지출결의서의 <b>식대(복리후생비)</b> 사용을 그 날 <b>초과근무 신청</b>과 대조해 기준 미달 건을 자동 검출합니다
        (평일: 결제 17시 이후·신청 2시간 이상 / 휴일: 신청 4시간 이상). 1·2회는 <b>경고</b>로 처리하고, 반복되면
        <b> 불지급</b> 또는 <b>급여 차감</b>(사용액이 급여대장 &lsquo;식대환수&rsquo; 공제로 자동 반영)을 지정할 수 있습니다.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] cd-text-faint">귀속 월</span>
        <select className="cd-select" style={{ width: 110 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select className="cd-select" style={{ width: 100 }} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
        <span className="text-[11.5px] cd-text-faint">
          귀속 구간 {month === 1 ? year - 1 : year}-{String(month === 1 ? 12 : month - 1).padStart(2, "0")}-26 ~ {year}-{String(month).padStart(2, "0")}-25
        </span>
      </div>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Kpi icon={<UtensilsCrossed className="w-4 h-4" />} label="검출 건수" value={`${s.count}건`} />
          <Kpi icon={<UserRoundX className="w-4 h-4" />} label="대상 인원" value={`${s.people}명`} />
          <Kpi icon={<TriangleAlert className="w-4 h-4" />} label="반복 위반" value={`${s.repeat}건`} danger={s.repeat > 0} />
          <Kpi icon={<CheckCircle2 className="w-4 h-4" />} label="불지급 처분" value={`${s.withhold}건`} />
          <Kpi icon={<Wallet className="w-4 h-4" />} label="급여 차감" value={s.deduct > 0 ? `${s.deduct}건 · ${won(s.deductTotal)}원` : "0건"} danger={s.deduct > 0} />
        </div>
      )}

      {error && <p className="text-[13px]" style={{ color: "var(--cd-error)" }}>{error}</p>}
      {loading ? (
        <p className="text-[13px] cd-text-faint">불러오는 중입니다.</p>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-[13px] cd-text-faint py-4">해당 월에 검출된 식대 위반 건이 없습니다.</p>
      ) : (
        <div className="rounded-2xl border cd-border-c overflow-x-auto">
          <div className="hidden md:grid px-3 py-2 text-[11px] font-bold cd-text-faint border-b cd-border-c" style={mealGrid}>
            <span>직원</span>
            <span>사용일</span>
            <span>사용처</span>
            <span className="text-right">금액</span>
            <span>결제</span>
            <span>신청/기준</span>
            <span>누적</span>
            <span>처분</span>
            <span>메모</span>
          </div>
          {data.rows.map((r) => (
            <div key={r.warningId} className="grid items-center px-3 py-2 border-b cd-border-c last:border-b-0 text-[12.5px]" style={mealGrid}>
              <span className="font-semibold cd-text truncate">{r.empName}</span>
              <span className="cd-text">
                {r.usedOn.slice(5)}({dowOf(r.usedOn)}){r.isOffDay ? <span className="ml-1 text-[10px] font-bold" style={{ color: "var(--cd-error)" }}>휴일</span> : null}
              </span>
              <span className="cd-text truncate" title={r.docNo ? `문서 ${r.docNo}` : undefined}>{r.vendor ?? "미상"}</span>
              <span className="cd-text text-right">{r.amount != null ? `${won(r.amount)}원` : "-"}</span>
              <span className="cd-text-faint">{r.paidAtHm ?? "-"}</span>
              <span className="cd-text">
                {toH(r.appliedMinutes)}h <span className="cd-text-faint">/ {toH(r.requiredMinutes)}h</span>
              </span>
              <span
                className="text-[11px] font-bold"
                style={{ color: r.priorCount > 0 ? "var(--cd-error)" : "var(--cd-warning,#FFAE1F)" }}
              >
                {r.priorCount + 1}회차
              </span>
              <span>
                <select
                  className="cd-select"
                  style={{ width: "100%", minWidth: 96 }}
                  disabled={busy === r.warningId}
                  value={r.action}
                  onChange={(e) => setAction(r, e.target.value as MealWarningAction)}
                >
                  {(Object.keys(MEAL_ACTION_LABEL) as MealWarningAction[]).map((a) => (
                    <option key={a} value={a}>{MEAL_ACTION_LABEL[a]}</option>
                  ))}
                </select>
              </span>
              <span className="cd-text-faint text-[11px] truncate" title={r.actionNote ?? undefined}>
                {r.actionNote ?? "-"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const mealGrid = { display: "grid", gridTemplateColumns: "minmax(0,0.9fr) 0.9fr minmax(0,1.2fr) 0.8fr 0.6fr 0.8fr 0.6fr 1fr minmax(0,1fr)", gap: "8px" } as const;

/* ================= 미매칭 매핑 ================= */
function MappingPanel({ onCount }: { onCount: (n: number) => void }) {
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [employees, setEmployees] = useState<MappableEmployee[]>([]);
  const [ignored, setIgnored] = useState<IgnoredEmp[]>([]);
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
      setIgnored(data.ignored ?? []);
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

  const post = async (payload: unknown, key: string) => {
    setBusy(key);
    try {
      const res = await fetch("/api/approval/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json())?.error ?? "처리 실패");
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doIgnore = async (u: UnmatchedRow) => {
    if (!confirm(`${u.adtEmpNo}${u.empName ? ` (${u.empName})` : ""} 를 근태 관리대상에서 제외할까요?\n퇴사자·비직원 출입자에 사용합니다. 출입 기록 자체는 보관되며, 리포트에서만 빠집니다.`)) return;
    const reason = prompt("사유(선택) — 예: 퇴사, 협력사 출입", "") ?? "";
    await post({ ignore: { adtEmpNo: u.adtEmpNo, label: u.empName, reason: reason || null } }, u.adtEmpNo);
  };

  const toggleExclude = async (e: MappableEmployee) => {
    setBusy(e.employeeId);
    try {
      const res = await fetch("/api/approval/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exclude: { employeeId: e.employeeId, excluded: !e.overtimeExcluded } }) });
      if (!res.ok) throw new Error((await res.json())?.error ?? "변경 실패");
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
        ADT 컨트롤러 사원번호(e_idno)가 앱의 직원과 자동으로 연결되지 않은 항목입니다. 직원을 지정하면 즉시 이름이 반영되고, 다음 인제스트 주기에 휴가일 판정까지 정밀 재산정됩니다.
        <br />
        퇴사자·비직원 출입자는 <b>관리대상 아님</b>으로 지정하세요 — 출입 기록은 보관되고 근태 리포트·집계에서만 영구 제외됩니다.
      </p>

      {loading ? (
        <p className="text-[13px] cd-text-faint">불러오는 중입니다.</p>
      ) : unmatched.length === 0 ? (
        <div className="cd-card p-6 text-center">
          <UserRoundCheck className="w-7 h-7 mx-auto mb-2" style={{ color: "var(--cd-primary)" }} />
          <p className="text-[13px] cd-text">미매칭 항목이 없습니다. 모든 근태가 직원과 연결되어 있습니다.</p>
        </div>
      ) : (
        <div className="cd-card overflow-hidden">
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
              <span className="flex items-center justify-center gap-1.5">
                <button type="button" disabled={busy === u.adtEmpNo} onClick={() => doMap(u.adtEmpNo)} className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                  <Link2 className="w-3.5 h-3.5 inline" /> 매핑
                </button>
                <button
                  type="button"
                  disabled={busy === u.adtEmpNo}
                  onClick={() => doIgnore(u)}
                  className="cd-btn rounded-lg border cd-border-c px-2 py-1.5 text-xs font-semibold cd-text-faint hover:cd-tint-primary disabled:opacity-50"
                  title="퇴사자·비직원 — 근태 관리대상에서 영구 제외"
                >
                  <UserRoundX className="w-3.5 h-3.5 inline" /> 관리대상 아님
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {ignored.length > 0 && (
        <div className="rounded-2xl border cd-border-c p-3">
          <div className="text-[11px] font-bold cd-text-faint mb-2">관리대상 아님 ({ignored.length}) — 퇴사자·비직원 출입자. 해제하면 다시 매핑 목록에 나타납니다</div>
          <div className="flex flex-wrap gap-1.5">
            {ignored.map((g) => (
              <span key={g.adtEmpNo} className="inline-flex items-center gap-1.5 rounded-lg border cd-border-c px-2 py-1 text-[11.5px] opacity-70">
                <UserRoundX className="w-3.5 h-3.5 cd-text-faint" />
                <span className="cd-text font-medium">{g.label ?? "-"}</span>
                <span className="cd-text-faint font-mono">{g.adtEmpNo}</span>
                {g.reason && <span className="cd-text-faint">· {g.reason}</span>}
                <button
                  type="button"
                  disabled={busy === g.adtEmpNo}
                  onClick={() => post({ unignore: { adtEmpNo: g.adtEmpNo } }, g.adtEmpNo)}
                  className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold border cd-border-c cd-text-faint hover:cd-tint-primary disabled:opacity-50"
                >
                  해제
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {alreadyMapped.length > 0 && (
        <div className="rounded-2xl border cd-border-c p-3">
          <div className="text-[11px] font-bold cd-text-faint mb-2">매핑된 직원 ({alreadyMapped.length}) — 특수관계인·임원은 "제외"로 지정하면 초과근무 집계에서 빠집니다</div>
          <div className="flex flex-wrap gap-1.5">
            {alreadyMapped.map((e) => (
              <span key={e.employeeId} className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] ${e.overtimeExcluded ? "cd-border-c opacity-60" : "cd-border-c"}`}>
                <span className="cd-text font-medium">{e.name}</span>
                <span className="cd-text-faint font-mono">{e.adtEmpNo}</span>
                <button
                  type="button"
                  disabled={busy === e.employeeId}
                  onClick={() => toggleExclude(e)}
                  className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold border disabled:opacity-50 ${e.overtimeExcluded ? "cd-fill-primary border-transparent text-white" : "cd-border-c cd-text-faint hover:cd-tint-primary"}`}
                  title={e.overtimeExcluded ? "산정 제외 해제" : "초과근무 산정에서 제외"}
                >
                  {e.overtimeExcluded ? "산정 제외됨" : "제외"}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const mapGrid = { display: "grid", gridTemplateColumns: "minmax(0,1.6fr) 0.7fr minmax(0,1.8fr) 1.6fr", gap: "8px" } as const;

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
    // 좌: 업로드·산정 기준(고정폭) / 우: 직원별 출근 시각 — 오른쪽 여백을 쓰고 스크롤을 줄인다.
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,540px)_minmax(0,1fr)] gap-6 items-start">
      <div className="flex flex-col gap-6">
      {/* ① 근태 엑셀 업로드 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-[13.5px] font-bold cd-text flex items-center gap-1.5">
          <UploadCloud className="w-4 h-4" style={{ color: "var(--cd-primary)" }} /> 근태 엑셀 업로드
        </h3>
        <UploadPanel />
      </section>

      {/* ② 산정 기준 */}
      <section className="flex flex-col gap-3">
        <h3 className="text-[13.5px] font-bold cd-text flex items-center gap-1.5">
          <AlarmClockCheck className="w-4 h-4" style={{ color: "var(--cd-primary)" }} /> 산정 기준
        </h3>
        <p className="text-[13px] cd-text-muted">사규 기준 자체 산정 정책입니다. 규정 변경 시 여기서 조정하면 다음 재산정부터 반영됩니다.</p>
      <div className="rounded-2xl border cd-border-c p-4 grid grid-cols-2 gap-4">
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
      </section>
      </div>

      {/* ③ 직원별 출근 시각 */}
      <SchedulePanel />
    </div>
  );
}

/* ---------- 직원별 출근 시각(근무 유형) ---------- */
function SchedulePanel() {
  const [rows, setRows] = useState<WorkScheduleRow[]>([]);
  const [draft, setDraft] = useState<Record<string, WorkScheduleKind>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/approval/attendance?schedules=1`, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) {
      setRows(data.schedules ?? []);
      setDraft({});
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const kindOf = (r: WorkScheduleRow): WorkScheduleKind => draft[r.employeeId] ?? r.kind;
  const startOf = (r: WorkScheduleRow): string => {
    const k = WORK_SCHEDULE_KINDS.find((x) => x.kind === kindOf(r));
    return k ? `${k.startHhmm.slice(0, 2)}:${k.startHhmm.slice(2)}` : "-";
  };
  const endOf = (r: WorkScheduleRow): string => {
    const k = WORK_SCHEDULE_KINDS.find((x) => x.kind === kindOf(r));
    return k ? `${k.endHhmm.slice(0, 2)}:${k.endHhmm.slice(2)}` : "-";
  };
  const dirty = Object.keys(draft).length;

  const save = async () => {
    if (!dirty) return;
    setBusy(true);
    try {
      const items = Object.entries(draft).map(([employeeId, kind]) => ({ employeeId, kind }));
      const res = await fetch("/api/approval/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schedules: items }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "저장 실패");
      setSaved(true);
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[13.5px] font-bold cd-text flex items-center gap-1.5">
        <Clock3 className="w-4 h-4" style={{ color: "var(--cd-primary)" }} /> 직원별 출근 시각
      </h3>
      <p className="text-[13px] cd-text-muted">
        초과근무는 <b>개인별 소정근로 종료 시각 이후</b>부터 인정됩니다 — 8시 출근이면 17:00부터가 초과근무입니다.
        출근 방식을 고르면 출근·종료 시각이 함께 정해집니다. 미설정 직원은 <b>조기출근(8시)</b>으로 산정됩니다.
      </p>

      {loading ? (
        <p className="text-[13px] cd-text-faint">불러오는 중입니다.</p>
      ) : (
        <>
          <div className="cd-card overflow-hidden max-h-[68vh] overflow-y-auto">
            <div className="hidden md:grid px-3 py-2 text-[11px] font-bold cd-text-faint border-b cd-border-c sticky top-0 z-10 cd-solid-bg" style={schedGrid}>
              <span>성명</span>
              <span>부서</span>
              <span>직함</span>
              <span className="text-center">출근시각</span>
              <span className="text-center">종료시각</span>
              <span>출근방식</span>
            </div>
            {rows.map((r) => (
              <div key={r.employeeId} className="grid items-center px-3 py-2 border-b cd-border-c last:border-b-0" style={schedGrid}>
                <span className="flex items-center gap-2 min-w-0">
                  <EmployeeAvatar employeeId={r.employeeId} photoPath={r.photoPath} size={26} />
                  <span className="text-[13px] font-semibold cd-text truncate">{r.name}</span>
                </span>
                <span className="text-[12px] cd-text-muted truncate">{r.deptName ?? "-"}</span>
                <span className="text-[12px] cd-text-muted truncate">{r.positionName ?? "-"}</span>
                <span className="text-center font-mono text-[13px] font-semibold cd-text">{startOf(r)}</span>
                <span className="text-center font-mono text-[13px] cd-text-primary font-semibold" title="소정근로 종료 = 초과근무 시작">{endOf(r)}</span>
                <span className="flex items-center gap-1.5">
                  <select
                    className="cd-select"
                    style={{ width: 168 }}
                    value={kindOf(r)}
                    onChange={(e) => {
                      setDraft((p) => ({ ...p, [r.employeeId]: e.target.value as WorkScheduleKind }));
                      setSaved(false);
                    }}
                  >
                    {WORK_SCHEDULE_KINDS.map((k) => (
                      <option key={k.kind} value={k.kind}>{k.label}</option>
                    ))}
                  </select>
                  {r.isDefault && !draft[r.employeeId] && (
                    <span className="text-[10px] cd-text-faint shrink-0">기본값</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-[12px]" style={{ color: "var(--cd-primary)" }}>저장되었습니다.</span>}
            {dirty > 0 && <span className="text-[12px] cd-text-faint">변경 {dirty}건</span>}
            <button type="button" disabled={busy || !dirty} onClick={save} className="cd-btn cd-btn-primary rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50">
              <Save className="w-4 h-4 inline mr-1" /> 출근 시각 저장
            </button>
          </div>
        </>
      )}
    </section>
  );
}

const schedGrid = { display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1.1fr) 0.9fr 0.7fr 0.7fr 190px", gap: "8px" } as const;

/* ================= 엑셀 업로드 ================= */
interface UploadResult {
  collected: number;
  processedRaw: number;
  dailyUpserts: number;
  weeksRecomputed: number;
  matched: number;
  unmatched: number;
  perFile: Array<{ name: string; records: number; skipped: number; error?: string }>;
}

function UploadPanel({ onDone }: { onDone?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!files.length) {
      alert("업로드할 엑셀 파일을 선택하세요.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const res = await fetch("/api/approval/attendance/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "업로드에 실패했습니다.");
      setResult(data as UploadResult);
      setFiles([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] cd-text-muted">
        근태처리 후 조회에서 받은 <b>엑셀(.xls/.xlsx)</b>을 올리면 자동으로 파싱·초과근무 산정까지 됩니다. 본사·지사 파일을 함께 선택할 수 있습니다.
      </p>

      {/* 파일 선택 — 배경과 구분되도록 흰 바탕 + 점선 테두리 */}
      <label
        className="rounded-2xl p-6 flex flex-col items-center gap-2 cursor-pointer hover:cd-tint-primary transition-colors"
        style={{ background: "var(--cd-card-solid)", border: "1.5px dashed var(--cd-ring)" }}
      >
        <UploadCloud className="w-8 h-8" style={{ color: "var(--cd-primary)" }} />
        <span className="text-[13px] cd-text font-semibold">엑셀 파일 선택</span>
        <span className="text-[11.5px] cd-text-faint">여러 개 동시 선택 가능 · .xls / .xlsx</span>
        <input
          type="file"
          multiple
          accept=".xls,.xlsx"
          className="hidden"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </label>

      {files.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-[12.5px] cd-text rounded-lg border cd-border-c px-3 py-2">
              <FileSpreadsheet className="w-4 h-4 shrink-0" style={{ color: "var(--cd-primary)" }} />
              <span className="truncate flex-1">{f.name}</span>
              <span className="cd-text-faint">{(f.size / 1024).toFixed(0)} KB</span>
            </div>
          ))}
          <button type="button" disabled={busy} onClick={submit} className="cd-btn cd-btn-primary rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50 mt-1 self-start">
            <UploadCloud className="w-4 h-4 inline mr-1" /> {busy ? "처리 중…" : `${files.length}개 업로드`}
          </button>
        </div>
      )}

      {error && <p className="text-[13px]" style={{ color: "var(--cd-error)" }}>{error}</p>}

      {result && (
        <div className="rounded-2xl border cd-border-c p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" style={{ color: "var(--cd-primary)" }} />
            <span className="text-[14px] font-bold cd-text">업로드 완료</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <Stat label="스테이징 반영" value={result.collected} />
            <Stat label="일별 산정" value={result.dailyUpserts} />
            <Stat label="주 재계산" value={result.weeksRecomputed} />
            <Stat label="미매칭" value={result.unmatched} danger={result.unmatched > 0} />
          </div>
          <div className="flex flex-col gap-1 text-[12px] cd-text-faint">
            {result.perFile.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{f.name}</span>
                <span>— {f.error ? <span style={{ color: "var(--cd-error)" }}>{f.error}</span> : `${f.records}건 (스킵 ${f.skipped})`}</span>
              </div>
            ))}
          </div>
          {result.unmatched > 0 && (
            <p className="text-[12px] rounded-lg cd-tint-primary px-3 py-2" style={{ color: "var(--cd-primary)" }}>
              직원 자동연결 안 된 {result.unmatched}건이 있습니다 — <b>미매칭 매핑</b> 탭에서 ADT 사번↔직원을 연결하세요.
            </p>
          )}
          {onDone && (
            <button type="button" onClick={onDone} className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-xs font-semibold self-start">
              주별 초과근무 보기 →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-xl border cd-border-c p-2.5">
      <div className="text-[18px] font-extrabold tracking-tight" style={{ color: danger ? "var(--cd-error)" : "var(--cd-text)" }}>{value}</div>
      <div className="text-[10.5px] cd-text-faint">{label}</div>
    </div>
  );
}

/* ---------- 공용 소품 ---------- */
function Kpi({ icon, label, value, danger }: { icon: React.ReactNode; label: string; value: string; danger?: boolean }) {
  return (
    <div className="cd-card p-3.5">
      <span className="flex items-center gap-3">
        <span
          className="inline-flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
          style={{
            background: danger ? "var(--cd-error)" : "var(--cd-primary-soft)",
            color: danger ? "#fff" : "var(--cd-primary)",
          }}
        >
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] cd-text-faint">{label}</span>
          <span className="block text-[17px] font-extrabold cd-text tracking-tight">{value}</span>
        </span>
      </span>
    </div>
  );
}

/**
 * 주(일요일 시작) → 소속 연·월·주차.
 * 소속 월은 **그 주의 목요일**이 속한 달(ISO 관례) — 걸친 주가 두 달에 중복 노출되지 않는다.
 * 주차는 그 달 1일이 속한 주를 1주차로 센다. 예) 2026-07-19 → 7월 4주차(1주차=6/28~7/4).
 */
function weekMeta(weekStart: string): { year: number; month: number; nth: number } {
  const thu = addDays(weekStart, 4);
  const [y, m] = thu.split("-").map(Number);
  const firstOfMonth = `${y}-${String(m).padStart(2, "0")}-01`;
  const dow = new Date(Date.parse(`${firstOfMonth}T12:00:00Z`)).getUTCDay();
  const firstWeekStart = addDays(firstOfMonth, -dow);
  const diff = (Date.parse(`${weekStart}T00:00:00Z`) - Date.parse(`${firstWeekStart}T00:00:00Z`)) / 86400000;
  return { year: y, month: m, nth: Math.round(diff / 7) + 1 };
}

function addDays(date: string, n: number): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(t)) return date;
  const d = new Date(t + n * 86400000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
