"use client";

/**
 * 선행·후행 의존 관계(288, §28-3) — 상세 "의존 관계" 프레임(DepsPanel)과 선행 검색 피커(DepPickerModal).
 * 선행이 완료되지 않은 후행은 대기(상태는 바꾸지 않음). 선행 지연 = 미완료 + 마감/할 날이 오늘 이전. 시각 규칙은 todo.css 의 todo-deps- · todo-dp- 접두 클래스에만 둔다.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Link2, Plus, Search, X } from "lucide-react";
import { CdButton, CdModal } from "@/components/cdash";
import { TODO_STATUS_LABELS, todoItemLink, type TodoDepRef, type TodoDeps } from "@/lib/todo/types";
import { StatusDot } from "./TodoRow";
import { md } from "./todo-utils";
import { apiCall } from "./useTodoData";

const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const isLate = (d: TodoDepRef, today: string) => d.status !== "done" && !!(d.dueDate ?? d.doDate) && (d.dueDate ?? d.doDate)! < today;

function DepRow({ d, today, onRemove }: { d: TodoDepRef; today: string; onRemove?: () => void }) {
  const when = d.dueDate ?? d.doDate;
  return (
    <li className="todo-deps-row" data-done={d.status === "done" ? "1" : undefined}>
      <StatusDot status={d.status} />
      {d.visible ? (
        <Link href={todoItemLink(d.itemId)} className="todo-deps-ttl" title="할 일 열기">
          {d.title}
        </Link>
      ) : (
        <span className="todo-deps-ttl" data-private="1">
          {d.title}
        </span>
      )}
      <span className="todo-deps-meta">
        {TODO_STATUS_LABELS[d.status]}
        {d.assigneeName ? ` · ${d.assigneeName}` : ""}
        {when ? ` · ${md(when)}` : ""}
      </span>
      {isLate(d, today) && <span className="todo-deps-late">선행 지연</span>}
      {onRemove && (
        <button type="button" className="todo-deps-x" title="선행 해제" aria-label={`${d.title} 선행 해제`} onClick={onRemove}>
          <X aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

export function DepsPanel({ deps, canEdit, busy, onAdd, onRemove }: { deps: TodoDeps | null; canEdit: boolean; busy?: boolean; onAdd: () => void; onRemove: (dependsOn: string) => void }) {
  const today = todayKst();
  const open = deps?.openBlockers ?? 0;
  return (
    <section className="cd-card todo-fr" aria-label="의존 관계">
      <h3>
        <Link2 className="inline w-4 h-4 mr-1 align-[-2px]" aria-hidden="true" />
        의존 관계
        {deps && (deps.blockedBy.length > 0 || deps.blocks.length > 0) && (
          <span className="todo-sec-n">
            선행 {deps.blockedBy.length} · 후행 {deps.blocks.length}
            {open > 0 ? ` · 대기 ${open}` : ""}
          </span>
        )}
        {canEdit && (
          <span className="todo-tpl-menu">
            <CdButton variant="soft" size="sm" loading={busy} onClick={onAdd} title="이 할 일보다 먼저 끝나야 하는 할 일을 고릅니다">
              <Plus className="w-3.5 h-3.5" aria-hidden="true" /> 선행 추가
            </CdButton>
          </span>
        )}
      </h3>
      {!deps ? (
        <p className="text-[12px] cd-text-faint">불러오는 중…</p>
      ) : deps.blockedBy.length === 0 && deps.blocks.length === 0 ? (
        <p className="text-[12px] cd-text-faint">선행·후행이 없습니다. 먼저 끝나야 하는 할 일이 있으면 [선행 추가]로 연결하세요.</p>
      ) : (
        <div className="todo-deps">
          {deps.blockedBy.length > 0 && (
            <div>
              <p className="todo-deps-h">
                이 할 일이 기다리는 선행
                {open > 0 && (
                  <span className="todo-dep" title="선행이 끝나야 시작할 수 있습니다">
                    ⛓ 선행 {open}건 대기
                  </span>
                )}
              </p>
              <ul className="todo-deps-list">
                {deps.blockedBy.map((d) => (
                  <DepRow key={d.itemId} d={d} today={today} onRemove={canEdit ? () => onRemove(d.itemId) : undefined} />
                ))}
              </ul>
            </div>
          )}
          {deps.blocks.length > 0 && (
            <div>
              <p className="todo-deps-h">이 할 일을 기다리는 후행</p>
              <ul className="todo-deps-list">
                {deps.blocks.map((d) => (
                  <DepRow key={d.itemId} d={d} today={today} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function DepPickerModal({ open, itemId, busy, onClose, onPick }: { open: boolean; itemId: string; busy?: boolean; onClose: () => void; onPick: (dependsOn: string) => Promise<void> | void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<TodoDepRef[] | null>(null);
  const [loading, setLoading] = useState(false);
  const today = useMemo(() => todayKst(), []);
  useEffect(() => {
    if (!open) {
      setQ("");
      setItems(null);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) {
      setItems(null);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      apiCall<{ items: TodoDepRef[] }>(`/api/todo/search?q=${encodeURIComponent(term)}&exclude=${encodeURIComponent(itemId)}`)
        .then((d) => {
          if (alive) setItems(d.items ?? []);
        })
        .catch(() => {
          if (alive) setItems([]);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [open, q, itemId]);
  return (
    <CdModal open={open} onClose={onClose} title="선행 할 일 추가" size="md">
      <div className="todo-vars todo-dp">
        <label className="todo-dp-search">
          <Search aria-hidden="true" />
          <input type="search" className="cd-input" autoFocus placeholder="제목·프로젝트·보드 이름으로 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <p className="text-[11.5px] cd-text-faint">내가 볼 수 있는 미완료 할 일 중에서 고릅니다(자기 자신·이미 선행인 것 제외). 순환이 되는 연결은 거절됩니다.</p>
        {loading && <p className="text-[12px] cd-text-faint">검색 중…</p>}
        {!loading && items && items.length === 0 && <p className="text-[12px] cd-text-faint">일치하는 할 일이 없습니다.</p>}
        {items && items.length > 0 && (
          <ul className="todo-dp-list" aria-label="검색 결과">
            {items.map((d) => {
              const when = d.dueDate ?? d.doDate;
              return (
                <li key={d.itemId}>
                  <button type="button" className="todo-dp-row" disabled={busy} onClick={() => void onPick(d.itemId)}>
                    <StatusDot status={d.status} />
                    <span className="todo-dp-ttl">{d.title}</span>
                    <span className="todo-dp-meta">
                      {d.boardName ? `${d.boardName} · ` : ""}
                      {d.assigneeName ?? "담당 없음"}
                      {when ? ` · ${md(when)}` : ""}
                      {d.parentItemId ? " · 하위" : ""}
                    </span>
                    {isLate(d, today) && <span className="todo-deps-late">지연</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </CdModal>
  );
}
