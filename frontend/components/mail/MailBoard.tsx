"use client";

// 코넨사인 메일 3-pane 보드(G2) — 폴더 트리 / 메시지 목록 / 본문 뷰어. 작성은 별도 페이지(/mail/compose, G2-8).
// 반응형(§3.0): ≥lg 3-pane(CdSplitPane 중첩) / <lg 폴더 pill + 목록↔뷰어 토글(축소 아닌 재배치).
// 설계: docs/groupware-ux-overhaul-blueprint.md §5.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Columns2, Mail, PenSquare, Rows3 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton, CdIconButton } from "@/components/cdash/CdButton";
import { CdSplitPane } from "@/components/cdash/CdSplitPane";
import { CdTabs } from "@/components/cdash/CdTabs";
import { useCdToast } from "@/components/cdash/CdToast";
import { MailFolderPane } from "@/components/mail/MailFolderPane";
import { MailListPane, type BulkAction } from "@/components/mail/MailListPane";
import { MailViewerPane } from "@/components/mail/MailViewerPane";
import { MailReceiptsPane } from "@/components/mail/MailReceiptsPane";
import { MailSettingsPane } from "@/components/mail/MailSettingsPane";
import { MailSenderMenu, type MailSenderMenuState } from "@/components/mail/MailSenderMenu";
import { QuickContactModal } from "@/components/directory/QuickContactModal";
import { PAGE_SIZE_OPTIONS, PaginationControls, usePageSize } from "@/components/ui/PaginationControls";
import type { MailboxUsage, MailFolderInfo, MailListItem, MailMessageDetail } from "@/lib/mail/messages";
import type { MailCategory } from "@/lib/mail/categories";
import type { MailDraft } from "@/lib/mail/drafts";
import "@/components/cdash/cdash.css";

