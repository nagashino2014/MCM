"use client";

// 상세 드로어(§7.3 · 시안 v4 §19-6, 580px) — 바탕 --cd-surface, 헤더(흰 바탕 · 좌측 5px 보드 색 띠 · 체크 · 제목 18px · 프로젝트 칩 · ⋯ 메뉴 · 닫기).
// 본문은 프레임 섹션(cd-card 12/16, 12px 간격): ① 핵심 2×2(상태 칩+▾ · 담당 아바타+▾ · 수행 예정 · 마감) ② 관련(용역·사업장·연결) ③ 메모 ④ 하위 작업(분절 진행바)
// ⑤ 댓글(사진 아바타 28px, 입력란 앞에 내 아바타) ⑥ 부가 설정(접힘 요약 = 라벨+값 3열 2행 — 우선순위·알림·반복 / 보드·공유·스누즈) ⑦ 활동(접힘, 요약은 최근 2건 행마다). 하단 바는 "저장됨 · 방금"만.
// 2026-10-14: 핵심 2×2 네 셀은 클릭 전에도 36px 입력란 박스(날짜가 비면 "YYYYMMDD"+달력 아이콘), 메모 기본 높이 2배.
// 자동 저장: 필드 변경 → 600ms 디바운스 PATCH /api/todo/items/[id]. 키보드: Esc 닫기(CdDrawer), Ctrl+Enter 댓글, Alt+1~5 상태. 시각 규칙은 todo.css 의 todo-* 에만 둔다.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, Calendar, CheckCircle2, ClipboardList, LayoutTemplate, ChevronDown, ChevronRight, Copy, ExternalLink, FileSignature, Link2, MessageCircle, MoreHorizontal, Trash2, X } from "lucide-react";
import { CdAvatar, CdButton, CdDateInput, CdDrawer, CdDropdown, CdIconButton, CdModal, isValidDateString, useCdToast, type CdMenuItem } from "@/components/cdash";
import {
  TODO_BOARD_KIND_LABELS,
  TODO_LINK_KIND_LABELS,
  TODO_PRIORITY_LABELS,
  TODO_RECURRENCE_PRESETS,
  TODO_SHARE_ROLE_LABELS,
  TODO_SNOOZE_PRESETS,
  TODO_STATUSES,
  TODO_STATUS_LABELS,
  TODO_WEEKDAY_CODES,
  TODO_WEEKDAY_LABELS,
  type TodoActivity,
  type TodoBoard,
  type TodoItem,
  type TodoItemDetail,
  type TodoPrefs,
  type TodoPriority,
  type TodoShareRole,
  type TodoStatus,
} from "@/lib/todo/types";
import { describeRecurrence, parseRecurrence } from "@/lib/todo/recurrence";
import { completeRulesSummary, hasAnyCompleteRule } from "@/lib/todo/completion";
import { TodoCheck, linkHref, tintStyle } from "./TodoRow";
import { PeoplePickerModal } from "./PeoplePickerModal";
import { LinkPickerModal } from "./LinkPickerModal";
import { CompleteConfirmModal } from "./CompleteConfirmModal";
import { CompleteRulesFields } from "./CompleteRulesFields";
import { apiCall, asCompleteRulesFailure, type CompleteRulesFailure } from "./useTodoData";
import { contractShort, defaultRemindAt, diffDays, fmtIsoShort, isoToLocalInput, md, normalizeTime, relativeTime, weekdayKo } from "./todo-utils";

export interface TodoDetailDrawerProps {
  /** §25-4: "page" 면 CdDrawer 없이 상세 페이지 본문으로 렌더(2열 레이아웃, 닫기=목록으로). */
  mode?: "drawer" | "page";
  itemId: string | null;
  boards: TodoBoard[];
  prefs: TodoPrefs | null;
  myUserId: string | null;
  /** 댓글 입력란 아바타용 현재 사용자 — 이름은 세션, 사진은 목록 응답(owner/assignee 사진 맵)에서. 없으면 상세 응답(owner·담당·공유·댓글)에서 찾는다. */
  myName?: string | null;
  myPhotoUrl?: string | null;
  today: string;
  onClose: () => void;
  onItemChanged: (item: TodoItemDetail) => void;
  onItemCreated: (item: TodoItem) => void;
  onItemDeleted: (itemId: string) => void;
  onOpenItem: (itemId: string) => void;
}

type SaveState = "idle" | "saving" | "saved" | "error";
type PropKey = "do" | "due" | "remind" | "recurrence" | "board";

const longDate = (ymd: string) => `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일 (${weekdayKo(ymd)})`;

function describeActivity(a: TodoActivity): string {
  const d = a.detail ?? {};
  const st = (v: unknown) => (typeof v === "string" && v in TODO_STATUS_LABELS ? TODO_STATUS_LABELS[v as TodoStatus] : String(v ?? ""));
  switch (a.action) {
    case "create":
      return "생성";
    case "status": {
      const [from, to] = Array.isArray(d.from) ? (d.from as unknown[]) : [d.from, d.to];
      return `${st(from)} → ${st(to)}`;
    }
    case "complete":
      return "완료";
    case "reopen":
      return "되돌림";
    case "assign":
      return d.to ? "담당 지정" : "담당 해제";
    case "due":
      return "날짜 변경";
    case "move":
      return d.boardId ? "보드 이동" : d.columnId ? "열 이동" : "순서 변경";
    case "share":
      return d.chatRoomId ? "메신저로 공유" : d.removed ? "공유 해제" : `공유 (${TODO_SHARE_ROLE_LABELS[(d.role as TodoShareRole) ?? "watcher"] ?? ""})`;
    case "comment":
      return "댓글";
    case "snooze":
      return "스누즈";
    case "archive":
      return "보관";
    case "progress": {
      const d = a.detail as { from?: number | null; to?: number | null; note?: string; stage?: number | null };
      const pct = d.to != null ? `진행율 ${d.from != null ? `${d.from}% → ` : ""}${d.to}%` : "진척 내용 입력";
      return `${pct}${d.stage != null ? ` · ${d.stage}단계` : ""}`;
    }
    case "work_report":
      return "업무 보고 초안 생성";
    case "update":
      if (d.subtaskRemoved !== undefined) return `하위 작업 삭제 (${String(d.subtaskRemoved) || "제목 없음"})`;
      return `수정 (${Object.keys((d.changes as Record<string, unknown>) ?? {}).join(", ") || "내용"})`;
    default:
      return a.action;
  }
}

function renderMentions(body: string): ReactNode {
  const parts = body.split(/(@[^\s@,.]+)/g);
  return parts.map((p, i) => (p.startsWith("@") ? <span key={i} className="todo-mention">{p}</span> : <span key={i}>{p}</span>));
}

/** 편집 영역 — Esc 또는 바깥으로 포커스가 나가면 닫는다. */
function PropEditor({ onDone, children }: { onDone: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
  }, []);
  return (
    <div
      ref={ref}
      className="todo-pr-edit"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onDone();
        }
      }}
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node | null)) onDone();
      }}
    >
      {children}
    </div>
  );
}

