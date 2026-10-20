"use client";

// 완료 확인 모달(276, 2026-10-14) — 완료 조건이 하나라도 있는 할 일을 체크(행·카드·드로어·칸반 완료 열)할 때 먼저 띄운다.
// 제목 · 조건별 충족 표시(✓ / 미충족 문구) · 완료 메모 textarea(규칙 note 면 필수) · [완료] primary / [취소].
// 서버 409(code complete_rules) 응답도 failure 로 받아 같은 화면으로 안내한다. 시각 규칙은 todo.css 의 todo-cc-* 에만 둔다.

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import { CdButton, CdModal } from "@/components/cdash";
import { CdHelp } from "@/components/cdash/CdHelp";
import { TODO_COMPLETE_RULE_LABELS, type TodoCompleteRuleKey, type TodoCompleteRules } from "@/lib/todo/types";
import { activeCompleteRuleKeys, checkCompletion, describeMissingRule } from "@/lib/todo/completion";
import type { CompleteRulesFailure } from "./useTodoData";

/** 모달이 판단에 쓰는 최소 필드 — 목록 행(TodoItem)·상세(TodoItemDetail) 모두 만족한다. */
export interface CompleteConfirmTarget {
  itemId: string;
  title: string;
  status: string;
  completeRules: TodoCompleteRules;
  subtaskTotal: number;
  subtaskDone: number;
  reviewedAt: string | null;
  completionNote: string | null;
  /** 미완료 선행 작업 수(288) — 목록·상세 응답의 openDeps. */
  openDeps?: number;
}

export interface CompleteConfirmModalProps {
  open: boolean;
  target: CompleteConfirmTarget | null;
  /** 서버가 거절한 결과(409) — 클라이언트 판정과 합쳐 보인다. */
  failure?: CompleteRulesFailure | null;
  busy?: boolean;
  onConfirm: (completionNote: string | null) => void;
  onClose: () => void;
}

export function CompleteConfirmModal({ open, target, failure, busy, onConfirm, onClose }: CompleteConfirmModalProps) {
  const [note, setNote] = useState("");
  useEffect(() => {
    if (open) setNote(target?.completionNote ?? "");
  }, [open, target?.itemId, target?.completionNote]);

  const keys = useMemo(() => activeCompleteRuleKeys(target?.completeRules), [target?.completeRules]);
  const check = useMemo(
    () =>
      target
        ? checkCompletion(target.completeRules, {
            status: target.status,
            openSubtasks: Math.max(0, target.subtaskTotal - target.subtaskDone),
            openDeps: target.openDeps ?? 0,
            completionNote: note,
            reviewedAt: target.reviewedAt,
          })
        : null,
    [target, note]
  );
  // 서버 거절은 메모(지금 입력으로 해소 가능) 외에는 그대로 미충족으로 본다.
  const serverMissing = useMemo(() => new Set((failure?.missing ?? []).filter((k) => k !== "note")), [failure]);
  const missing = useMemo(() => new Set<TodoCompleteRuleKey>([...(check?.missing ?? []), ...serverMissing]), [check, serverMissing]);
  const openSubtasks = failure && serverMissing.has("subtasks") ? Math.max(failure.openSubtasks, check?.openSubtasks ?? 0) : (check?.openSubtasks ?? 0);
  const openDeps = failure && serverMissing.has("deps") ? Math.max(failure.openDeps, check?.openDeps ?? 0) : (check?.openDeps ?? 0);
  const noteRequired = !!target?.completeRules.note;
  const canConfirm = !!target && missing.size === 0 && !busy;

  return (
    <CdModal
      open={open && !!target}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-1">
          완료 확인
          <CdHelp topic="todo.complete-rules" />
        </span>
      }
      size="sm"
      closeOnBackdrop={!busy}
      footer={
        <>
          <CdButton variant="ghost" onClick={onClose} disabled={busy}>
            취소
          </CdButton>
          <CdButton variant="primary" loading={busy} disabled={!canConfirm} onClick={() => onConfirm(note.trim() || null)}>
            완료
          </CdButton>
        </>
      }
    >
      {target && (
        <div className="todo-vars todo-cc">
          <p className="todo-cc-title">{target.title}</p>
          {failure && (
            <p className="todo-cc-server" role="alert">
              <AlertCircle aria-hidden="true" />
              서버가 완료를 거절했습니다 — 아래 조건을 확인하세요.
            </p>
          )}
          {!target.completeRules.deps && openDeps > 0 && (
            <p className="todo-cc-server" role="status">
              <AlertCircle aria-hidden="true" />
              선행 작업 {openDeps}건이 아직 끝나지 않았습니다(경고 — 완료는 가능).
            </p>
          )}
          <ul className="todo-cc-rules" aria-label="완료 조건">
            {keys.map((k) => {
              const bad = missing.has(k);
              return (
                <li key={k} className="todo-cc-rule" data-ok={bad ? undefined : "true"}>
                  <span className="todo-cc-ic" aria-hidden="true">
                    {bad ? <AlertCircle /> : <Check strokeWidth={2.6} />}
                  </span>
                  <span className="todo-cc-lb">{TODO_COMPLETE_RULE_LABELS[k]}</span>
                  <span className="todo-cc-st">{bad ? describeMissingRule(k, openSubtasks, openDeps) : k === "subtasks" ? `하위 작업 ${target.subtaskDone}/${target.subtaskTotal} 완료` : "충족"}</span>
                </li>
              );
            })}
          </ul>
          <label className="todo-cc-note">
            <span className="todo-cc-note-lb">
              완료 메모{noteRequired ? <b className="todo-cc-req">필수</b> : <span className="todo-mu">선택</span>}
            </span>
            <textarea
              className="cd-input"
              rows={3}
              maxLength={2000}
              value={note}
              placeholder={noteRequired ? "완료 결과·확인 사항을 적어야 완료할 수 있습니다" : "완료 결과를 남길 수 있습니다"}
              aria-required={noteRequired}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canConfirm) {
                  e.preventDefault();
                  onConfirm(note.trim() || null);
                }
              }}
            />
          </label>
        </div>
      )}
    </CdModal>
  );
}