export function MailBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [address, setAddress] = useState("");
  const [folders, setFolders] = useState<MailFolderInfo[]>([]);
  const [categories, setCategories] = useState<MailCategory[]>([]);
  const [usage, setUsage] = useState<MailboxUsage | null>(null);
  // 보낸 사람 팝업(10-21) — 열린 주소·위치, 발신자별 자동 분류 규칙(주소 → 분류 폴더 id).
  const [senderMenu, setSenderMenu] = useState<MailSenderMenuState | null>(null);
  const [senderRules, setSenderRules] = useState<Record<string, string>>({});
  // 주소록 간이 등록(2026-11-12) — 주소 메뉴의 [주소록 추가]가 연다.
  const [quickContact, setQuickContact] = useState<{ address: string; name: string | null } | null>(null);
  // 폴더·연 메일은 주소(?folder=&id=)가 기준이다(2026-11-12) — 첫 화면도 주소에서 읽는다(답장 쓰기에서 뒤로 오면 그대로 복원).
  const [folder, setFolder] = useState(() => searchParams.get("folder") || "inbox");
  const [activeCategory, setActiveCategory] = useState(""); // 받은편지함 카테고리 필터
  const [items, setItems] = useState<MailListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = usePageSize("mail-page-size");
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<MailMessageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isWide, setIsWide] = useState(true);
  const [mobileView, setMobileView] = useState<"list" | "viewer">("list");
  // 넓은 화면 보기(10-16): list = 목록형(전체 폭 1줄, 열면 목록 자리에 본문) / split = 좌우 분할(기존). 사람별로 기억.
  const [viewMode, setViewMode] = useState<"list" | "split">("list");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("mail-view-mode");
      if (saved === "split" || saved === "list") setViewMode(saved);
    } catch {
      /* 저장소 차단 — 기본값 유지 */
    }
  }, []);
  const changeViewMode = (m: "list" | "split") => {
    setViewMode(m);
    setMobileView("list");
    try {
      window.localStorage.setItem("mail-view-mode", m);
    } catch {
      /* noop */
    }
  };
  const changePageSize = (n: number) => {
    setPageSize(n);
    setOffset(0);
  };
  const listMode = isWide && viewMode === "list";

  // 반응형 감지(lg=1024).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      const r = await fetch("/api/mail/folders");
      if (r.ok) {
        const d = await r.json();
        // 사용자 폴더(카테고리)는 별도 트리로 표시 — 시스템 폴더만.
        const all = Array.isArray(d.folders) ? (d.folders as MailFolderInfo[]) : [];
        setFolders(all.filter((f) => f.systemKind));
        if (d.address) setAddress(String(d.address));
        setUsage(d.usage ?? null);
      }
      const c = await fetch("/api/mail/categories");
      if (c.ok) {
        const d = await c.json();
        setCategories(Array.isArray(d.categories) ? d.categories : []);
      }
    } catch {
      /* noop */
    }
  }, []);

  const loadSenderRules = useCallback(async () => {
    try {
      const r = await fetch("/api/mail/sender-rules");
      if (!r.ok) return;
      const d = await r.json();
      const map: Record<string, string> = {};
      for (const x of Array.isArray(d.rules) ? d.rules : []) map[String(x.sender)] = String(x.categoryId);
      setSenderRules(map);
    } catch {
      /* noop — 규칙 표시만 빠진다 */
    }
  }, []);

  const loadMailbox = useCallback(async () => {
    try {
      const r = await fetch("/api/mail/mailbox");
      if (r.ok) {
        const d = await r.json();
        setAddress(String(d.address ?? ""));
      }
    } catch {
      /* noop */
    }
  }, []);

  // 폴더 전환과 쪽 초기화가 겹치면 요청이 두 번 나간다 — 마지막 요청의 응답만 반영한다.
  const listReq = useRef(0);
  const loadList = useCallback(
    async (f: string, query: string, category: string, size: number, from: number) => {
      if (f === "receipts" || f === "settings") return; // 자체 뷰
      const req = ++listReq.current;
      setLoadingList(true);
      try {
        if (f === "drafts") {
          const r = await fetch("/api/mail/drafts");
          if (r.ok && req === listReq.current) {
            const d = await r.json();
            setDrafts(Array.isArray(d.drafts) ? d.drafts : []);
          }
        } else {
          const params = new URLSearchParams({ folder: f, limit: String(size), offset: String(from) });
          if (query) params.set("q", query);
          if (f === "inbox" && category) params.set("category", category);
          const r = await fetch(`/api/mail/messages?${params.toString()}`);
          if (r.ok) {
            const d = await r.json();
            if (req !== listReq.current) return;
            setItems(Array.isArray(d.items) ? d.items : []);
            setTotal(Number(d.total ?? 0));
          }
        }
      } finally {
        if (req === listReq.current) setLoadingList(false);
      }
    },
    []
  );

  useEffect(() => {
    loadMailbox();
    loadFolders();
    loadSenderRules();
  }, [loadMailbox, loadFolders, loadSenderRules]);
  // 폴더·검색·카테고리가 바뀌면 첫 쪽부터.
  useEffect(() => {
    setOffset(0);
  }, [folder, q, activeCategory]);
  useEffect(() => {
    loadList(folder, q, activeCategory, pageSize, offset);
  }, [folder, q, activeCategory, pageSize, offset, loadList]);
  // 마지막 쪽의 메일을 모두 옮기거나 지워 쪽이 비면 앞 쪽으로 돌아간다.
  useEffect(() => {
    if (!loadingList && items.length === 0 && offset > 0) setOffset(Math.max(0, offset - pageSize));
  }, [loadingList, items.length, offset, pageSize]);

  // 레거시 진입점(/mail?compose=1) → 작성 페이지로 리다이렉트.
  const composeParamHandled = useRef(false);
  useEffect(() => {
    if (composeParamHandled.current) return;
    composeParamHandled.current = true;
    if (searchParams.get("compose") === "1") router.replace("/mail/compose");
    // §26-1 할 일 "관련"에서 메일로 — /mail?id=<messageId> 는 아래 주소 동기화가 열어 준다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 주소 ↔ 화면 동기화(2026-11-12 사용자 요청) ──────────────
  // 예전에는 폴더 전환·메일 열기가 화면 상태만 바꿔 브라우저 [뒤로]가 메일 메뉴에 들어오기 전 화면으로 가 버렸다.
  // 이제 메일을 열면 주소에 ?id= 를 쌓고(push), 폴더를 바꾸면 ?folder= 를 쌓는다. [뒤로]는 그 메일함 목록으로 돌아온다.
  // 주소 쓰기는 window.history — Next 15 가 useSearchParams 와 맞춰 주므로, 아래 effect 가 주소를 화면 상태로 옮긴다.
  const urlFolder = searchParams.get("folder") || "inbox";
  const urlId = searchParams.get("id");
  const folderRef = useRef(folder);
  folderRef.current = folder;
  /** 지금 열려 있거나 여는 중인 메일 id — 같은 id 로 다시 부르지 않게. */
  const openedIdRef = useRef<string | null>(null);
  /** 우리가 push 로 쌓은 메일 항목 — [목록] 단추는 이때 history.back() 으로 그 항목을 걷어 낸다. */
  const pushedIdRef = useRef<string | null>(null);
  const navTo = useCallback((next: { folder?: string; id?: string | null }, mode: "push" | "replace") => {
    const cur = new URLSearchParams(window.location.search);
    const f = next.folder ?? (cur.get("folder") || "inbox");
    const id = next.id === undefined ? cur.get("id") : next.id;
    const out = new URLSearchParams();
    if (f !== "inbox") out.set("folder", f);
    if (id) out.set("id", id);
    const qs = out.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
    if (url === `${window.location.pathname}${window.location.search}`) return;
    if (mode === "push") pushedIdRef.current = id || null;
    // 우리가 쌓은 항목을 바꿔 쓰면(분할 보기에서 다른 메일) 그 항목은 여전히 우리 것이다.
    else if (pushedIdRef.current && pushedIdRef.current === cur.get("id")) pushedIdRef.current = id || null;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);
  useEffect(() => {
    if (folderRef.current === urlFolder) return;
    setFolder(urlFolder);
    setQ("");
    if (urlFolder !== "inbox") setActiveCategory("");
  }, [urlFolder]);
  useEffect(() => {
    if (urlId) {
      setMobileView("viewer");
      if (openedIdRef.current !== urlId) void openMessage(urlId);
    } else {
      openedIdRef.current = null;
      pushedIdRef.current = null;
      setDetail(null);
      setMobileView("list");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlId]);
  /** 목록에서 메일 열기 — 목록에서 처음 열면 기록을 쌓고(뒤로=목록), 분할 보기에서 다른 메일로 옮기면 바꿔 쓴다. */
  const openFromList = (id: string) => navTo({ id }, urlId ? "replace" : "push");
  /** [목록] 단추 — 우리가 쌓은 항목이면 브라우저 뒤로와 같게, 아니면(링크로 바로 연 메일 등) 주소에서 id 만 뺀다. */
  const closeViewer = () => {
    if (urlId && pushedIdRef.current === urlId) window.history.back();
    else navTo({ id: null }, "replace");
  };
  /** 보던 메일이 목록에서 빠질 때(삭제·이동·차단 등) — 기록을 늘리지 않고 주소에서 id 를 뺀다. */
  const dropViewer = () => {
    setDetail(null);
    setMobileView("list");
    navTo({ id: null }, "replace");
  };
  /** 폴더 바꾸기 — 다른 폴더거나 메일을 보던 중이면 기록을 쌓아 [뒤로]로 돌아올 수 있게 한다. */
  const goFolder = (k: string) => navTo({ folder: k, id: null }, k !== urlFolder || urlId ? "push" : "replace");

  const refreshAll = useCallback(() => {
    loadList(folder, q, activeCategory, pageSize, offset);
    loadFolders();
  }, [folder, q, activeCategory, pageSize, offset, loadList, loadFolders]);

  // ── 카테고리 관리(G2-12) ──────────────────────────
  const createCategory = async () => {
    const name = window.prompt("새 카테고리 이름을 입력하세요. (예: 거래처)");
    if (!name?.trim()) return;
    const r = await fetch("/api/mail/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      toast(`카테고리 '${name.trim()}' 를 만들었습니다. 보관함에 같은 이름의 폴더가 생성됩니다.`, "success");
      loadFolders();
    } else toast("카테고리 생성에 실패했습니다.", "error");
  };

  const deleteCategory = async (cat: MailCategory) => {
    let mode = "delete";
    let target: string | undefined;
    if (cat.total > 0) {
      const move = window.confirm(
        `카테고리 '${cat.name}' 폴더에 보관된 메일이 ${cat.total}건 있습니다.\n\n[확인] 다른 폴더로 이전 후 삭제\n[취소] 메일을 휴지통으로 보내고 폴더 삭제`
      );
      if (move) {
        const others = categories.filter((c) => c.folderId !== cat.folderId);
        const archiveFolder = folders.find((f) => f.systemKind === "archive");
        const options = [...others.map((c) => c.name), "보관함(기본)"];
        const pick = window.prompt(`이전할 폴더를 입력하세요:\n${options.join(", ")}`, "보관함(기본)");
        if (pick == null) return;
        const found = others.find((c) => c.name === pick.trim());
        target = found ? found.folderId : archiveFolder?.folderId;
        if (!target) return;
        mode = "move";
      }
    } else if (!window.confirm(`카테고리 '${cat.name}' 를 삭제할까요? 보관함 폴더도 함께 삭제됩니다.`)) {
      return;
    }
    const params = new URLSearchParams({ id: cat.folderId, mode });
    if (target) params.set("target", target);
    const r = await fetch(`/api/mail/categories?${params.toString()}`, { method: "DELETE" });
    if (r.ok) {
      if (activeCategory === cat.folderId) setActiveCategory("");
      if (folder === `user:${cat.folderId}`) {
        setFolder("archive");
        navTo({ folder: "archive", id: null }, "replace");
      }
      toast("카테고리를 삭제했습니다.", "success");
      refreshAll();
    } else toast("삭제에 실패했습니다.", "error");
  };

  // ── 스팸 분류(2단계 confirm) ──────────────────────
  const markSpam = async () => {
    if (!detail) return;
    await runBulk([detail.messageId], { action: "move", target: "spam" });
    const sender = detail.fromAddr;
    if (sender && window.confirm(`메일 발송자(${sender})가 보낸 모든 메일을 스팸 분류하시겠습니까?\n(이후 수신 메일도 자동으로 스팸함으로 이동합니다)`)) {
      const r = await fetch("/api/mail/spam-block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender, retroactive: true }),
      });
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        toast(`발신자를 차단했습니다. 기존 메일 ${Number(d.moved ?? 0)}건을 스팸함으로 이동했습니다.`, "success");
        refreshAll();
      }
    }
  };

  const setMessageCategory = async (folderId: string | null) => {
    if (!detail) return;
    await runBulk([detail.messageId], { action: "category", target: folderId ?? "" });
    setDetail({ ...detail, categoryId: folderId });
    const name = categories.find((c) => c.folderId === folderId)?.name;
    toast(folderId ? `'${name ?? "카테고리"}' 로 분류했습니다. [보관] 시 해당 폴더로 이동합니다.` : "분류를 해제했습니다.", "success");
  };

  const deleteDraft = async (d: MailDraft) => {
    if (!window.confirm(`임시보관 메일 '${d.subject || "(제목 없음)"}' 을 삭제할까요?`)) return;
    await fetch(`/api/mail/drafts?id=${encodeURIComponent(d.draftId)}`, { method: "DELETE" });
    refreshAll();
  };

  const openMessage = async (id: string) => {
    openedIdRef.current = id;
    setLoadingDetail(true);
    setMobileView("viewer");
    try {
      const r = await fetch(`/api/mail/messages/${id}`);
      if (r.ok) {
        setDetail(await r.json());
        setItems((prev) => prev.map((m) => (m.messageId === id ? { ...m, isRead: true } : m)));
        loadFolders(); // 안읽음 카운트 갱신
      }
    } finally {
      setLoadingDetail(false);
    }
  };

  const runBulk = async (ids: string[], act: BulkAction) => {
    if (act.action === "delete" && !window.confirm(`${ids.length}건을 영구 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      const r = await fetch("/api/mail/messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action: act.action, target: act.target }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast(String(d.error ?? "처리에 실패했습니다."), "error");
        return;
      }
      if (detail && ids.includes(detail.messageId) && ["trash", "delete", "move"].includes(act.action)) {
        dropViewer(); // 보던 메일이 목록에서 빠지면 목록으로 돌아간다
      }
      refreshAll();
    } catch {
      toast("처리 중 오류가 발생했습니다.", "error");
    }
  };

  const toggleStar = async (id: string, star: boolean) => {
    setItems((prev) => prev.map((m) => (m.messageId === id ? { ...m, isStarred: star } : m)));
    await fetch("/api/mail/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id], action: star ? "star" : "unstar" }),
    }).catch(() => toast("별표 변경 실패", "error"));
  };

  // ── 보낸 사람 팝업(10-21) ─────────────────────────
  const closeSenderMenu = useCallback(() => setSenderMenu(null), []);
  // 요청 9(2026-11-12): 예전에는 내 메일 주소록(mail_contacts)에만 넣어 주소록 화면 검색에 나오지 않았다.
  // 이제 업체를 정해 사업장 담당자로 넣는 간이 등록 양식을 연다.
  const addContact = (addr: string, name?: string | null) => setQuickContact({ address: addr, name: name ?? null });
  const blockSenderAddr = async (addr: string) => {
    if (!window.confirm(`${addr} 를 차단할까요?
받은편지함의 이 주소 메일을 스팸함으로 옮기고, 이후 받는 메일도 스팸함으로 들어갑니다.`)) return;
    const r = await fetch("/api/mail/spam-block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: addr, retroactive: true }),
    });
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      toast(`차단했습니다. 기존 메일 ${Number(d.moved ?? 0)}건을 스팸함으로 옮겼습니다.`, "success");
      if (detail && detail.fromAddr?.toLowerCase() === addr.toLowerCase()) dropViewer();
      refreshAll();
    } else toast("차단하지 못했습니다.", "error");
  };
  const assignSenderCategory = async (addr: string, categoryId: string | null) => {
    const r = await fetch("/api/mail/sender-rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: addr, categoryId }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast(String(d.error ?? "분류를 지정하지 못했습니다."), "error");
      return;
    }
    const name = categories.find((c) => c.folderId === categoryId)?.name;
    toast(
      categoryId
        ? `'${name ?? "분류"}'로 지정했습니다. 받은편지함 메일 ${Number(d.applied ?? 0)}건을 분류했고, 앞으로 받는 메일도 자동 분류됩니다.`
        : `자동 분류를 해제했습니다. 이 규칙으로 옮겨진 메일 ${Number(d.reverted ?? 0)}건을 원래 분류로 되돌렸습니다.`,
      "success"
    );
    loadSenderRules();
    refreshAll();
  };

  // ── 작성 — 별도 페이지(/mail/compose)로 이동(G2-8) ──
  const openNew = () => router.push("/mail/compose");
  const openReply = (all: boolean) => {
    if (!detail) return;
    router.push(`/mail/compose?mode=${all ? "replyall" : "reply"}&id=${encodeURIComponent(detail.messageId)}`);
  };
  const openForward = () => {
    if (!detail) return;
    router.push(`/mail/compose?mode=forward&id=${encodeURIComponent(detail.messageId)}`);
  };
  const openDraft = (d: MailDraft) => router.push(`/mail/compose?draft=${encodeURIComponent(d.draftId)}`);

  const viewer = (
    <MailViewerPane
      detail={detail}
      loading={loadingDetail}
      folder={folder}
      categories={categories}
      myAddress={address}
      onReply={() => openReply(false)}
      onReplyAll={() => openReply(true)}
      onForward={openForward}
      onResend={() => detail && router.push(`/mail/compose?mode=resend&id=${encodeURIComponent(detail.messageId)}`)}
      onTrash={() => detail && runBulk([detail.messageId], { action: "trash" })}
      onRestore={() => detail && runBulk([detail.messageId], { action: "restore" })}
      onDelete={() => detail && runBulk([detail.messageId], { action: "delete" })}
      onSetCategory={setMessageCategory}
      onArchive={() => detail && runBulk([detail.messageId], { action: "archive" })}
      onSpam={markSpam}
      onAddressClick={(addr, name, rect) => setSenderMenu({ address: addr, name, anchor: { left: rect.left, top: rect.top, bottom: rect.bottom } })}
      onTodo={() => {
        if (!detail) return;
        const q = new URLSearchParams({ new: "1", linkKind: "mail", linkId: detail.messageId, linkLabel: (detail.subject || "(제목 없음)").slice(0, 80), title: (detail.subject || "").slice(0, 120) });
        router.push(`/todo?${q.toString()}`);
      }}
      onUnspam={async () => {
        if (!detail) return;
        await runBulk([detail.messageId], { action: "unspam" });
        toast("스팸을 해제하고 받은편지함으로 복원했습니다. 발신자 차단도 해제됩니다.", "success");
      }}
    />
  );
  // 보기 전환(넓은 화면만) — 목록형 / 좌우 분할.
  const viewToggle = isWide ? (
    <div className="flex items-center gap-0.5" role="group" aria-label="메일 보기 방식">
      <CdIconButton label="목록형 보기" size="sm" active={viewMode === "list"} aria-pressed={viewMode === "list"} onClick={() => changeViewMode("list")}>
        <Rows3 className="w-4 h-4" />
      </CdIconButton>
      <CdIconButton label="좌우 분할 보기" size="sm" active={viewMode === "split"} aria-pressed={viewMode === "split"} onClick={() => changeViewMode("split")}>
        <Columns2 className="w-4 h-4" />
      </CdIconButton>
    </div>
  ) : null;

  const list = (
    <MailListPane
      layout={listMode ? "row" : "stack"}
      toolbarExtra={viewToggle}
      folder={folder}
      items={items}
      total={total}
      footer={
        folder === "drafts" ? null : (
          <PaginationControls
            total={total}
            limit={pageSize}
            offset={offset}
            loading={loadingList}
            onPageChange={setOffset}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={changePageSize}
          />
        )
      }
      drafts={drafts}
      categories={categories}
      loading={loadingList}
      activeId={detail?.messageId ?? null}
      q={q}
      onSearch={setQ}
      onRefresh={refreshAll}
      onOpen={openFromList}
      onOpenDraft={openDraft}
      onDeleteDraft={deleteDraft}
      onBulk={runBulk}
      onToggleStar={toggleStar}
      onSenderClick={(addr, rect) => setSenderMenu({ address: addr, anchor: { left: rect.left, top: rect.top, bottom: rect.bottom } })}
    />
  );

  return (
    <div className="cdash cd-fields-white cd-mail-surface flex h-full min-h-0 flex-col p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="메일"
        meta={(() => {
          // 헤더 메타 1줄 — 현재 폴더명 + 받은편지함 안읽음 수(시안 규정).
          const cur = folders.find((f) => (f.systemKind ?? f.folderId) === folder);
          const unread = folders.find((f) => f.systemKind === "inbox")?.unread ?? 0;
          const name = cur?.name ?? "메일함";
          return unread > 0 ? `${name} · 안읽음 ${unread}통` : name;
        })()}
        actions={
          <CdButton variant="primary" icon={<PenSquare className="w-4 h-4" />} onClick={openNew}>
            메일 쓰기
          </CdButton>
        }
      />

      <div className="flex-1 min-h-0 cd-card overflow-hidden">
        {isWide ? (
          <CdSplitPane
            first={
              <MailFolderPane
                folders={folders}
                categories={categories}
                active={folder}
                activeCategory={activeCategory}
                draftCount={drafts.length}
                address={address}
                usage={usage}
                onSelect={(k) => {
                  setFolder(k);
                  setQ("");
                  setDetail(null);
                  setMobileView("list");
                  if (k !== "inbox") setActiveCategory("");
                  goFolder(k);
                }}
                onSelectCategory={(id) => {
                  setFolder("inbox");
                  setActiveCategory(id);
                  setDetail(null);
                  setMobileView("list");
                  goFolder("inbox");
                }}
                onCreateCategory={createCategory}
                onDeleteCategory={deleteCategory}
              />
            }
            second={
              folder === "receipts" ? (
                <MailReceiptsPane />
              ) : folder === "settings" ? (
                <MailSettingsPane />
              ) : listMode ? (
                // 목록형 — 목록이 전체 폭, 메일을 열면 그 자리에 본문 + [목록] 복귀(모바일 재배치와 같은 방식).
                mobileView === "viewer" ? (
                  <div className="flex flex-col h-full min-h-0">
                    <div className="px-2 py-1.5 border-b cd-border-c">
                      <CdButton size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={closeViewer}>
                        목록
                      </CdButton>
                    </div>
                    <div className="flex-1 min-h-0">{viewer}</div>
                  </div>
                ) : (
                  list
                )
              ) : (
                <CdSplitPane first={list} second={viewer} defaultSize={380} minSize={280} maxSize={620} storageKey="mail-list-w" />
              )
            }
            defaultSize={210}
            minSize={170}
            maxSize={320}
            storageKey="mail-folder-w"
          />
        ) : (
          <div className="flex flex-col h-full min-h-0">
            {mobileView === "list" ? (
              <>
                <div className="px-2 pt-2">
                  <CdTabs
                    items={[
                      ...folders.map((f) => ({
                        key: f.systemKind ?? f.folderId,
                        label: f.name,
                        count: f.systemKind === "inbox" ? f.unread : undefined,
                      })),
                      { key: "receipts", label: "수신 확인" },
                      { key: "settings", label: "메일 설정" },
                    ]}
                    active={folder}
                    onChange={(k) => {
                      setFolder(k);
                      setQ("");
                      setDetail(null);
                      goFolder(k);
                    }}
                  />
                </div>
                <div className="flex-1 min-h-0">
                  {folder === "receipts" ? <MailReceiptsPane /> : folder === "settings" ? <MailSettingsPane /> : list}
                </div>
              </>
            ) : (
              <>
                <div className="px-2 py-1.5 border-b cd-border-c">
                  <CdButton size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={closeViewer}>
                    목록
                  </CdButton>
                </div>
                <div className="flex-1 min-h-0">{viewer}</div>
              </>
            )}
          </div>
        )}
      </div>

      <MailSenderMenu
        state={senderMenu}
        categories={categories}
        currentCategoryId={senderMenu ? senderRules[senderMenu.address.toLowerCase()] ?? null : null}
        onClose={closeSenderMenu}
        onCompose={(addr) => router.push(`/mail/compose?to=${encodeURIComponent(addr)}`)}
        onAddContact={(addr) => addContact(addr, senderMenu?.name)}
        onBlock={(addr) => void blockSenderAddr(addr)}
        onSearch={(addr) => {
          setQ(addr);
          dropViewer();
        }}
        onAssignCategory={(addr, id) => void assignSenderCategory(addr, id)}
      />
      {quickContact && (
        <QuickContactModal email={quickContact.address} displayName={quickContact.name} source="mail" onClose={() => setQuickContact(null)} />
      )}
    </div>
  );
}
