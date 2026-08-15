"use client";

// 휴무일 지정(/approval/holidays, admin) — 일정 메뉴와 같은 월 캘린더에서 날짜를 눌러 사내 휴무일을 지정한다.
// 법정공휴일·명절·근로자의 날은 외부 소스로 이미 붉게 표시되며, 여기서는 회사가 정하는 휴무일
// (대체휴일·창립기념일·전체연차 사용)을 추가한다.
// 지정 결과는 홈·일정 캘린더의 붉은 표시·휴무일명과 **초과근무 산정**(휴일=재실 전체가 초과근무)에 함께 반영된다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarOff, Info, Plus, Repeat, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { ScheduleCalendar } from "@/components/calendar/ScheduleCalendar";
import type { AnnualHoliday, OffDay } from "@/lib/hr/holidays";
import "@/components/cdash/cdash.css";

/** 지정 사유 — 서버(COMPANY_HOLIDAY_REASONS)와 같은 순서·키를 쓴다. */
const REASONS: Array<{ key: string; label: string }> = [
  { key: "substitute", label: "대체휴일" },
  { key: "foundation", label: "창립기념일" },
  { key: "collective_leave", label: "전체연차 사용" },
];
const reasonLabel = (k?: string | null) => REASONS.find((r) => r.key === k)?.label ?? "-";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const dowOf = (d: string): string => {
  const t = Date.parse(`${d}T12:00:00Z`);
  return Number.isNaN(t) ? "" : DOW[new Date(t).getUTCDay()];
};

