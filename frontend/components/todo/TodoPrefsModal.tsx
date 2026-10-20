"use client";

/**
 * 할 일 설정 모달(§29-3 2차, 2026-10-19) — 그동안 API 로만 바꿀 수 있던 prefs 를 화면에서: 알림(아침 요약·주간 요약·종일/시간 알림)과 표시(주 시작·밀도·결재 일정·퀵애드 파서).
 * 변경 즉시 PATCH /api/todo/prefs(onPatch). 시각 규칙은 todo.css 의 todo-pf-* 에만 둔다.
 */

import { useState } from "react";
import { CdButton, CdModal } from "@/components/cdash";
import { TODO_DEFAULT_DIGEST_TIME, TODO_DEFAULT_WEEKLY_TIME, type TodoPrefs } from "@/lib/todo/types";
import { WorkTypeSettings } from "./WorkTypeSettings";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function TimeField({ value, onCommit, disabled }: { value: string; onCommit: (v: string) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  const [key, setKey] = useState(value);
  if (key !== value) {
    setKey(value);
    setDraft(value);
  }
  return (
    <input
      type="time"
      className="cd-input todo-pf-time"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (TIME_RE.test(draft) && draft !== value) onCommit(draft);
        else setDraft(value);
      }}
    />
  );
}

export function TodoPrefsModal({ prefs, onPatch, onClose }: { prefs: TodoPrefs; onPatch: (patch: Partial<TodoPrefs>) => Promise<void> | void; onClose: () => void }) {
  const digestOn = !!prefs.digestTime;
  const weeklyOn = !!prefs.weeklyDigestTime;
  return (
    <CdModal
      open
      onClose={onClose}
      title="할 일 설정"
      size="lg"
      footer={
        <CdButton variant="primary" size="sm" onClick={onClose}>
          닫기
        </CdButton>
      }
    >
      <div className="todo-vars todo-pf">
        <section className="todo-pf-sec" aria-label="알림">
          <h4>알림</h4>
          <label className="todo-pf-row">
            <input type="checkbox" checked={digestOn} onChange={(e) => void onPatch({ digestTime: e.target.checked ? TODO_DEFAULT_DIGEST_TIME : null })} />
            <span className="todo-pf-lb">
              아침 요약 <small>오늘 할 일·지연 건수(0건이면 보내지 않음)</small>
            </span>
            <TimeField value={prefs.digestTime ?? TODO_DEFAULT_DIGEST_TIME} disabled={!digestOn} onCommit={(v) => void onPatch({ digestTime: v })} />
          </label>
          <label className="todo-pf-row">
            <input type="checkbox" checked={weeklyOn} onChange={(e) => void onPatch({ weeklyDigestTime: e.target.checked ? TODO_DEFAULT_WEEKLY_TIME : null })} />
            <span className="todo-pf-lb">
              주간 요약 <small>지난주 완료·이번 주 예정·지연·맡긴 일·프로젝트 진척</small>
            </span>
            <select className="cd-select todo-pf-dow" value={prefs.weeklyDigestDow} disabled={!weeklyOn} onChange={(e) => void onPatch({ weeklyDigestDow: Number(e.target.value) })} aria-label="주간 요약 요일">
              {DOW.map((d, i) => (
                <option key={i} value={i}>
                  {d}요일
                </option>
              ))}
            </select>
            <TimeField value={prefs.weeklyDigestTime ?? TODO_DEFAULT_WEEKLY_TIME} disabled={!weeklyOn} onCommit={(v) => void onPatch({ weeklyDigestTime: v })} />
          </label>
          <label className="todo-pf-row">
            <input type="checkbox" checked={prefs.weeklyDigestMail} disabled={!weeklyOn} onChange={(e) => void onPatch({ weeklyDigestMail: e.target.checked })} />
            <span className="todo-pf-lb">
              주간 요약을 사내 메일함에도 받기 <small>noreply 발신, 받은편지함</small>
            </span>
          </label>
          <label className="todo-pf-row">
            <span className="todo-pf-lb">
              종일 할 일 알림 시각 <small>할 날만 있는 할 일의 기본 알림</small>
            </span>
            <TimeField value={prefs.defaultRemindAllDayTime} onCommit={(v) => void onPatch({ defaultRemindAllDayTime: v })} />
          </label>
          <label className="todo-pf-row">
            <span className="todo-pf-lb">
              시간 지정 할 일 알림 <small>시작 N분 전</small>
            </span>
            <select className="cd-select" value={prefs.defaultRemindBeforeMin} onChange={(e) => void onPatch({ defaultRemindBeforeMin: Number(e.target.value) })} aria-label="N분 전">
              {[5, 10, 15, 30, 60, 120].map((n) => (
                <option key={n} value={n}>
                  {n}분 전
                </option>
              ))}
            </select>
          </label>
        </section>
        <section className="todo-pf-sec" aria-label="표시">
          <h4>표시</h4>
          <label className="todo-pf-row">
            <span className="todo-pf-lb">주 시작 요일</span>
            <select className="cd-select" value={prefs.weekStart} onChange={(e) => void onPatch({ weekStart: Number(e.target.value) === 0 ? 0 : 1 })} aria-label="주 시작 요일">
              <option value={1}>월요일</option>
              <option value={0}>일요일</option>
            </select>
          </label>
          <label className="todo-pf-row">
            <span className="todo-pf-lb">카드 밀도</span>
            <select className="cd-select" value={prefs.cardDensity} onChange={(e) => void onPatch({ cardDensity: e.target.value === "compact" ? "compact" : "comfortable" })} aria-label="카드 밀도">
              <option value="comfortable">보통</option>
              <option value="compact">촘촘하게</option>
            </select>
          </label>
          <label className="todo-pf-row">
            <input type="checkbox" checked={prefs.showApprovalEvents} onChange={(e) => void onPatch({ showApprovalEvents: e.target.checked })} />
            <span className="todo-pf-lb">
              내 할 일에 결재 일정 표시 <small>출장·교육·휴가 등 회색 행</small>
            </span>
          </label>
          <label className="todo-pf-row">
            <input type="checkbox" checked={prefs.quickAddParse} onChange={(e) => void onPatch({ quickAddParse: e.target.checked })} />
            <span className="todo-pf-lb">
              빠른 입력 자연어 해석 <small>"내일 3시 미팅", "매주 월 보고" 같은 날짜·반복 자동 인식</small>
            </span>
          </label>
        </section>
        <section className="todo-pf-sec" aria-label="하위 작업 유형·종류">
          <h4>하위 작업 유형·종류</h4>
          <WorkTypeSettings />
        </section>
      </div>
    </CdModal>
  );
}
