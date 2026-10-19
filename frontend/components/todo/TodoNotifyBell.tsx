"use client";

// 할 일 알림함(277, docs/todo-kanban-blueprint.md §9 2차) — 탑바 아이콘 + 드롭다운 목록.
// 운영 알람(AlertBell)과 별개: 배정·댓글·완료/검토·리마인드·아침 요약이 사람별로 쌓이고 읽음 처리된다.
// 60초 폴링 + 열 때 재조회. 클릭 = 읽음 처리 후 해당 할 일로 이동.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, CheckCircle2, Clock, Inbox, MessageSquare, Sun, UserPlus, CalendarDays } from "lucide-react";
import type { TodoNotification } from "@/lib/todo/inbox";

const POLL_MS = 60_000;

function eventIcon(event: string) {
  const cls = "w-4 h-4";
  switch (event) {
    case "todo.assigned":
      return <UserPlus className={cls} />;
    case "todo.comment":
      return <MessageSquare className={cls} />;
    case "todo.status":
      return <CheckCircle2 className={cls} />;
    case "todo.digest":
      return <Sun className={cls} />;
    case "todo.weekly":
      return <CalendarDays className={cls} />;
    default:
      return <Clock className={cls} />;
  }
}

/** "방금 · 5분 전 · 3시간 전 · 어제 · 10/12" — 목록용 짧은 상대 시각. */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "어제";
  if (day < 7) return `${day}일 전`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function TodoNotifyBell() {
  const router = useRouter();
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TodoNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/todo/notifications?limit=30", { cache: "no-store", signal });
      if (!res.ok) return; // 401·500(277 미적용)은 조용히 — 탑바가 깨지면 안 된다.
      const d = (await res.json()) as { items?: TodoNotification[]; unread?: number };
      setItems(Array.isArray(d.items) ? d.items : []);
      setUnread(Number(d.unread) || 0);
      setLoaded(true);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    void reload(ctrl.signal);
    const id = setInterval(() => void reload(), POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [reload]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const markRead = async (ids: string[] | "all") => {
    // 낙관적 반영 — 실패해도 다음 폴링이 되돌린다.
    setItems((prev) => prev.map((n) => (ids === "all" || ids.includes(n.notifId) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)));
    setUnread((prev) => (ids === "all" ? 0 : Math.max(0, prev - ids.length)));
    try {
      await fetch("/api/todo/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids === "all" ? { all: true } : { ids }),
      });
    } catch {
      /* 폴링이 보정 */
    }
  };

  const openItem = (n: TodoNotification) => {
    if (!n.readAt) void markRead([n.notifId]);
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-xl w-9 h-9 flex items-center justify-center cd-surface-bg border cd-border-c cd-text-muted hover:text-[color:var(--cd-text)]"
        title="할 일 알림"
        aria-label={unread > 0 ? `할 일 알림 ${unread}건` : "할 일 알림"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
      >
        <Inbox className="w-4 h-4" />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded text-[11px] font-semibold flex items-center justify-center"
            style={{ background: "var(--cd-primary)", color: "#fff" }}
          >
            {badge}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            id={panelId}
            role="dialog"
            aria-label="할 일 알림"
            className="absolute top-[calc(100%+8px)] right-0 w-[360px] max-w-[calc(100vw-24px)] z-50 rounded-lg overflow-hidden border cd-border-c"
            style={{ background: "var(--cd-card-solid)", boxShadow: "var(--cd-shadow)" }}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b cd-hairline-c">
              <div className="text-sm font-bold cd-text">
                할 일 알림 {unread > 0 && <span className="ml-1 text-xs font-semibold" style={{ color: "var(--cd-primary)" }}>{unread}</span>}
              </div>
              <button
                type="button"
                className="cd-action text-xs cd-text-muted px-2 py-1 flex items-center gap-1 disabled:opacity-40"
                onClick={() => void markRead("all")}
                disabled={unread === 0}
                title="모두 읽음으로 표시"
              >
                <CheckCheck className="w-3.5 h-3.5" /> 모두 읽음
              </button>
            </div>
            <ul className="max-h-[420px] overflow-y-auto">
              {items.length === 0 && (
                <li className="px-4 py-8 text-center text-sm cd-text-muted">{loaded ? "알림이 없습니다." : "불러오는 중…"}</li>
              )}
              {items.map((n) => {
                const isUnread = !n.readAt;
                return (
                  <li key={n.notifId} className="border-b cd-hairline-c last:border-b-0">
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className="w-full text-left px-4 py-2.5 flex items-start gap-3 cd-row-hover"
                      style={isUnread ? { background: "var(--cd-primary-soft)" } : undefined}
                    >
                      <span
                        className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center mt-0.5"
                        style={{ background: "var(--cd-surface)", color: isUnread ? "var(--cd-primary)" : "var(--cd-muted)" }}
                      >
                        {eventIcon(n.event)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13px] leading-5 truncate ${isUnread ? "font-semibold cd-text" : "cd-text"}`}>{n.title}</span>
                        {n.body && <span className="block text-xs cd-text-muted truncate">{n.body}</span>}
                        <span className="block text-[11px] cd-text-faint mt-0.5">{relativeTime(n.createdAt)}</span>
                      </span>
                      {isUnread && <span className="shrink-0 w-2 h-2 rounded-full mt-2" style={{ background: "var(--cd-primary)" }} aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="px-4 py-2 border-t cd-hairline-c">
              <button type="button" className="cd-action text-xs cd-text-muted" onClick={() => { setOpen(false); router.push("/todo?view=list"); }}>
                할 일로 이동
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