export function HolidayBoard() {
  const { theme } = useCdashTheme();
  const now = new Date();
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [holidays, setHolidays] = useState<OffDay[]>([]);
  const [annual, setAnnual] = useState<AnnualHoliday[]>([]);
  const [rev, setRev] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 편집 대상 — 날짜 셀을 누르면 열린다.
  const [edit, setEdit] = useState<{ date: string; holiday: OffDay | null } | null>(null);

  const load = useCallback(async (year: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/approval/holidays?year=${year}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "휴무일을 불러오지 못했습니다.");
      setHolidays(d.holidays ?? []);
      setAnnual(d.annual ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load(cur.y);
  }, [load, cur.y, rev]);

  // 반복 규칙에서 전개된 날짜는 아래 '매년 반복' 목록이 따로 보여주므로 여기서는 뺀다.
  const company = useMemo(() => holidays.filter((h) => h.source === "company" && !h.recurring), [holidays]);
  const publicDays = useMemo(() => holidays.filter((h) => h.source === "public"), [holidays]);

  const afterSave = () => {
    setEdit(null);
    setRev((v) => v + 1); // 캘린더(ScheduleCalendar)도 함께 다시 불러온다
  };

  const removeAnnual = async (a: AnnualHoliday) => {
    if (!confirm(`매년 ${a.month}/${a.day} ${a.name} 지정을 삭제할까요?`)) return;
    try {
      const res = await fetch(`/api/approval/holidays?month=${a.month}&day=${a.day}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json())?.error ?? "삭제하지 못했습니다.");
      afterSave();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="cdash cd-fields-white min-h-full p-4 rounded-3xl" data-theme={theme}>
      <CdPageHeader icon={<CalendarOff className="w-5 h-5" />} title="휴무일 지정" />

      <p className="text-[13px] cd-text-muted mb-4 flex items-start gap-1.5">
        <Info className="w-4 h-4 shrink-0 mt-[1px]" style={{ color: "var(--cd-primary)" }} />
        <span>
          날짜를 클릭하면 <b>사내 휴무일</b>(대체휴일·창립기념일·전체연차 사용)로 지정할 수 있습니다. 법정공휴일·명절·근로자의 날은
          자동으로 표시되며 별도 지정이 필요 없습니다. 지정된 휴무일은 홈·일정 캘린더에 붉은색과 휴무일명으로 나타나고,
          <b>초과근무 산정</b>에서 소정근로가 없는 날(재실 시간 전체가 초과근무 대상)로 처리됩니다.
        </span>
      </p>

      {error && <p className="text-[13px] mb-3" style={{ color: "var(--cd-error)" }}>{error}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_480px] gap-4 items-start">
        <ScheduleCalendar
          events={[]}
          year={cur.y}
          month0={cur.m}
          onMonthChange={(y, m) => setCur({ y, m })}
          onEventClick={() => {}}
          onDayClick={(iso, holiday) => setEdit({ date: iso, holiday })}
          holidayRev={rev}
        />

        <div className="flex flex-col gap-4">
          <section className="rounded-2xl border cd-border-c p-3">
            <div className="text-[11px] font-bold cd-text-faint mb-2">
              사내 지정 휴무일 ({company.length}) — {cur.y}년
            </div>
            {loading ? (
              <p className="text-[12.5px] cd-text-faint">불러오는 중입니다.</p>
            ) : company.length === 0 ? (
              <p className="text-[12.5px] cd-text-faint">지정된 사내 휴무일이 없습니다. 캘린더에서 날짜를 클릭하세요.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {company.map((h) => (
                  <div key={h.date} className="flex items-center gap-2 rounded-lg border cd-border-c px-2 py-1.5" style={{ background: "var(--cd-card-solid)" }}>
                    <span className="font-mono text-[12px] font-bold shrink-0" style={{ color: "#EF4444" }}>
                      {h.date.slice(5)} ({dowOf(h.date)})
                    </span>
                    <span className="text-[12.5px] cd-text font-semibold truncate">{h.name}</span>
                    <span className="text-[11px] cd-text-faint ml-auto shrink-0">{reasonLabel(h.reason)}</span>
                    <button
                      type="button"
                      onClick={() => setEdit({ date: h.date, holiday: h })}
                      className="rounded px-1.5 py-0.5 text-[10px] font-bold border cd-border-c cd-text-faint hover:cd-tint-primary shrink-0"
                    >
                      수정
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 매년 반복 — 창립기념일처럼 해마다 같은 월일에 돌아오는 휴무일은 월·일만 등록해 두면
                조회 연도에 맞춰 자동 전개된다(해마다 다시 찍을 필요 없음). */}
            <div className="mt-3 pt-3 border-t cd-border-c">
              <div className="text-[11px] font-bold cd-text-faint mb-2 flex items-center gap-1">
                <Repeat className="w-3.5 h-3.5" /> 매년 반복 ({annual.length}) — 월·일만 등록하면 매년 자동 적용
              </div>
              {annual.length > 0 && (
                <div className="flex flex-col gap-1 mb-2">
                  {annual.map((a) => (
                    <div key={`${a.month}-${a.day}`} className="flex items-center gap-2 rounded-lg border cd-border-c px-2 py-1.5" style={{ background: "var(--cd-card-solid)" }}>
                      <span className="font-mono text-[12px] font-bold shrink-0" style={{ color: "#EF4444" }}>
                        매년 {a.month}/{a.day}
                      </span>
                      <span className="text-[12.5px] cd-text font-semibold truncate">{a.name}</span>
                      <span className="text-[11px] cd-text-faint shrink-0">
                        {cur.y}년 {String(a.month).padStart(2, "0")}-{String(a.day).padStart(2, "0")} ({dowOf(`${cur.y}-${String(a.month).padStart(2, "0")}-${String(a.day).padStart(2, "0")}`)})
                      </span>
                      <span className="text-[11px] cd-text-faint ml-auto shrink-0">{reasonLabel(a.reason)}</span>
                      <button
                        type="button"
                        onClick={() => removeAnnual(a)}
                        className="rounded px-1.5 py-0.5 text-[10px] font-bold border cd-border-c shrink-0 hover:cd-tint-primary"
                        style={{ color: "var(--cd-error)" }}
                      >
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <AnnualForm onSaved={afterSave} />
            </div>
          </section>

          <section className="rounded-2xl border cd-border-c p-3">
            <div className="text-[11px] font-bold cd-text-faint mb-2">
              법정공휴일·명절 ({publicDays.length}) — 자동 반영, 지정 불필요
            </div>
            {/* 태그 폭을 균등하게 3열 고정 — 명칭 길이에 따라 들쭉날쭉하면 훑어보기 어렵다. */}
            <div className="grid grid-cols-3 gap-1">
              {publicDays.map((h) => (
                <span
                  key={h.date}
                  className="flex items-center gap-1 rounded-lg border cd-border-c px-1.5 py-0.5 text-[11px] min-w-0"
                  style={{ background: "var(--cd-card-solid)" }}
                  title={`${h.date} ${h.name}`}
                >
                  <span className="font-mono cd-text-faint shrink-0">{h.date.slice(5)}</span>
                  <span className="cd-text truncate">{h.name}</span>
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>

      {edit && <HolidayModal target={edit} onClose={() => setEdit(null)} onSaved={afterSave} />}
    </div>
  );
}

/* ---------- 매년 반복 등록 폼 ---------- */
function AnnualForm({ onSaved }: { onSaved: () => void }) {
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [name, setName] = useState("창립기념일");
  // 매년 같은 날짜로 돌아오는 휴무일은 사실상 창립기념일뿐이라 사유는 고정한다(사용자 확정).
  const reason = "foundation";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/approval/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annual: { month: Number(month), day: Number(day), name: name.trim(), reason } }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "등록하지 못했습니다.");
      setMonth("");
      setDay("");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const num = (v: string, max: number) => v.replace(/\D/g, "").slice(0, 2) === "" ? "" : String(Math.min(Number(v.replace(/\D/g, "").slice(0, 2)), max));
  const ok = Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31 && name.trim().length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        <input className="cd-input" style={{ width: 58 }} inputMode="numeric" placeholder="월" value={month} onChange={(e) => setMonth(num(e.target.value, 12))} />
        <span className="text-[12px] cd-text-faint">월</span>
        <input className="cd-input" style={{ width: 58 }} inputMode="numeric" placeholder="일" value={day} onChange={(e) => setDay(num(e.target.value, 31))} />
        <span className="text-[12px] cd-text-faint">일</span>
        <input className="cd-input" style={{ width: 160 }} placeholder="휴무일명" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <button
          type="button"
          disabled={busy || !ok}
          onClick={submit}
          className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50 ml-auto"
        >
          <Plus className="w-3.5 h-3.5 inline" /> 추가
        </button>
      </div>
      {error && <p className="text-[11.5px]" style={{ color: "var(--cd-error)" }}>{error}</p>}
    </div>
  );
}

/* ---------- 지정 모달 ---------- */
function HolidayModal({
  target,
  onClose,
  onSaved,
}: {
  target: { date: string; holiday: OffDay | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = target.holiday?.source === "company" ? target.holiday : null;
  const [name, setName] = useState(existing?.name ?? "");
  const [reason, setReason] = useState(existing?.reason ?? REASONS[0].key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 사유를 고르면 휴무일명을 비워 둔 경우에 한해 기본 명칭으로 채운다(직접 입력이 우선).
  const pickReason = (key: string) => {
    setReason(key);
    if (!name.trim() || REASONS.some((r) => r.label === name.trim())) {
      setName(REASONS.find((r) => r.key === key)?.label ?? "");
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/approval/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: target.date, name: name.trim(), reason }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "저장하지 못했습니다.");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`${target.date} 휴무일 지정을 해제할까요?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/approval/holidays?date=${target.date}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json())?.error ?? "해제하지 못했습니다.");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isPublic = target.holiday?.source === "public";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4" style={{ background: "rgba(15,23,42,.35)" }} onClick={onClose}>
      <div
        className="w-full max-w-[420px] rounded-2xl border cd-border-c p-4 flex flex-col gap-3"
        style={{ background: "var(--cd-card-solid)", boxShadow: "var(--cd-shadow-hover)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <CalendarOff className="w-4 h-4" style={{ color: "var(--cd-primary)" }} />
          <span className="text-[15px] font-extrabold cd-text">휴무일 지정</span>
          <span className="ml-auto font-mono text-[13px] font-bold" style={{ color: "#EF4444" }}>
            {target.date} ({dowOf(target.date)})
          </span>
        </div>

        {isPublic && (
          <p className="text-[12px] rounded-lg cd-tint-primary px-3 py-2" style={{ color: "var(--cd-primary)" }}>
            이미 <b>{target.holiday?.name}</b>(법정공휴일)로 처리되는 날입니다. 사내 휴무일로 지정하면 이 명칭을 대신합니다.
          </p>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold cd-text">휴무일명</span>
          <input
            className="cd-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 창립기념일"
            maxLength={40}
          />
          <span className="text-[10.5px] cd-text-faint">캘린더에 이 이름이 표시됩니다.</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold cd-text">지정 사유</span>
          <select className="cd-select" value={reason} onChange={(e) => pickReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
        </label>

        {error && <p className="text-[12px]" style={{ color: "var(--cd-error)" }}>{error}</p>}

        <div className="flex items-center gap-2 pt-1">
          {existing && (
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50"
              style={{ color: "var(--cd-error)" }}
            >
              <Trash2 className="w-3.5 h-3.5 inline mr-1" /> 지정 해제
            </button>
          )}
          <button type="button" onClick={onClose} className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-[12.5px] font-semibold cd-text-muted ml-auto">
            취소
          </button>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={submit}
            className="cd-btn cd-btn-primary rounded-lg px-4 py-2 text-[12.5px] font-semibold disabled:opacity-50"
          >
            {existing ? "수정" : "휴무일 지정"}
          </button>
        </div>
      </div>
    </div>
  );
}
