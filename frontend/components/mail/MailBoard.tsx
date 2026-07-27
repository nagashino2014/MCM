"use client";

// 코넨사인 메일 3-pane 보드(G2) — 폴더 트리 / 메시지 목록 / 본문 뷰어. 작성은 별도 페이지(/mail/compose, G2-8).
// 반응형(§3.0): ≥lg 3-pane(CdSplitPane 중첩) / <lg 폴더 pill + 목록↔뷰어 토글(축소 아닌 재배치).
// 설계: docs/groupware-ux-overhaul-blueprint.md §5.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Mail, PenSquare } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdSplitPane } from "@/components/cdash/CdSplitPane";
import { CdTabs } from "@/components/cdash/CdTabs";
import { useCdToast } from "@/components/cdash/CdToast";
import { MailFolderPane } from "@/components/mail/MailFolderPane";
import { MailListPane, type BulkAction } from "@/components/mail/MailListPane";
import { MailViewerPane } from "@/components/mail/MailViewerPane";
import { MailReceiptsPane } from "@/components/mail/MailReceiptsPane";
import { MailSettingsPane } from "@/components/mail/MailSettingsPane";
import type { MailFolderInfo, MailListItem, MailMessageDetail } from "@/lib/mail/messages";
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
  const [folder, setFolder] = useState("inbox");
  const [activeCategory, setActiveCategory] = useState(""); // 받은편지함 카테고리 필터
  const [items, setItems] = useState<MailListItem[]>([]);
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<MailMessageDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isWide, setIsWide] = useState(true);
  const [mobileView, setMobileView] = useState<"list" | "viewer">("list");

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

  const loadList = useCallback(
    async (f: string, query: string, category: string) => {
      if (f === "receipts" || f === "settings") return; // 자체 뷰
      setLoadingList(true);
      try {
        if (f === "drafts") {
          const r = await fetch("/api/mail/drafts");
          if (r.ok) {
            const d = await r.json();
            setDrafts(Array.isArray(d.drafts) ? d.drafts : []);
          }
        } else {
          const params = new URLSearchParams({ folder: f, limit: "100" });
          if (query) params.set("q", query);
          if (f === "inbox" && category) params.set("category", category);
          const r = await fetch(`/api/mail/messages?${params.toString()}`);
          if (r.ok) {
            const d = await r.json();
            setItems(Array.isArray(d.items) ? d.items : []);
          }
        }
      } finally {
        setLoadingList(false);
      }
    },
    []
  );

  useEffect(() => {
    loadMailbox();
    loadFolders();
  }, [loadMailbox, loadFolders]);
  useEffect(() => {
    loadList(folder, q, activeCategory);
  }, [folder, q, activeCategory, loadList]);

  // 레거시 진입점(/mail?compose=1) → 작성 페이지로 리다이렉트.
  const composeParamHandled = useRef(false);
  useEffect(() => {
    if (composeParamHandled.current) return;
    composeParamHandled.current = true;
    if (searchParams.get("compose") === "1") router.replace("/mail/compose");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = useCallback(() => {
    loadList(folder, q, activeCategory);
    loadFolders();
  }, [folder, q, activeCategory, loadList, loadFolders]);

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
      if (folder === `user:${cat.folderId}`) setFolder("archive");
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
  };

  const deleteDraft = async (d: MailDraft) => {
    if (!window.confirm(`임시보관 메일 '${d.subject || "(제목 없음)"}' 을 삭제할까요?`)) return;
    await fetch(`/api/mail/drafts?id=${encodeURIComponent(d.draftId)}`, { method: "DELETE" });
    refreshAll();
  };

  const openMessage = async (id: string) => {
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
      if (detail && ids.includes(detail.messageId) && ["trash", "delete", "move"].includes(act.action)) setDetail(null);
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
      onReply={() => openReply(false)}
      onReplyAll={() => openReply(true)}
      onForward={openForward}
      onTrash={() => detail && runBulk([detail.messageId], { action: "trash" })}
      onRestore={() => detail && runBulk([detail.messageId], { action: "restore" })}
      onDelete={() => detail && runBulk([detail.messageId], { action: "delete" })}
      onSetCategory={setMessageCategory}
      onArchive={() => detail && runBulk([detail.messageId], { action: "archive" })}
      onSpam={markSpam}
    />
  );
  const list = (
    <MailListPane
      folder={folder}
      items={items}
      drafts={drafts}
      loading={loadingList}
      activeId={detail?.messageId ?? null}
      q={q}
      onSearch={setQ}
      onRefresh={refreshAll}
      onOpen={openMessage}
      onOpenDraft={openDraft}
      onDeleteDraft={deleteDraft}
      onBulk={runBulk}
      onToggleStar={toggleStar}
    />
  );

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Mail className="w-5 h-5" />}
        eyebrow="Koensain Mail"
        title="메일"
        subtitle={address ? `내 주소: ${address}` : undefined}
        actions={
          <CdButton variant="primary" icon={<PenSquare className="w-4 h-4" />} onClick={openNew}>
            메일 쓰기
          </CdButton>
        }
      />

      <div className="flex-1 min-h-0 rounded-2xl border cd-border-c cd-card-bg overflow-hidden">
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
                onSelect={(k) => {
                  setFolder(k);
                  setQ("");
                  setDetail(null);
                  if (k !== "inbox") setActiveCategory("");
                }}
                onSelectCategory={(id) => {
                  setFolder("inbox");
                  setActiveCategory(id);
                  setDetail(null);
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
                    variant="pill"
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
                  <CdButton size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => setMobileView("list")}>
                    목록
                  </CdButton>
                </div>
                <div className="flex-1 min-h-0">{viewer}</div>
              </>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
