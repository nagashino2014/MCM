"use client";

// 정기 회의 규칙 설정 모달(관리자·임원) — "매월 n번째 요일" 규칙을 추가·수정·삭제한다.
// 저장하면 오늘 이후의 미수정 회차가 새 규칙대로 다시 배치된다(사람이 조정한 회차는 유지).

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdButton } from "@/components/cdash/CdButton";
import { CdCheckbox, CdInput, CdSelect } from "@/components/cdash/CdField";
import { useCdToast } from "@/components/cdash/CdToast";
import { AttendeePicker, AttendeeTag } from "@/components/calendar/AttendeePicker";
import { formatTimeDigits } from "@/components/calendar/CalendarEntryModal";
import { WEEKDAY_LABELS, WEEK_ORDINAL_LABELS, type CalendarMeetingRule, type CalendarPerson } from "@/lib/calendar/types";

interface RuleDraft {
  ruleId: string | null;
  name: string;
  weekday: number;
  weeks: number[];
  startTime: string;
  endTime: string;
  location: string;
  attendees: CalendarPerson[];
  isActive: boolean;
}

const blank = (): RuleDraft => ({ ruleId: null, name: "", weekday: 1, weeks: [], startTime: "09:00", endTime: "10:00", location: "회의실", attendees: [], isActive: true });

export function MeetingRulesModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useCdToast();
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setExpanded(null);
    fetch("/api/calendar/rules", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = ((d?.rules ?? []) as CalendarMeetingRule[]).filter((r) => r.isActive);
        setRules(
          list.map((r) => ({
            ruleId: r.ruleId,
            name: r.name,
            weekday: r.weekday,
            weeks: r.weeks,
            startTime: r.startTime,
            endTime: r.endTime,
            location: r.location ?? "",
            attendees: r.attendees,
            isActive: r.isActive,
          }))
        );
      })
      .catch(() => toast("정기 회의 규칙을 불러오지 못했습니다.", "error"))
      .finally(() => setLoading(false));
  }, [open, toast]);

  const patch = (i: number, p: Partial<RuleDraft>) => setRules((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/calendar/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: rules.map((r) => ({
            ruleId: r.ruleId,
            name: r.name,
            weekday: r.weekday,
            weeks: r.weeks,
            startTime: r.startTime,
            endTime: r.endTime,
            location: r.location || null,
            attendeeIds: r.attendees.map((p) => p.employeeId),
            isActive: true,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "저장에 실패했습니다.");
      toast("정기 회의 규칙을 저장했습니다. 이후 회차가 다시 배치됩니다.", "success");
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const describe = (r: RuleDraft) =>
    r.weeks.length
      ? `매월 ${[...r.weeks].sort().map((n) => WEEK_ORDINAL_LABELS[n - 1]).join("·")} ${WEEKDAY_LABELS[r.weekday]}요일 ${r.startTime}~${r.endTime}`
      : "시행 주 미지정";

  return (
    <CdModal
      open={open}
      onClose={onClose}
      title="정기 회의 설정"
      size="lg"
      closeOnBackdrop={false}
      footer={
        <div className="flex items-center gap-2 w-full">
          <p className="text-[11px] cd-text-faint flex-1">
            다섯째 주는 원칙적으로 회의를 열지 않습니다. 저장하면 오늘 이후의 미조정 회차가 새 규칙대로 배치되고, 개별 조정한 회차는 그대로 둡니다.
          </p>
          <CdButton size="sm" onClick={onClose}>취소</CdButton>
          <CdButton size="sm" variant="primary" loading={busy} onClick={save}>저장</CdButton>
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        {loading && <p className="text-[12px] cd-text-faint">불러오는 중…</p>}
        {rules.map((r, i) => {
          const openRow = expanded === i;
          return (
            <div key={r.ruleId ?? `new-${i}`} className="rounded-xl border cd-line-c">
              <button type="button" className="w-full flex items-center gap-2 px-3 py-2.5 text-left" onClick={() => setExpanded(openRow ? null : i)}>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-extrabold cd-text truncate">{r.name || "(회의명 없음)"}</span>
                  <span className="block text-[11.5px] cd-text-muted truncate">{describe(r)}{r.location ? ` · ${r.location}` : ""}{r.attendees.length ? ` · 참석 ${r.attendees.length}명` : ""}</span>
                </span>
                {openRow ? <ChevronUp className="w-4 h-4 cd-text-faint" /> : <ChevronDown className="w-4 h-4 cd-text-faint" />}
              </button>
              {openRow && (
                <div className="px-3 pb-3 flex flex-col gap-3 border-t cd-hairline-c pt-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <CdInput label="회의명" required value={r.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="주간회의" />
                    <CdSelect label="시행 요일" value={String(r.weekday)} onChange={(e) => patch(i, { weekday: Number(e.target.value) })}>
                      {WEEKDAY_LABELS.map((w, idx) => (
                        <option key={w} value={idx}>{w}요일</option>
                      ))}
                    </CdSelect>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[12px] font-bold cd-text-muted">시행 주(매월)</span>
                    <div className="flex flex-wrap gap-3">
                      {WEEK_ORDINAL_LABELS.map((label, idx) => {
                        const n = idx + 1;
                        const on = r.weeks.includes(n);
                        return (
                          <label key={n} className="flex items-center gap-1.5 text-[12.5px] cd-text cursor-pointer">
                            <CdCheckbox checked={on} onChange={() => patch(i, { weeks: on ? r.weeks.filter((x) => x !== n) : [...r.weeks, n].sort() })} />
                            {label} 주
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <CdInput label="시작" value={r.startTime} inputMode="numeric" placeholder="HH:MM" onChange={(e) => patch(i, { startTime: formatTimeDigits(e.target.value) })} />
                    <CdInput label="종료" value={r.endTime} inputMode="numeric" placeholder="HH:MM" onChange={(e) => patch(i, { endTime: formatTimeDigits(e.target.value) })} />
                    <CdInput label="회의장소" value={r.location} onChange={(e) => patch(i, { location: e.target.value })} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[12px] font-bold cd-text-muted">기본 참석자 <span className="font-medium cd-text-faint">(새로 배치되는 회차에 복사됩니다)</span></span>
                    <AttendeePicker value={r.attendees} onChange={(next) => patch(i, { attendees: next })} height="28vh" />
                  </div>
                  <div className="flex justify-end">
                    <CdButton size="sm" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => { setRules((prev) => prev.filter((_, idx) => idx !== i)); setExpanded(null); }}>
                      이 규칙 삭제
                    </CdButton>
                  </div>
                </div>
              )}
              {!openRow && r.attendees.length > 0 && (
                <div className="px-3 pb-2.5 flex flex-wrap gap-1">
                  {r.attendees.slice(0, 8).map((p) => <AttendeeTag key={p.employeeId} person={p} />)}
                  {r.attendees.length > 8 && <span className="text-[11px] cd-text-faint self-center">외 {r.attendees.length - 8}명</span>}
                </div>
              )}
            </div>
          );
        })}
        <CdButton size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => { setRules((prev) => [...prev, blank()]); setExpanded(rules.length); }}>
          정기 회의 추가
        </CdButton>
      </div>
    </CdModal>
  );
}
