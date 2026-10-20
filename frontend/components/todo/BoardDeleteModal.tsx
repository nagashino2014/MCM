"use client";

/**
 * 프로젝트·부서·공유 보드 삭제 확인(2026-10-20 사용자 요청 — 삭제 API 는 있었으나 화면 진입점이 없었음).
 * 보드를 만든 사람만(서버 deleteBoard 가 owner 검사), 개인 기본 보드는 대상 아님. 열·할 일(하위·댓글·활동)·멤버·자동화 규칙·보드 템플릿이
 * DB CASCADE 로 함께 지워지므로 건수를 보여 주고 "되돌릴 수 없음" 확인 체크 뒤에만 [보드 삭제]가 켜진다.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { CdButton, CdModal } from "@/components/cdash";
import type { TodoBoard, TodoItem } from "@/lib/todo/types";
import { apiCall } from "./useTodoData";

export function BoardDeleteModal({ board, onClose, onDeleted }: { board: TodoBoard | null; onClose: () => void; onDeleted: (boardId: string) => void }) {
  const [counts, setCounts] = useState<{ open: number; done: number } | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCounts(null);
    setAck(false);
    setError(null);
    if (!board) return;
    let alive = true;
    apiCall<{ items: TodoItem[]; doneCount?: number }>(`/api/todo/items?view=board&board=${encodeURIComponent(board.boardId)}&done=1`)
      .then((d) => {
        if (!alive) return;
        const items = d.items ?? [];
        setCounts({ open: items.filter((i) => i.status !== "done").length, done: items.filter((i) => i.status === "done").length });
      })
      .catch(() => alive && setCounts({ open: 0, done: 0 }));
    return () => {
      alive = false;
    };
  }, [board]);

  const run = async () => {
    if (!board || !ack || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiCall(`/api/todo/boards/${encodeURIComponent(board.boardId)}`, { method: "DELETE" });
      onDeleted(board.boardId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const total = counts ? counts.open + counts.done : null;
  return (
    <CdModal
      open={!!board}
      onClose={() => (busy ? undefined : onClose())}
      title="보드 삭제"
      size="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <CdButton variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            취소
          </CdButton>
          <CdButton variant="danger" size="sm" onClick={() => void run()} disabled={!ack || busy} icon={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}>
            보드 삭제
          </CdButton>
        </div>
      }
    >
      {board && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-start gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--cd-error-soft)", background: "var(--cd-error-soft)", color: "var(--cd-error)" }} role="alert">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">되돌릴 수 없습니다.</p>
              <p className="text-xs mt-0.5">보드의 열·할 일(하위 작업·댓글·활동 기록 포함)·멤버·자동화 규칙·보드 템플릿이 함께 삭제됩니다. 다른 보드의 할 일과 걸린 선행·후행 연결도 끊어집니다.</p>
            </div>
          </div>
          <div className="rounded-lg border cd-border-c p-3 flex flex-col gap-1">
            <p>
              <span className="cd-text-muted">보드</span> <b>{board.projectName ?? board.name}</b>
              {board.clientName && <span className="cd-text-faint"> · {board.clientName}</span>}
            </p>
            <p className="cd-text-muted">
              {total == null ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> 할 일 건수를 확인하는 중…
                </span>
              ) : total === 0 ? (
                "이 보드에 할 일이 없습니다."
              ) : (
                <>
                  함께 삭제되는 할 일 <b className="cd-text">{total}건</b> (진행 중 {counts!.open} · 완료 {counts!.done}, 하위 작업 별도)
                </>
              )}
            </p>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} />
            보드와 안의 할 일이 모두 삭제되며 되돌릴 수 없음을 확인했습니다.
          </label>
          {error && (
            <p className="text-xs" style={{ color: "var(--cd-error)" }} role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </CdModal>
  );
}