/** 접힘 프레임 섹션 — 헤더 클릭으로 펼침. 접힘이면 한 줄 요약. */
function FoldSection({ label, count, summary, open, onToggle, col, children }: { label: string; count?: number; summary: ReactNode; open: boolean; onToggle: () => void; col?: "side"; children: ReactNode }) {
  return (
    <section className="cd-card todo-fr" data-fold="true" data-col={col} aria-label={label}>
      <h3>
        <button type="button" className="todo-fold-btn" onClick={onToggle} aria-expanded={open}>
          {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          {label}
          {count != null && <span className="todo-sec-n">{count}</span>}
        </button>
      </h3>
      {open ? (
        <div className="todo-fold-body">{children}</div>
      ) : (
        <div className="todo-fold-ln" data-grid={typeof summary === "string" ? undefined : "true"}>
          {summary}
        </div>
      )}
    </section>
  );
}

export function TodoDetailDrawer({ mode = "drawer", itemId, boards, prefs, myUserId, myName, myPhotoUrl, today, onClose, onItemChanged, onItemCreated, onItemDeleted, onOpenItem }: TodoDetailDrawerProps) {
  const { toast } = useCdToast();
  const [detail, setDetail] = useState<TodoItemDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [editing, setEditing] = useState<PropKey | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [timeDraft, setTimeDraft] = useState("");
  const [pickerRole, setPickerRole] = useState<TodoShareRole | null>(null);
  // §25-1 담당 후보 = 작성자 + 공유 대상 + 보드 멤버(개인 보드는 멤버 없음). 보드 멤버는 담당 지정을 열 때 한 번 읽는다.
  const [boardMembers, setBoardMembers] = useState<{ userId: string; name: string }[] | null>(null);
  // §25-3 업무 보고 — 관련 대상(계약/Task)의 최근 보고 2건 + 초안 만들기(POST /work-report → /work-plan/[reportId]).
  const router = useRouter();
  const [reports, setReports] = useState<{ reportId: string; periodStart: string; periodEnd: string; status: string }[] | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  // §26-3 체크리스트 템플릿 — 하위 작업 섹션 [템플릿 ▾]: 적용 / 현재 하위 작업 저장 / 삭제.
  const [templates, setTemplates] = useState<{ templateId: string; name: string; boardId: string | null; items: { title: string }[]; canEdit: boolean }[] | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const loadTemplates = useCallback(async (boardId: string | null | undefined) => {
    try {
      const d = await apiCall<{ templates: { templateId: string; name: string; boardId: string | null; items: { title: string }[]; canEdit: boolean }[] }>(
        `/api/todo/templates${boardId ? `?boardId=${encodeURIComponent(boardId)}` : ""}`
      );
      setTemplates(d.templates ?? []);
    } catch {
      setTemplates([]);
    }
  }, []);
  const [chatOpen, setChatOpen] = useState(false);
  const [rooms, setRooms] = useState<{ roomId: number; name: string; roomType: string; memberCount: number }[] | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [subTitle, setSubTitle] = useState("");
  const [subConfirmId, setSubConfirmId] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(mode === "page");
  const [busy, setBusy] = useState(false);
  // 완료 확인 모달(276) — 완료 조건이 있거나 서버가 409 로 거절했을 때
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmFailure, setConfirmFailure] = useState<CompleteRulesFailure | null>(null);
  // 연결 추가·변경은 LinkPickerModal(종류별 검색·목록)로 — 사용자는 개별 ID를 모른다.
  const [linkOpen, setLinkOpen] = useState(false);
  const [recDraft, setRecDraft] = useState<{ preset: string; days: string[]; day: string; after: string }>({ preset: "", days: ["MO"], day: "1", after: "7" });
  const queue = useRef<Record<string, unknown>>({});
  const timer = useRef<number | null>(null);
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const composing = useRef(false);

  const open = !!itemId;

  // ── 로드 ──
  const load = useCallback(async () => {
    if (!itemId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const d = await apiCall<{ item: TodoItemDetail }>(`/api/todo/items/${encodeURIComponent(itemId)}`);
      setDetail(d.item);
      setTitle(d.item.title);
      setNote(d.item.note ?? "");
      setTimeDraft(d.item.doTime ?? "");
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    setDetail(null);
    setEditing(null);
    setSaveState("idle");
    setComment("");
    setSubTitle("");
    setActivityOpen(false);
    setExtraOpen(false);
    queue.current = {};
    if (timer.current) window.clearTimeout(timer.current);
    void load();
  }, [load]);

  // ── 자동 저장 큐(600ms) ──
  const flush = useCallback(async () => {
    const id = detailRef.current?.itemId;
    const body = queue.current;
    queue.current = {};
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!id || !Object.keys(body).length) return;
    setSaveState("saving");
    try {
      const d = await apiCall<{ item: TodoItemDetail }>(`/api/todo/items/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
      if (detailRef.current?.itemId === id) {
        setDetail(d.item);
        setTitle((t) => (t.trim() === d.item.title ? t : d.item.title));
      }
      onItemChanged(d.item);
      setSaveState("saved");
      setSavedAt(Date.now());
    } catch (e) {
      queue.current = { ...body, ...queue.current };
      setSaveState("error");
      toast(`저장하지 못했습니다. 입력은 유지됩니다 — ${(e as Error).message}`, "error");
    }
  }, [onItemChanged, toast]);

  const schedule = useCallback(
    (patch: Record<string, unknown>, immediate = false) => {
      Object.assign(queue.current, patch);
      setDetail((d) => (d ? ({ ...d, ...patch } as TodoItemDetail) : d));
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), immediate ? 0 : 600);
    },
    [flush]
  );

  const close = () => {
    if (Object.keys(queue.current).length) void flush();
    onClose();
  };

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  // ── 파생 ──
  const board = useMemo(() => boards.find((b) => b.boardId === detail?.boardId) ?? null, [boards, detail?.boardId]);
  const column = board?.columns.find((c) => c.columnId === detail?.columnId) ?? null;
  const canEdit = !!detail?.canEdit;
  const remindDefault = detail && prefs ? defaultRemindAt(detail, prefs) : null;
  const remindMode: "default" | "custom" | "off" = !detail?.remindAt ? "off" : detail.remindAt === remindDefault ? "default" : "custom";

  // ── 동작 ──
  /**
   * 완료/되돌리기(276). 완료는 완료 조건이 있으면 모달 먼저, 없으면 즉시 — 서버 409(code complete_rules)면 모달로 안내.
   * 되돌리기는 제한 없음. 자동 저장 큐에 남은 변경은 먼저 보낸다(완료 메모·조건이 큐에 있을 수 있다).
   */
  const complete = async (done: boolean, completionNote?: string | null) => {
    if (!detail) return false;
    if (done && completionNote === undefined && hasAnyCompleteRule(detail.completeRules)) {
      setConfirmFailure(null);
      setConfirmOpen(true);
      return false;
    }
    if (Object.keys(queue.current).length) await flush();
    setBusy(true);
    try {
      const d = await apiCall<{ item: TodoItemDetail; next: TodoItem | null }>(`/api/todo/items/${encodeURIComponent(detail.itemId)}/complete`, {
        method: "POST",
        body: JSON.stringify({ done, ...(completionNote !== undefined ? { completionNote } : {}) }),
      });
      setDetail(d.item);
      onItemChanged(d.item);
      if (d.next) onItemCreated(d.next);
      setConfirmOpen(false);
      setConfirmFailure(null);
      if (!done) toast("되돌렸습니다", "success");
      return true;
    } catch (e) {
      const failure = asCompleteRulesFailure(e);
      if (failure) {
        setConfirmFailure(failure);
        setConfirmOpen(true);
        return false;
      }
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** 상태 변경 — 완료는 complete() 경로(조건 검사·모달), 그 외는 자동 저장 PATCH. */
  const changeStatus = (s: TodoStatus) => {
    if (!detail || detail.status === s) return;
    if (s === "done") void complete(true);
    else schedule({ status: s }, true);
  };

  const refresh = async () => {
    if (!detail) return;
    try {
      const d = await apiCall<{ item: TodoItemDetail }>(`/api/todo/items/${encodeURIComponent(detail.itemId)}`);
      setDetail(d.item);
      onItemChanged(d.item);
    } catch {
      /* 조용히 유지 */
    }
  };

  const share = async (userId: string, role: TodoShareRole) => {
    if (!detail) return;
    const d = await apiCall<{ item: TodoItemDetail }>(`/api/todo/items/${encodeURIComponent(detail.itemId)}/share`, { method: "POST", body: JSON.stringify({ userId, role }) });
    setDetail(d.item);
    onItemChanged(d.item);
  };

  const unshare = async (userId: string) => {
    if (!detail) return;
    try {
      const d = await apiCall<{ item: TodoItemDetail | null }>(`/api/todo/items/${encodeURIComponent(detail.itemId)}/share?userId=${encodeURIComponent(userId)}`, { method: "DELETE" });
      if (d.item) {
        setDetail(d.item);
        onItemChanged(d.item);
      } else {
        // 내 공유를 내가 해제 → 더는 볼 수 없다
        onItemDeleted(detail.itemId);
        onClose();
      }
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const snooze = async (preset: string) => {
    if (!detail) return;
    try {
      const d = await apiCall<{ item: TodoItemDetail }>(`/api/todo/items/${encodeURIComponent(detail.itemId)}/snooze`, { method: "POST", body: JSON.stringify({ preset }) });
      setDetail(d.item);
      onItemChanged(d.item);
      toast(`알림을 ${fmtIsoShort(d.item.remindAt)} 으로 미뤘습니다`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const addComment = async () => {
    const body = comment.trim();
    if (!detail || !body) return;
    setBusy(true);
    try {
      const d = await apiCall<{ comments: TodoItemDetail["comments"] }>(`/api/todo/items/${encodeURIComponent(detail.itemId)}/comments`, { method: "POST", body: JSON.stringify({ body }) });
      setComment("");
      const next = { ...detail, comments: d.comments, commentCount: d.comments.length };
      setDetail(next);
      onItemChanged(next);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const addSubtask = async () => {
    const t = subTitle.trim();
    if (!detail || !t) return;
    setBusy(true);
    try {
      await apiCall(`/api/todo/items`, { method: "POST", body: JSON.stringify({ title: t, parentItemId: detail.itemId }) });
      setSubTitle("");
      await refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  // 하위 작업 진척(285, §25-2) — 진행율·진척 내용·공정 단계. 슬라이더는 400ms, 내용은 800ms 디바운스로 PATCH, 같은 하위의 보류 값은 합친다.
  const subTimers = useRef<Record<string, number>>({});
  const subPending = useRef<Record<string, Record<string, unknown>>>({});
  const [subDraft, setSubDraft] = useState<Record<string, { pct?: number; note?: string }>>({});
  const patchSubtask = async (sub: TodoItem, body: Record<string, unknown>) => {
    try {
      await apiCall(`/api/todo/items/${encodeURIComponent(sub.itemId)}`, { method: "PATCH", body: JSON.stringify(body) });
      await refresh();
      setSubDraft((d) => {
        const n = { ...d };
        delete n[sub.itemId];
        return n;
      });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const queueSubtask = (sub: TodoItem, body: Record<string, unknown>, delay = 400) => {
    setSubDraft((d) => ({
      ...d,
      [sub.itemId]: {
        ...d[sub.itemId],
        ...(body.progressPct !== undefined ? { pct: Number(body.progressPct) } : {}),
        ...(body.progressNote !== undefined ? { note: String(body.progressNote ?? "") } : {}),
      },
    }));
    subPending.current[sub.itemId] = { ...subPending.current[sub.itemId], ...body };
    if (subTimers.current[sub.itemId]) window.clearTimeout(subTimers.current[sub.itemId]);
    subTimers.current[sub.itemId] = window.setTimeout(() => {
      const pending = subPending.current[sub.itemId] ?? {};
      delete subPending.current[sub.itemId];
      void patchSubtask(sub, pending);
    }, delay);
  };
  const stageUnit = (stageOrder: number | null) => detail?.stages.find((st) => st.stageOrder === stageOrder)?.progressUnitPct ?? 10;
  const applyTemplate = async (templateId: string) => {
    if (!detail || templateBusy) return;
    setTemplateBusy(true);
    try {
      const r = await apiCall<{ item: TodoItemDetail; created: number }>(`/api/todo/items/${encodeURIComponent(detail.itemId)}/apply-template`, {
        method: "POST",
        body: JSON.stringify({ templateId }),
      });
      setDetail(r.item);
      onItemChanged(r.item);
      toast(`하위 작업 ${r.created}건을 추가했습니다.`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setTemplateBusy(false);
    }
  };
  const saveAsTemplate = async () => {
    if (!detail || !detail.subtasks.length) {
      toast("저장할 하위 작업이 없습니다.", "info");
      return;
    }
    const name = window.prompt("템플릿 이름(예: 착수 보고 준비)", detail.title.slice(0, 40));
    if (!name?.trim()) return;
    const toBoard = detail.boardKind !== "personal" && window.confirm(`"${detail.boardName}" 보드 멤버와 공유하는 보드 템플릿으로 저장할까요?\n(취소 = 내 개인 템플릿)`);
    setTemplateBusy(true);
    try {
      await apiCall("/api/todo/templates", { method: "POST", body: JSON.stringify({ name: name.trim(), fromItemId: detail.itemId, boardId: toBoard ? detail.boardId : null }) });
      await loadTemplates(detail.boardKind !== "personal" ? detail.boardId : null);
      toast("템플릿으로 저장했습니다.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setTemplateBusy(false);
    }
  };
  const removeTemplate = async (templateId: string, name: string) => {
    if (!window.confirm(`템플릿 "${name}"을 삭제할까요?`)) return;
    try {
      await apiCall(`/api/todo/templates/${encodeURIComponent(templateId)}`, { method: "DELETE" });
      setTemplates((t) => (t ? t.filter((x) => x.templateId !== templateId) : t));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const toggleSubtask = async (sub: TodoItem) => {
    try {
      await apiCall(`/api/todo/items/${encodeURIComponent(sub.itemId)}/complete`, { method: "POST", body: JSON.stringify({ done: sub.status !== "done" }) });
      await refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  // 하위 작업 삭제 — window.confirm 대신 같은 자리에 "삭제?" + [삭제]/[취소] 를 2초 노출(인라인 확인). 시간이 지나면 자동으로 닫힌다.
  const subConfirmTimer = useRef<number | null>(null);
  const askRemoveSubtask = (sub: TodoItem) => {
    if (subConfirmTimer.current) window.clearTimeout(subConfirmTimer.current);
    setSubConfirmId(sub.itemId);
    subConfirmTimer.current = window.setTimeout(() => setSubConfirmId((cur) => (cur === sub.itemId ? null : cur)), 2000);
  };
  const cancelRemoveSubtask = () => {
    if (subConfirmTimer.current) window.clearTimeout(subConfirmTimer.current);
    subConfirmTimer.current = null;
    setSubConfirmId(null);
  };
  useEffect(
    () => () => {
      if (subConfirmTimer.current) window.clearTimeout(subConfirmTimer.current);
    },
    []
  );
  const removeSubtask = async (sub: TodoItem) => {
    cancelRemoveSubtask();
    try {
      await apiCall(`/api/todo/items/${encodeURIComponent(sub.itemId)}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const duplicate = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const d = await apiCall<{ item: TodoItemDetail }>(`/api/todo/items`, {
        method: "POST",
        body: JSON.stringify({
          title: `${detail.title} (복사)`,
          note: detail.note,
          priority: detail.priority,
          doDate: detail.doDate,
          doTime: detail.doTime,
          durationMin: detail.durationMin,
          dueDate: detail.dueDate,
          recurrence: detail.recurrence,
          linkKind: detail.linkKind,
          linkId: detail.linkId,
          linkLabel: detail.linkLabel,
          color: detail.color,
          boardId: detail.boardId,
          columnId: detail.columnId,
        }),
      });
      onItemCreated(d.item);
      toast("복제했습니다", "success");
      onOpenItem(d.item.itemId);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await apiCall(`/api/todo/items/${encodeURIComponent(detail.itemId)}`, { method: "DELETE" });
      onItemDeleted(detail.itemId);
      setDeleteOpen(false);
      onClose();
      toast("삭제했습니다", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const openChat = async () => {
    setChatOpen(true);
    if (rooms) return;
    try {
      const d = await apiCall<{ rooms: { roomId: number; name: string; roomType: string; memberCount: number }[] }>("/api/chat/rooms");
      setRooms(d.rooms ?? []);
    } catch (e) {
      toast((e as Error).message, "error");
      setRooms([]);
    }
  };

  const sendChat = async (roomId: number) => {
    if (!detail) return;
    setBusy(true);
    try {
      await apiCall(`/api/todo/items/${encodeURIComponent(detail.itemId)}/send-chat`, { method: "POST", body: JSON.stringify({ roomId }) });
      setChatOpen(false);
      toast("메신저로 보냈습니다", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const commitTitle = () => {
    const t = title.trim();
    if (!detail || !t) {
      setTitle(detail?.title ?? "");
      return;
    }
    if (t !== detail.title) schedule({ title: t }, true);
  };

  const commitTime = () => {
    if (!detail) return;
    const raw = timeDraft.trim();
    if (!raw) {
      if (detail.doTime) schedule({ doTime: null, durationMin: null });
      return;
    }
    const t = normalizeTime(raw);
    if (!t) {
      toast("시각은 HH:mm 으로 입력하세요.", "warn");
      setTimeDraft(detail.doTime ?? "");
      return;
    }
    setTimeDraft(t);
    if (t !== detail.doTime) schedule({ doTime: t, doDate: detail.doDate && isValidDateString(detail.doDate) ? detail.doDate : today, durationMin: detail.durationMin ?? 30 });
  };

  const openEditor = (key: PropKey) => {
    if (!canEdit || !detail) return;
    if (key === "recurrence") {
      const spec = parseRecurrence(detail.recurrence);
      setRecDraft({
        preset: !spec ? "" : spec.type === "monthly" && spec.day === "last" ? "monthly_last" : spec.type,
        days: spec?.type === "weekly" ? spec.days.map((d) => TODO_WEEKDAY_CODES[d] ?? "MO") : ["MO"],
        day: spec?.type === "monthly" && spec.day !== "last" ? String(spec.day) : "1",
        after: spec?.type === "after" ? String(spec.days) : "7",
      });
    }
    setEditing(key);
  };

  const applyRecurrence = (next: typeof recDraft) => {
    setRecDraft(next);
    let rule: string | null = null;
    switch (next.preset) {
      case "":
        rule = null;
        break;
      case "daily":
      case "weekdays":
        rule = next.preset;
        break;
      case "weekly":
        rule = next.days.length ? `weekly:${[...next.days].sort((a, b) => TODO_WEEKDAY_CODES.indexOf(a as (typeof TODO_WEEKDAY_CODES)[number]) - TODO_WEEKDAY_CODES.indexOf(b as (typeof TODO_WEEKDAY_CODES)[number])).join(",")}` : null;
        break;
      case "monthly": {
        const d = Number(next.day);
        rule = d >= 1 && d <= 31 ? `monthly:${d}` : null;
        break;
      }
      case "monthly_last":
        rule = "monthly:last";
        break;
      case "after": {
        const n = Number(next.after);
        rule = n >= 1 ? `after:${n}` : null;
        break;
      }
    }
    if (next.preset === "" || rule) schedule({ recurrence: rule });
  };

  const onRootKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey && /^[1-5]$/.test(e.key) && canEdit) {
      e.preventDefault();
      changeStatus(TODO_STATUSES[Number(e.key) - 1]);
    }
  };

  const dueHint = detail?.dueDate && detail.status !== "done" ? diffDays(today, detail.dueDate) : null;
  const subDone = detail?.subtasks.filter((s) => s.status === "done").length ?? 0;
  const subTotal = detail?.subtasks.length ?? 0;
  const subPct = subTotal ? Math.round((subDone / subTotal) * 100) : 0;
  const targetBoard = board;
  const moveHint = targetBoard && targetBoard.kind !== "personal" ? `${TODO_BOARD_KIND_LABELS[targetBoard.kind]} 보드의 멤버 ${targetBoard.memberCount}명에게 보입니다` : null;
  const otherSharedBoard = boards.find((b) => b.kind !== "personal" && b.myRole !== "viewer");
  const shares = detail?.shares.filter((s) => s.role !== "assignee") ?? [];
  useEffect(() => {
    if (pickerRole !== "assignee" || !detail || detail.boardKind === "personal") {
      setBoardMembers(null);
      return;
    }
    let alive = true;
    apiCall<{ members: { userId: string; name: string }[] }>(`/api/todo/boards/${encodeURIComponent(detail.boardId)}/members`)
      .then((d) => {
        if (alive) setBoardMembers(d.members.map((m) => ({ userId: m.userId, name: m.name })));
      })
      .catch(() => {
        if (alive) setBoardMembers([]);
      });
    return () => {
      alive = false;
    };
  }, [pickerRole, detail]);
  const assigneeCandidates = useMemo(() => {
    if (!detail) return [];
    const seen = new Set<string>();
    const out: { userId: string; name: string }[] = [];
    const add = (userId: string | null | undefined, name: string | null | undefined) => {
      if (!userId || seen.has(userId)) return;
      seen.add(userId);
      out.push({ userId, name: name ?? userId });
    };
    add(detail.ownerUserId, detail.ownerName ? `${detail.ownerName} (작성자)` : "작성자");
    for (const sh of detail.shares) add(sh.userId, sh.name);
    for (const m of boardMembers ?? []) add(m.userId, m.name);
    return out;
  }, [detail, boardMembers]);
  const reportSubject = detail?.reportSubject ?? null;
  const reportSubjectId = detail?.linkId ?? null;
  useEffect(() => {
    if (!reportSubject || !reportSubjectId) {
      setReports(null);
      return;
    }
    let alive = true;
    const url = reportSubject === "task" ? `/api/work-tasks/${encodeURIComponent(reportSubjectId)}/reports` : `/api/work-plan/service/${encodeURIComponent(reportSubjectId)}/reports`;
    apiCall<{ reports: { reportId: string; periodStart: string; periodEnd: string; status: string }[] }>(url)
      .then((d) => {
        if (alive) setReports((d.reports ?? []).slice(0, 2));
      })
      .catch(() => {
        if (alive) setReports([]);
      });
    return () => {
      alive = false;
    };
  }, [reportSubject, reportSubjectId, detail?.activity.length]);
  const createReportDraft = async () => {
    if (!detail || reportBusy) return;
    const hasDraft = detail.activity.some((a) => a.action === "work_report") && reports?.some((r) => r.status === "draft");
    if (hasDraft && !window.confirm("이 할 일로 만든 미제출 초안이 있습니다. 지금 내용으로 초안을 다시 채울까요?")) return;
    setReportBusy(true);
    try {
      const r = await apiCall<{ reportId: string; href: string; updated: boolean; aiUsed: boolean; periodStart: string; periodEnd: string }>(
        `/api/todo/items/${encodeURIComponent(detail.itemId)}/work-report`,
        { method: "POST", body: JSON.stringify({ ai: true }) }
      );
      toast(`${r.updated ? "초안을 갱신했습니다" : "업무 보고 초안을 만들었습니다"}(${r.periodStart} ~ ${r.periodEnd}${r.aiUsed ? " · AI 요약" : " · 규칙 직안"}). 검토 후 제출하세요.`, "success");
      router.push(r.href);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setReportBusy(false);
    }
  };
  // 댓글 입력란의 "나" 아바타 — 새 API 없이: 목록에서 넘어온 사진(myPhotoUrl) → 상세 응답의 owner·담당·공유·댓글 중 내 userId 와 같은 사진.
  const me = useMemo(() => {
    let photo = myPhotoUrl ?? null;
    let name = myName ?? null;
    if (detail && myUserId) {
      if (!photo && detail.ownerUserId === myUserId) photo = detail.ownerPhotoUrl;
      if (!photo && detail.assigneeUserId === myUserId) photo = detail.assigneePhotoUrl;
      if (!photo) photo = detail.shares.find((s) => s.userId === myUserId)?.photoUrl ?? null;
      if (!photo) photo = detail.comments.find((c) => c.userId === myUserId)?.userPhotoUrl ?? null;
      if (!name && detail.ownerUserId === myUserId) name = detail.ownerName;
      if (!name && detail.assigneeUserId === myUserId) name = detail.assigneeName;
      if (!name) name = detail.shares.find((s) => s.userId === myUserId)?.name ?? detail.comments.find((c) => c.userId === myUserId)?.userName ?? null;
    }
    return { name: name || "나", photo };
  }, [detail, myUserId, myName, myPhotoUrl]);
  const projectLabel = detail ? (detail.projectName ?? (detail.boardKind === "personal" ? "개인" : detail.boardName)) : "";

  const saveLabel = saveState === "saving" ? "저장 중…" : saveState === "error" ? "저장하지 못했습니다" : saveState === "saved" ? `저장됨 · ${savedAt ? relativeTime(new Date(savedAt).toISOString()) : "방금"}` : "변경 시 자동 저장";

  const footer = (
    <div className="todo-df">
      <span className="todo-save-state" data-state={saveState} aria-live="polite">
        <i aria-hidden="true" />
        {saveLabel}
        {saveState === "error" && (
          <button type="button" onClick={() => void flush()}>
            재시도
          </button>
        )}
      </span>
    </div>
  );

  const moreMenu: CdMenuItem[] = [
    { key: "chat", label: "메신저로 공유", icon: <MessageCircle className="w-3.5 h-3.5" />, onSelect: () => void openChat() },
    { key: "dup", label: "복제", icon: <Copy className="w-3.5 h-3.5" />, disabled: busy, onSelect: () => void duplicate() },
    // 보관: PATCH 에 archived 가 없어 메뉴에서 뺀다(완료 30일 뒤 자동 보관).
    { key: "del", label: "삭제", icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, disabled: !detail?.isOwner, onSelect: () => setDeleteOpen(true) },
  ];

  const kv = (label: string, key: PropKey | null, content: ReactNode, editor?: ReactNode) => (
    <div className="todo-kv">
      <span className="todo-kv-lb">{label}</span>
      {key && editing === key && editor ? (
        <PropEditor onDone={() => setEditing(null)}>{editor}</PropEditor>
      ) : key && canEdit ? (
        <button type="button" className="todo-kv-v" onClick={() => openEditor(key)} aria-label={`${label} 편집`}>
          {content}
        </button>
      ) : (
        <div className="todo-kv-v" data-static="true">
          {content}
        </div>
      )}
    </div>
  );

  // 부가 설정 접힘 요약(2026-10-14) — 한 줄 나열 대신 라벨+값 세로 쌍 3열 2행: 우선순위·알림·반복 / 보드·공유·스누즈.
  const extraSummary = detail && (
    <div className="todo-xs" role="list">
      {(
        [
          ["우선순위", TODO_PRIORITY_LABELS[detail.priority], false],
          ["알림", detail.remindAt ? `${fmtIsoShort(detail.remindAt)}${remindMode === "default" && detail.doTime ? ` (${prefs?.defaultRemindBeforeMin ?? 30}분 전)` : ""}` : "끔", !detail.remindAt],
          ["반복", describeRecurrence(detail.recurrence) ?? "없음", !detail.recurrence],
          ["보드", `${board ? (board.kind === "personal" ? "개인" : (board.projectName ?? board.name)) : "보드"} › ${column ? column.name : "열 미배정"}`, false],
          ["공유", shares.length ? shares.map((s) => `${s.name || s.userId}(${s.role === "collaborator" ? "협업" : "참조"})`).join(", ") : "없음", shares.length === 0],
          ["스누즈", detail.snoozedUntil ? `${fmtIsoShort(detail.snoozedUntil)}까지` : "없음", !detail.snoozedUntil],
          // 완료 조건(276)은 설정된 것만 요약에 보인다.
          ...(completeRulesSummary(detail.completeRules) ? [["완료 조건", completeRulesSummary(detail.completeRules) as string, false]] : []),
        ] as [string, string, boolean][]
      ).map(([lb, v, none]) => (
        <div key={lb} className="todo-xs-it" role="listitem">
          <span className="todo-xs-lb">{lb}</span>
          <span className="todo-xs-v" data-none={none ? "true" : undefined} title={v}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );

  const inner = (
    <>
      <div className={`todo-vars ${mode === "page" ? "todo-detail-page" : "todo-drawer"}`} onKeyDown={onRootKey}>
        {loading && !detail && <div className="todo-loading">불러오는 중…</div>}
        {loadError && !detail && (
          <div className="flex flex-col gap-2 items-start p-4">
            <p className="text-sm cd-error-text">{loadError}</p>
            <CdButton variant="soft" size="sm" onClick={() => void load()}>
              다시 시도
            </CdButton>
          </div>
        )}
        {detail && (
          <>
            {/* 헤더 — 좌측 5px 보드 색 띠 */}
            <div className="todo-dh" style={tintStyle(detail.boardColor)}>
              <TodoCheck done={detail.status === "done"} size="lg" status={detail.status} onClick={() => void complete(detail.status !== "done")} />
              <div className="todo-dh-main">
                <input
                  className="todo-detail-title"
                  value={title}
                  readOnly={!canEdit}
                  aria-label="제목"
                  maxLength={200}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
                <span className="todo-dh-pj" title={projectLabel}>
                  <span>{projectLabel}</span>
                </span>
              </div>
              <CdDropdown
                trigger={() => (
                  <button type="button" className="cd-icon-button cd-icon-button-sm inline-flex items-center justify-center" aria-label="더 보기">
                    <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
                items={moreMenu}
              />
              {mode === "page" ? (
                <>
                  <span className="todo-page-save todo-save-state" data-state={saveState} aria-live="polite">
                    <i aria-hidden="true" />
                    {saveLabel}
                    {saveState === "error" && (
                      <button type="button" onClick={() => void flush()}>
                        재시도
                      </button>
                    )}
                  </span>
                  <button type="button" className="todo-page-back" onClick={close} title="할 일 목록으로">
                    <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                    목록으로
                  </button>
                </>
              ) : (
                <CdIconButton label="닫기" size="sm" onClick={close}>
                  <X className="w-4 h-4" aria-hidden="true" />
                </CdIconButton>
              )}
            </div>

            <div className="todo-db">
              {/* 완료됨 줄(276) — 완료 시각 · 되돌리기 · 완료 메모 */}
              {detail.status === "done" && (
                <div className="todo-done-ln" role="status">
                  <CheckCircle2 aria-hidden="true" />
                  <b>완료됨</b>
                  {detail.completedAt && <span>· {fmtIsoShort(detail.completedAt)}</span>}
                  {detail.archivedAt && <span className="todo-mu">· 보관됨</span>}
                  {canEdit && (
                    <>
                      <span>·</span>
                      <button type="button" className="todo-link" disabled={busy} onClick={() => void complete(false)}>
                        되돌리기
                      </button>
                    </>
                  )}
                  {detail.completionNote && <span className="todo-done-note">{detail.completionNote}</span>}
                </div>
              )}

              {/* ① 핵심 2×2 */}
              <section className="cd-card todo-fr" aria-label="핵심 정보">
                <div className="todo-key">
                  <div className="todo-kv">
                    <span className="todo-kv-lb">상태</span>
                    {canEdit ? (
                      <CdDropdown
                        align="left"
                        className="todo-kv-dd"
                        menuWidthClass="w-40"
                        trigger={() => (
                          <button type="button" className="todo-kv-v" aria-label="상태 변경">
                            <span className="todo-st" data-tone={detail.status}>
                              {TODO_STATUS_LABELS[detail.status]}
                            </span>
                            <ChevronDown className="todo-car" aria-hidden="true" />
                          </button>
                        )}
                        items={TODO_STATUSES.map((s, i) => ({
                          key: s,
                          label: `${TODO_STATUS_LABELS[s]} (Alt+${i + 1})`,
                          icon: <span className="todo-st" data-tone={s} style={{ width: 10, height: 10, padding: 0, borderRadius: 3 }} aria-hidden="true" />,
                          disabled: detail.status === s,
                          onSelect: () => changeStatus(s),
                        }))}
                      />
                    ) : (
                      <div className="todo-kv-v" data-static="true">
                        <span className="todo-st" data-tone={detail.status}>
                          {TODO_STATUS_LABELS[detail.status]}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="todo-kv">
                    <span className="todo-kv-lb">담당</span>
                    {canEdit ? (
                      <CdDropdown
                        align="left"
                        className="todo-kv-dd"
                        menuWidthClass="w-44"
                        trigger={() => (
                          <button type="button" className="todo-kv-v" aria-label="담당 변경">
                            {detail.assigneeUserId ? (
                              <>
                                <CdAvatar name={detail.assigneeName ?? "?"} src={detail.assigneePhotoUrl} size="xs" className="todo-av" />
                                {detail.assigneeName ?? detail.assigneeUserId}
                              </>
                            ) : (
                              <span className="todo-mu">담당 없음</span>
                            )}
                            <ChevronDown className="todo-car" aria-hidden="true" />
                          </button>
                        )}
                        items={[
                          { key: "pick", label: detail.assigneeUserId ? "담당 변경" : "담당 지정", onSelect: () => setPickerRole("assignee") },
                          {
                            key: "clear",
                            label: "작성자에게 되돌리기",
                            disabled: !detail.assigneeUserId || detail.assigneeUserId === detail.ownerUserId,
                            onSelect: () => schedule({ assigneeUserId: null }, true),
                          },
                        ]}
                      />
                    ) : (
                      <div className="todo-kv-v" data-static="true">
                        {detail.assigneeUserId ? (
                          <>
                            <CdAvatar name={detail.assigneeName ?? "?"} src={detail.assigneePhotoUrl} size="xs" className="todo-av" />
                            {detail.assigneeName ?? detail.assigneeUserId}
                          </>
                        ) : (
                          <span className="todo-mu">담당 없음</span>
                        )}
                      </div>
                    )}
                  </div>

                  {kv(
                    "수행 예정",
                    "do",
                    detail.doDate && detail.doDate.length === 10 ? (
                      <>
                        {longDate(detail.doDate)}
                        {detail.doTime ? ` ${detail.doTime}` : ""}
                        {detail.doTime && detail.durationMin ? <span className="todo-mu">· {detail.durationMin}분</span> : null}
                      </>
                    ) : (
                      <>
                        <span className="todo-kv-ph">YYYYMMDD</span>
                        <Calendar className="todo-kv-cal" aria-hidden="true" />
                      </>
                    ),
                    <>
                      <CdDateInput
                        className="todo-w-date"
                        aria-label="할 날짜"
                        value={detail.doDate ?? ""}
                        onChange={(v) => {
                          if (v === "") schedule({ doDate: null, doTime: null, durationMin: null });
                          else if (v.length === 10 && isValidDateString(v)) schedule({ doDate: v });
                          else setDetail((d) => (d ? { ...d, doDate: v } : d));
                        }}
                      />
                      <input className="cd-input todo-w-time" aria-label="시각 HH:mm" placeholder="HH:mm" value={timeDraft} onChange={(e) => setTimeDraft(e.target.value)} onBlur={commitTime} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                      {detail.doTime && (
                        <select className="cd-select todo-w-sel" aria-label="소요 시간" value={detail.durationMin ?? 30} onChange={(e) => schedule({ durationMin: Number(e.target.value) })}>
                          {[30, 60, 90, 120].map((m) => (
                            <option key={m} value={m}>
                              {m}분
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        className="todo-tbtn"
                        onClick={() => {
                          setTimeDraft("");
                          schedule({ doDate: null, doTime: null, durationMin: null });
                        }}
                      >
                        지우기
                      </button>
                    </>
                  )}

                  {kv(
                    "마감",
                    "due",
                    detail.dueDate && detail.dueDate.length === 10 ? (
                      <>
                        {longDate(detail.dueDate)}
                        {dueHint != null && dueHint > 0 && <span className="todo-due" data-tone="over">D+{dueHint}</span>}
                        {dueHint === 0 && <span className="todo-due" data-tone="today">D-Day</span>}
                      </>
                    ) : (
                      <>
                        <span className="todo-kv-ph">YYYYMMDD</span>
                        <Calendar className="todo-kv-cal" aria-hidden="true" />
                      </>
                    ),
                    <>
                      <CdDateInput
                        className="todo-w-date"
                        aria-label="마감일"
                        value={detail.dueDate ?? ""}
                        onChange={(v) => {
                          if (v === "") schedule({ dueDate: null });
                          else if (v.length === 10 && isValidDateString(v)) schedule({ dueDate: v });
                          else setDetail((d) => (d ? { ...d, dueDate: v } : d));
                        }}
                      />
                      <button type="button" className="todo-tbtn" onClick={() => schedule({ dueDate: null })}>
                        지우기
                      </button>
                    </>
                  )}
                </div>
              </section>

              {/* ② 관련 */}
              <section className="cd-card todo-fr" aria-label="관련">
                <h3>관련</h3>
                <div className="todo-rel">
                  {(detail.contractId || detail.projectName) && (
                    <div className="todo-rel-it">
                      <span className="todo-rel-ic" aria-hidden="true">
                        <FileSignature />
                      </span>
                      <div className="todo-rel-tx">
                        <div className="todo-rel-k">용역{detail.contractId ? ` · 계약 ${contractShort(detail.contractId)}` : ""}</div>
                        <div className="todo-rel-n">
                          {detail.projectName ?? detail.linkLabel ?? "계약"}
                          {detail.clientName ? ` · 발주처 ${detail.clientName}` : ""}
                        </div>
                      </div>
                      {detail.contractId && <a href={`/contracts?focus=${encodeURIComponent(detail.contractId)}`}>계약 열기</a>}
                    </div>
                  )}
                  {detail.linkKind === "facility" && (
                    <div className="todo-rel-it">
                      <span className="todo-rel-ic" aria-hidden="true">
                        <Building2 />
                      </span>
                      <div className="todo-rel-tx">
                        <div className="todo-rel-k">사업장</div>
                        <div className="todo-rel-n">{detail.linkLabel ?? detail.linkId ?? "사업장"}</div>
                      </div>
                      {linkHref("facility", detail.linkId) && <a href={linkHref("facility", detail.linkId) ?? "#"}>사업장 열기</a>}
                    </div>
                  )}
                  {detail.linkKind !== "facility" && board?.facilityId && (
                    <div className="todo-rel-it">
                      <span className="todo-rel-ic" aria-hidden="true">
                        <Building2 />
                      </span>
                      <div className="todo-rel-tx">
                        <div className="todo-rel-k">사업장</div>
                        <div className="todo-rel-n">보드에 연결된 사업장</div>
                      </div>
                      <a href={`/facilities?focus=${encodeURIComponent(board.facilityId)}`}>사업장 열기</a>
                    </div>
                  )}
                  {detail.linkKind && detail.linkKind !== "facility" && detail.linkKind !== "contract" && (
                    <div className="todo-rel-it">
                      <span className="todo-rel-ic" aria-hidden="true">
                        <Link2 />
                      </span>
                      <div className="todo-rel-tx">
                        <div className="todo-rel-k">{TODO_LINK_KIND_LABELS[detail.linkKind]}</div>
                        <div className="todo-rel-n">{detail.linkLabel ?? detail.linkId ?? ""}</div>
                      </div>
                      {linkHref(detail.linkKind, detail.linkId) && (
                        <a href={linkHref(detail.linkKind, detail.linkId) ?? "#"} target={detail.linkKind === "url" ? "_blank" : undefined} rel="noreferrer">
                          열기 <ExternalLink className="inline w-3 h-3" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  )}
                  {canEdit && (
                    <div className="flex items-center gap-3">
                      <button type="button" className="todo-rel-add" onClick={() => setLinkOpen(true)}>
                        {detail.linkKind ? "연결 변경" : "+ 계약·사업장·결재 문서·영업·업무추진계획·링크 연결"}
                      </button>
                      {detail.linkKind && (
                        <button type="button" className="todo-rel-add" onClick={() => schedule({ linkKind: null, linkId: null, linkLabel: null }, true)}>
                          연결 해제
                        </button>
                      )}
                    </div>
                  )}
                  {!canEdit && !detail.linkKind && !detail.contractId && !detail.projectName && <span className="todo-mu text-[12.5px]">연결 없음</span>}
                </div>
              </section>

              {/* ③ 메모 */}
              <section className="cd-card todo-fr" aria-label="메모">
                <h3>메모</h3>
                <textarea
                  className="todo-note"
                  aria-label="메모"
                  placeholder={canEdit ? "메모를 적으면 자동 저장됩니다" : "메모 없음"}
                  value={note}
                  readOnly={!canEdit}
                  rows={Math.max(5, Math.min(12, note.split("\n").length + 1))}
                  onChange={(e) => {
                    setNote(e.target.value);
                    schedule({ note: e.target.value.trim() ? e.target.value : null });
                  }}
                />
              </section>

              {/* ④ 하위 작업 */}
              <section className="cd-card todo-fr" aria-label="하위 작업">
                <h3>
                  하위 작업
                  {canEdit && (
                    <span className="todo-tpl-menu" onClick={(e) => e.stopPropagation()}>
                      <CdDropdown
                        align="right"
                        menuWidthClass="w-72"
                        trigger={(open) => (
                          <button
                            type="button"
                            className="todo-tpl-btn"
                            aria-expanded={open}
                            title="체크리스트 템플릿 — 표준 하위 작업 세트를 한 번에 추가"
                            onClick={() => {
                              if (templates === null) void loadTemplates(detail.boardKind !== "personal" ? detail.boardId : null);
                            }}
                          >
                            <LayoutTemplate aria-hidden="true" /> 템플릿
                          </button>
                        )}
                        items={[
                          ...(templates === null
                            ? [{ key: "loading", label: "불러오는 중…", disabled: true, onSelect: () => {} }]
                            : templates.length === 0
                              ? [{ key: "empty", label: "저장된 템플릿이 없습니다", disabled: true, onSelect: () => {} }]
                              : templates.map((t) => ({
                                  key: t.templateId,
                                  label: (
                                    <span className="todo-tpl-item">
                                      <span className="todo-tpl-name">
                                        {t.name}
                                        <span className="todo-tpl-meta">
                                          {t.boardId ? "보드" : "개인"} · {t.items.length}항목
                                        </span>
                                      </span>
                                      {t.canEdit && (
                                        <span
                                          role="button"
                                          tabIndex={0}
                                          className="todo-tpl-del"
                                          title="템플릿 삭제"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void removeTemplate(t.templateId, t.name);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter" || e.key === " ") {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              void removeTemplate(t.templateId, t.name);
                                            }
                                          }}
                                        >
                                          <X aria-hidden="true" />
                                        </span>
                                      )}
                                    </span>
                                  ),
                                  disabled: templateBusy,
                                  onSelect: () => void applyTemplate(t.templateId),
                                }))),
                          { key: "save", label: "현재 하위 작업을 템플릿으로 저장", icon: <Copy className="w-3.5 h-3.5" />, disabled: templateBusy || !detail.subtasks.length, onSelect: () => void saveAsTemplate() },
                        ]}
                      />
                    </span>
                  )}
                  {subTotal > 0 && (
                    <>
                      <span className="todo-sec-n">
                        {subDone}/{subTotal} · {subPct}%
                      </span>
                      <span className="todo-segbar" aria-hidden="true">
                        {(subTotal <= 10
                          ? detail.subtasks.map((s) => (s.status === "done" ? "done" : s.status === "doing" || s.status === "review" ? "doing" : undefined))
                          : Array.from({ length: 10 }, (_, i) => (i < Math.round((subDone / subTotal) * 10) ? "done" : undefined))
                        ).map((s, i) => (
                          <i key={i} data-s={s} />
                        ))}
                      </span>
                      {detail.progressAvg != null && <span className="todo-sec-avg">평균 {detail.progressAvg}%</span>}
                    </>
                  )}
                </h3>
                {detail.subtasks.map((s) => {
                  const st = s.status === "done" ? "done" : s.status === "doing" || s.status === "review" ? "doing" : undefined;
                  const aux = s.dueDate ? (s.dueDate === today ? "오늘" : md(s.dueDate)) : s.assigneeName;
                  const draftPct = subDraft[s.itemId]?.pct ?? s.progressPct ?? 0;
                  const draftNote = subDraft[s.itemId]?.note ?? s.progressNote ?? "";
                  return (
                    <div key={s.itemId} className="todo-sr-wrap">
                    <div className="todo-sr" data-done={s.status === "done" ? "true" : undefined}>
                      <TodoCheck done={s.status === "done"} size="sm" state={st} onClick={() => void toggleSubtask(s)} />
                      <span className="todo-sr-t">{s.title}</span>
                      {st && (
                        <span className="todo-sc" data-s={st}>
                          {st === "done" ? "완료" : "진행 중"}
                        </span>
                      )}
                      {aux && <span className="todo-sd">{aux}</span>}
                      {canEdit &&
                        (subConfirmId === s.itemId ? (
                          <span className="todo-sr-confirm" role="group" aria-label={`${s.title} 삭제 확인`}>
                            삭제?
                            <button type="button" data-tone="error" onClick={() => void removeSubtask(s)}>
                              삭제
                            </button>
                            <button type="button" onClick={cancelRemoveSubtask}>
                              취소
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="todo-sr-del" title="하위 작업 삭제" aria-label={`${s.title} 삭제`} onClick={() => askRemoveSubtask(s)}>
                            <X aria-hidden="true" />
                          </button>
                        ))}
                    </div>
                    {s.status !== "done" && (
                      <div className="todo-sr-prog" data-readonly={!canEdit ? "true" : undefined}>
                        {detail.stages.length > 0 && (
                          <select
                            value={s.stageOrder ?? ""}
                            disabled={!canEdit}
                            aria-label={`${s.title} 공정 단계`}
                            title="관련 계약·업무추진계획의 공정 단계 — 업무 보고 단계 진행율에 반영"
                            onChange={(e) => void patchSubtask(s, { stageOrder: e.target.value ? Number(e.target.value) : null })}
                          >
                            <option value="">단계 없음</option>
                            {detail.stages.map((stg) => (
                              <option key={stg.stageOrder} value={stg.stageOrder}>
                                {stg.stageOrder}. {stg.stageName}
                              </option>
                            ))}
                          </select>
                        )}
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={stageUnit(s.stageOrder)}
                          value={draftPct}
                          disabled={!canEdit}
                          aria-label={`${s.title} 진행율`}
                          onChange={(e) => queueSubtask(s, { progressPct: Number(e.target.value) })}
                        />
                        <span className="todo-sr-pct">{draftPct}%</span>
                        <input
                          className="todo-sr-note"
                          value={draftNote}
                          placeholder="진척 내용(업무 보고 추진내역에 들어갑니다)"
                          disabled={!canEdit}
                          maxLength={2000}
                          aria-label={`${s.title} 진척 내용`}
                          onChange={(e) => queueSubtask(s, { progressNote: e.target.value || null }, 800)}
                        />
                      </div>
                    )}
                    </div>
                  );
                })}
                {canEdit && (
                  <div className="todo-sr" data-add="true">
                    <TodoCheck done={false} size="sm" dashed />
                    <input
                      value={subTitle}
                      placeholder="하위 작업 추가 — Enter"
                      aria-label="하위 작업 추가"
                      disabled={busy}
                      onChange={(e) => setSubTitle(e.target.value)}
                      onCompositionStart={() => {
                        composing.current = true;
                      }}
                      onCompositionEnd={() => {
                        composing.current = false;
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !composing.current && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          void addSubtask();
                        }
                      }}
                    />
                  </div>
                )}
              </section>

              {/* ⑤ 댓글 */}
              <section className="cd-card todo-fr" aria-label="댓글">
                <h3>
                  댓글 {detail.comments.length > 0 && <span className="todo-sec-n">{detail.comments.length}</span>}
                </h3>
                {detail.comments.map((c) => (
                  <div key={c.commentId} className="todo-cm">
                    <CdAvatar name={c.userName ?? "?"} src={c.userPhotoUrl} size="sm" className="todo-av" />
                    <div className="todo-cm-body">
                      <div className="todo-cm-who">
                        <b>{c.userName ?? c.userId}</b>
                        {relativeTime(c.createdAt)}
                      </div>
                      <p>{renderMentions(c.body)}</p>
                    </div>
                  </div>
                ))}
                {detail.comments.length === 0 && <div className="todo-cm-empty">아직 댓글이 없습니다. 공유받은 담당·참조자에게 댓글 알림이 갑니다.</div>}
                {/* 입력란 — 댓글 행과 같은 배치(현재 사용자 아바타 28px + 입력). @이름 멘션 파싱·푸시는 그대로(안내 문구만 제거). */}
                <div className="todo-cm" data-input="true">
                  <CdAvatar name={me.name} src={me.photo} size="sm" className="todo-av" />
                  <div className="todo-cin">
                    <textarea
                      rows={1}
                      value={comment}
                      placeholder="댓글 쓰기"
                      aria-label="댓글"
                      disabled={busy}
                      onChange={(e) => setComment(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          void addComment();
                        }
                      }}
                    />
                    <span className="todo-kbd" aria-hidden="true">
                      Ctrl ⏎
                    </span>
                  </div>
                </div>
              </section>

              {/* ⑥ 부가 설정(접힘) */}
              {/* §25-3 업무 보고 — 관련이 계약/업무추진계획일 때만 활성 */}
              <section className="cd-card todo-fr" data-col="side" aria-label="업무 보고">
                <h3>
                  <ClipboardList className="inline w-4 h-4 mr-1 align-[-2px]" aria-hidden="true" />
                  업무 보고
                </h3>
                {reportSubject ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-[12px] cd-text-muted">
                      메모·하위 작업 진척(공정 단계 포함)으로 {reportSubject === "task" ? "업무추진계획" : "용역"} 보고 초안을 만듭니다. 생성 후 보고 화면에서 검토·제출합니다.
                    </p>
                    {reports && reports.length > 0 && (
                      <ul className="flex flex-col gap-1">
                        {reports.map((r) => (
                          <li key={r.reportId} className="flex items-center gap-2 text-[12.5px]">
                            <span className="todo-sc" data-s={r.status === "submitted" ? "done" : "doing"}>
                              {r.status === "submitted" ? "제출" : "초안"}
                            </span>
                            <Link href={`/work-plan/${encodeURIComponent(r.reportId)}`} className="cd-text hover:underline">
                              {r.periodStart} ~ {r.periodEnd}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    {reports && reports.length === 0 && <p className="text-[12px] cd-text-faint">아직 보고가 없습니다.</p>}
                    {canEdit && (
                      <CdButton variant="soft" size="sm" loading={reportBusy} onClick={() => void createReportDraft()}>
                        업무 보고 초안 만들기
                      </CdButton>
                    )}
                  </div>
                ) : (
                  <p className="text-[12px] cd-text-faint">관련 항목을 계약(용역) 또는 업무추진계획으로 연결하면 업무 보고 초안을 만들 수 있습니다.</p>
                )}
              </section>

              <FoldSection label="부가 설정" col="side" summary={extraSummary} open={extraOpen} onToggle={() => setExtraOpen((v) => !v)}>
                {/* 우선순위 */}
                <div className="todo-pr">
                  <span className="todo-pr-label">우선순위</span>
                  <div className="todo-seg" role="radiogroup" aria-label="우선순위">
                    {([0, 1, 2, 3] as TodoPriority[]).map((p) => (
                      <button key={p} type="button" role="radio" aria-checked={detail.priority === p} className="cd-choice" data-active={detail.priority === p ? "true" : undefined} disabled={!canEdit} onClick={() => schedule({ priority: p }, true)}>
                        {TODO_PRIORITY_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 알림 */}
                <div className="todo-pr" data-top={editing === "remind" ? "true" : undefined}>
                  <span className="todo-pr-label">알림</span>
                  {editing === "remind" ? (
                    <PropEditor onDone={() => setEditing(null)}>
                      <select
                        className="cd-select todo-w-sel"
                        aria-label="알림 방식"
                        value={remindMode}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "off") schedule({ remindAt: null });
                          else if (v === "default") schedule({ remindAt: remindDefault });
                          else schedule({ remindAt: detail.remindAt ?? remindDefault ?? new Date(Date.now() + 3600_000).toISOString() });
                        }}
                      >
                        <option value="default" disabled={!remindDefault}>
                          기본{remindDefault ? ` (${fmtIsoShort(remindDefault)})` : " — 날짜 필요"}
                        </option>
                        <option value="custom">사용자 지정</option>
                        <option value="off">끔</option>
                      </select>
                      {remindMode === "custom" && (
                        <input
                          type="datetime-local"
                          className="cd-input todo-w-grow"
                          aria-label="알림 시각"
                          value={isoToLocalInput(detail.remindAt)}
                          onChange={(e) => {
                            const d = new Date(e.target.value);
                            if (!Number.isNaN(d.getTime())) schedule({ remindAt: d.toISOString() });
                          }}
                        />
                      )}
                      {detail.remindAt && (
                        <span className="todo-snooze" aria-label="스누즈">
                          {TODO_SNOOZE_PRESETS.map((p) => (
                            <button key={p.key} type="button" className="todo-tbtn" onClick={() => void snooze(p.key)}>
                              {p.label}
                            </button>
                          ))}
                        </span>
                      )}
                    </PropEditor>
                  ) : canEdit ? (
                    <button type="button" className="todo-pr-val" onClick={() => openEditor("remind")} aria-label="알림 편집">
                      {detail.remindAt ? (
                        <>
                          {fmtIsoShort(detail.remindAt)}
                          <span className="todo-mu">
                            · {remindMode === "default" ? (detail.doTime ? `${prefs?.defaultRemindBeforeMin ?? 30}분 전` : "기본") : "사용자 지정"}
                            {detail.snoozedUntil ? " · 스누즈" : ""}
                            {detail.remindSentAt ? " · 발송됨" : ""}
                          </span>
                        </>
                      ) : (
                        <span className="todo-mu">끔</span>
                      )}
                    </button>
                  ) : (
                    <div className="todo-pr-val" data-static="true">
                      {detail.remindAt ? fmtIsoShort(detail.remindAt) : <span className="todo-mu">끔</span>}
                    </div>
                  )}
                </div>

                {/* 반복 */}
                <div className="todo-pr" data-top={editing === "recurrence" ? "true" : undefined}>
                  <span className="todo-pr-label">반복</span>
                  {editing === "recurrence" ? (
                    <PropEditor onDone={() => setEditing(null)}>
                      <select className="cd-select todo-w-sel" aria-label="반복" value={recDraft.preset} onChange={(e) => applyRecurrence({ ...recDraft, preset: e.target.value })}>
                        <option value="">없음</option>
                        {TODO_RECURRENCE_PRESETS.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      {recDraft.preset === "weekly" && (
                        <span className="todo-weekday-grid" role="group" aria-label="요일">
                          {TODO_WEEKDAY_CODES.map((c, i) => (
                            <button
                              key={c}
                              type="button"
                              className="cd-choice"
                              data-active={recDraft.days.includes(c) ? "true" : undefined}
                              aria-pressed={recDraft.days.includes(c)}
                              onClick={() => applyRecurrence({ ...recDraft, days: recDraft.days.includes(c) ? recDraft.days.filter((d) => d !== c) : [...recDraft.days, c] })}
                            >
                              {TODO_WEEKDAY_LABELS[i]}
                            </button>
                          ))}
                        </span>
                      )}
                      {recDraft.preset === "monthly" && (
                        <>
                          <span className="todo-mu">매월</span>
                          <input className="cd-input todo-w-num" inputMode="numeric" aria-label="일" value={recDraft.day} onChange={(e) => applyRecurrence({ ...recDraft, day: e.target.value })} />
                          <span className="todo-mu">일</span>
                        </>
                      )}
                      {recDraft.preset === "after" && (
                        <>
                          <span className="todo-mu">완료 후</span>
                          <input className="cd-input todo-w-num" inputMode="numeric" aria-label="일수" value={recDraft.after} onChange={(e) => applyRecurrence({ ...recDraft, after: e.target.value })} />
                          <span className="todo-mu">일</span>
                        </>
                      )}
                    </PropEditor>
                  ) : canEdit ? (
                    <button type="button" className="todo-pr-val" onClick={() => openEditor("recurrence")} aria-label="반복 편집">
                      {describeRecurrence(detail.recurrence) ?? <span className="todo-mu">없음</span>}
                    </button>
                  ) : (
                    <div className="todo-pr-val" data-static="true">
                      {describeRecurrence(detail.recurrence) ?? <span className="todo-mu">없음</span>}
                    </div>
                  )}
                </div>

                {/* 보드 · 열 */}
                <div className="todo-pr" data-top={editing === "board" ? "true" : undefined}>
                  <span className="todo-pr-label">보드</span>
                  {editing === "board" ? (
                    <PropEditor onDone={() => setEditing(null)}>
                      <select
                        className="cd-select todo-w-sel"
                        aria-label="보드"
                        value={detail.boardId}
                        disabled={!detail.isOwner}
                        onChange={(e) => {
                          const b = boards.find((x) => x.boardId === e.target.value);
                          if (!b) return;
                          schedule({ boardId: b.boardId, columnId: null }, true);
                        }}
                      >
                        {boards
                          .filter((b) => b.myRole !== "viewer" || b.boardId === detail.boardId)
                          .map((b) => (
                            <option key={b.boardId} value={b.boardId}>
                              {b.kind === "personal" ? "개인 보드" : `${TODO_BOARD_KIND_LABELS[b.kind]} · ${b.projectName ?? b.name}`}
                            </option>
                          ))}
                      </select>
                      <select className="cd-select todo-w-sel" aria-label="열" value={detail.columnId ?? ""} onChange={(e) => schedule({ columnId: e.target.value || null }, true)}>
                        <option value="">열 미배정</option>
                        {(board?.columns ?? []).map((c) => (
                          <option key={c.columnId} value={c.columnId}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {!detail.isOwner && <span className="todo-mu">다른 보드로 옮기는 것은 만든 사람만 할 수 있습니다</span>}
                    </PropEditor>
                  ) : canEdit ? (
                    <button type="button" className="todo-pr-val" onClick={() => openEditor("board")} aria-label="보드 편집">
                      {board ? (board.kind === "personal" ? "개인" : (board.projectName ?? board.name)) : "보드"}
                      <span className="todo-mu">›</span>
                      {column ? column.name : <span className="todo-mu">열 미배정</span>}
                    </button>
                  ) : (
                    <div className="todo-pr-val" data-static="true">
                      {board ? (board.kind === "personal" ? "개인" : (board.projectName ?? board.name)) : "보드"}
                      <span className="todo-mu">›</span>
                      {column ? column.name : <span className="todo-mu">열 미배정</span>}
                    </div>
                  )}
                </div>
                {(moveHint || otherSharedBoard) && (
                  <div className="todo-pr">
                    <span className="todo-pr-label" />
                    <div className="todo-pr-val" data-static="true">
                      <span className="todo-mu">{moveHint ?? `${TODO_BOARD_KIND_LABELS[otherSharedBoard!.kind]} 보드로 이동하면 멤버 ${otherSharedBoard!.memberCount}명에게 보입니다`}</span>
                    </div>
                  </div>
                )}

                {/* 완료 조건(276) — 상위 작업만. 체크 즉시 저장. */}
                {!detail.parentItemId && (
                  <div className="todo-pr" data-top="true">
                    <span className="todo-pr-label">완료 조건</span>
                    <div className="todo-pr-val" data-static="true">
                      <CompleteRulesFields value={detail.completeRules} disabled={!canEdit} hints onChange={(next) => schedule({ completeRules: next }, true)} />
                    </div>
                  </div>
                )}

                {/* 공유 */}
                <div className="todo-pr">
                  <span className="todo-pr-label">공유</span>
                  <div className="todo-pr-val" data-static="true">
                    {shares.map((s) => (
                      <span key={s.userId} className="todo-chip">
                        <CdAvatar name={s.name || "?"} src={s.photoUrl} size="xs" className="todo-av" />
                        {s.name || s.userId}
                        {canEdit ? (
                          <select aria-label={`${s.name} 역할`} value={s.role} onChange={(e) => void share(s.userId, e.target.value as TodoShareRole).catch((err: Error) => toast(err.message, "error"))}>
                            <option value="collaborator">협업</option>
                            <option value="watcher">참조</option>
                          </select>
                        ) : (
                          <span className="todo-chip-role">{s.role === "collaborator" ? "협업" : "참조"}</span>
                        )}
                        {(detail.isOwner || s.userId === myUserId) && (
                          <button type="button" aria-label={`${s.name} 공유 해제`} onClick={() => void unshare(s.userId)}>
                            <X aria-hidden="true" />
                          </button>
                        )}
                      </span>
                    ))}
                    {canEdit && (
                      <button type="button" className="todo-chip" data-add="true" onClick={() => setPickerRole("watcher")}>
                        + 추가
                      </button>
                    )}
                    {!canEdit && shares.length === 0 && <span className="todo-mu">없음</span>}
                  </div>
                </div>
              </FoldSection>

              {/* ⑦ 활동(접힘) */}
              <FoldSection
                label="활동"
                col="side"
                count={detail.activity.length}
                summary={
                  detail.activity.length === 0 ? (
                    "기록 없음"
                  ) : (
                    // 접힘 요약 — 최근 2건을 행마다 줄바꿈(시각 72px 열 + 내용), 펼치면 전체.
                    <>
                      {detail.activity.slice(0, 2).map((a) => (
                        <div key={a.activityId} className="todo-activity">
                          <span className="todo-activity-when">{relativeTime(a.createdAt)}</span>
                          <span>
                            {a.userName ?? "시스템"} · {describeActivity(a)}
                          </span>
                        </div>
                      ))}
                    </>
                  )
                }
                open={activityOpen}
                onToggle={() => setActivityOpen((v) => !v)}
              >
                {detail.activity.map((a) => (
                  <div key={a.activityId} className="todo-activity">
                    <span className="todo-activity-when">{relativeTime(a.createdAt)}</span>
                    <span>
                      {a.userName ?? "시스템"} · {describeActivity(a)}
                    </span>
                  </div>
                ))}
              </FoldSection>
            </div>
          </>
        )}
      </div>

      {/* 사람 추가 */}
      <PeoplePickerModal
        open={!!pickerRole}
        title={pickerRole === "assignee" ? "담당 지정" : "공유 추가"}
        withRole={pickerRole !== "assignee"}
        defaultRole={pickerRole ?? "watcher"}
        excludeUserIds={[detail?.ownerUserId ?? "", ...(detail?.shares.map((s) => s.userId) ?? [])].filter(Boolean)}
        candidates={pickerRole === "assignee" ? assigneeCandidates : undefined}
        currentUserId={detail?.assigneeUserId ?? null}
        busy={busy}
        onClose={() => setPickerRole(null)}
        onPick={async (people, role) => {
          setBusy(true);
          try {
            if (pickerRole === "assignee") {
              await share(people[0].userId, "assignee");
              for (const p of people.slice(1)) await share(p.userId, "collaborator");
            } else {
              for (const p of people) await share(p.userId, role);
            }
            setPickerRole(null);
          } catch (e) {
            toast((e as Error).message, "error");
          } finally {
            setBusy(false);
          }
        }}
      />

      {/* 완료 확인(276) — 완료 조건이 있거나 서버가 거절했을 때 */}
      <CompleteConfirmModal
        open={confirmOpen}
        target={detail}
        failure={confirmFailure}
        busy={busy}
        onConfirm={(note) => void complete(true, note)}
        onClose={() => {
          if (busy) return;
          setConfirmOpen(false);
          setConfirmFailure(null);
        }}
      />

      {/* 연결 선택 */}
      <LinkPickerModal
        open={linkOpen}
        initialKind={detail?.linkKind ?? null}
        onClose={() => setLinkOpen(false)}
        onPick={(pick) => {
          schedule({ linkKind: pick.linkKind, linkId: pick.linkId, linkLabel: pick.linkLabel }, true);
          setLinkOpen(false);
        }}
      />

      {/* 메신저 방 선택 */}
      <CdModal open={chatOpen} onClose={() => setChatOpen(false)} title="메신저로 공유" size="sm">
        {rooms == null ? (
          <div className="todo-loading">대화방을 불러오는 중…</div>
        ) : rooms.length === 0 ? (
          <p className="text-sm cd-text-muted">참여 중인 대화방이 없습니다.</p>
        ) : (
          <div className="todo-room-list">
            {rooms.map((r) => (
              <button key={r.roomId} type="button" className="todo-room" disabled={busy} onClick={() => void sendChat(r.roomId)}>
                <CdAvatar name={r.name} size="xs" />
                <span className="todo-room-name">{r.name}</span>
                <small>{r.roomType === "dm" ? "1:1" : `${r.memberCount}명`}</small>
              </button>
            ))}
          </div>
        )}
      </CdModal>

      {/* 삭제 확인 */}
      <CdModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="할 일 삭제"
        size="sm"
        footer={
          <>
            <CdButton variant="ghost" onClick={() => setDeleteOpen(false)}>
              취소
            </CdButton>
            <CdButton variant="danger" loading={busy} onClick={() => void remove()}>
              삭제
            </CdButton>
          </>
        }
      >
        <p className="text-sm cd-text">'{detail?.title}' 을(를) 삭제합니다. 하위 작업·댓글·활동 기록이 함께 삭제되며 되돌릴 수 없습니다.</p>
      </CdModal>
    </>
  );
  if (mode === "page") return inner;
  return (
    <CdDrawer open={open} onClose={close} side="right" widthClass="max-w-[580px]" footer={detail ? footer : undefined} closeOnBackdrop>
      {inner}
    </CdDrawer>
  );
}
