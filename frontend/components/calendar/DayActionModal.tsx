"use client";

// 일정 캘린더 날짜 셀 클릭 메뉴 — 모바일(schedule.tsx 날짜 탭 시트)과 같은 구성 + 직접 등록 3종.
// 출장·휴가·교육은 결재 문서가 원천이라 기안 화면으로 보낸다(?date= 프리필). 회의·면접·미팅은 직접 등록.

import { useRouter } from "next/navigation";
import { Briefcase, ChevronRight, GraduationCap, Handshake, Palmtree, UserCheck, Users } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import type { CalendarAccess, CalendarEntryKind } from "@/lib/calendar/types";

/** 기안으로 만드는 일정 — 모바일 SCHEDULE_FORMS 와 동일. */
const SCHEDULE_FORMS: { formId: string; label: string; icon: typeof Briefcase }[] = [
  { formId: "frm-biz-trip-request", label: "출장 신청", icon: Briefcase },
  { formId: "frm-leave-request", label: "휴가 신청", icon: Palmtree },
  { formId: "frm-education-request", label: "교육 신청", icon: GraduationCap },
];

const ENTRY_ACTIONS: { kind: CalendarEntryKind; label: string; icon: typeof Users; needs: keyof CalendarAccess | null; hint: string }[] = [
  { kind: "meeting", label: "회의 일정 등록", icon: Users, needs: "meeting", hint: "관리자·임원만 등록할 수 있습니다." },
  { kind: "interview", label: "면접 일정 등록", icon: UserCheck, needs: "interview", hint: "면접 관리자만 등록할 수 있습니다." },
  { kind: "visit", label: "미팅 일정 등록", icon: Handshake, needs: null, hint: "외부 손님·발주처 방문 미팅" },
];

export function DayActionModal({
  date,
  access,
  onClose,
  onPickEntry,
}: {
  date: string | null;
  access: CalendarAccess;
  onClose: () => void;
  onPickEntry: (kind: CalendarEntryKind, date: string) => void;
}) {
  const router = useRouter();
  const open = !!date;
  const rowCls = "w-full flex items-center gap-3 rounded-xl border cd-line-c px-3.5 py-2.5 text-left transition cd-row-hover disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <CdModal open={open} onClose={onClose} title={`${date ?? ""} 일정 추가`} size="sm">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-[11.5px] cd-text-faint">출장·휴가·교육은 결재 문서에서 만들어집니다. 양식을 고르면 날짜가 채워집니다.</p>
          {SCHEDULE_FORMS.map((f) => (
            <button
              key={f.formId}
              type="button"
              className={rowCls}
              onClick={() => {
                onClose();
                router.push(`/approval/draft?formId=${encodeURIComponent(f.formId)}&date=${date}`);
              }}
            >
              <f.icon className="w-4 h-4" style={{ color: "var(--cd-primary)" }} />
              <span className="flex-1 text-[13.5px] font-bold cd-text">{f.label}</span>
              <ChevronRight className="w-4 h-4 cd-text-faint" />
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 pt-2 border-t cd-hairline-c">
          <p className="text-[11.5px] cd-text-faint">회의·면접·미팅은 캘린더에 바로 등록됩니다. 참석자에게 알림이 갑니다.</p>
          {ENTRY_ACTIONS.map((a) => {
            const allowed = a.needs ? access[a.needs] : true;
            return (
              <button
                key={a.kind}
                type="button"
                className={rowCls}
                disabled={!allowed}
                title={allowed ? a.hint : `${a.hint}`}
                onClick={() => date && onPickEntry(a.kind, date)}
              >
                <a.icon className="w-4 h-4" style={{ color: "var(--cd-primary)" }} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-bold cd-text">{a.label}</span>
                  <span className="block text-[11px] cd-text-faint truncate">{a.hint}</span>
                </span>
                <ChevronRight className="w-4 h-4 cd-text-faint" />
              </button>
            );
          })}
        </div>
      </div>
    </CdModal>
  );
}
