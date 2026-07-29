"use client";

// 전자결재 홈(결재함) — G3 3-pane: 좌 결재함 박스 / 중앙 문서 목록 / 우 문서 미리보기.
// 메일 3-pane(MailBoard)과 같은 구도(CdSplitPane 중첩, <lg 는 pill 탭 + 목록↔뷰어 토글).
// 문서 상세는 ApprovalDocViewer(모달과 공용), 작성중·반려 문서는 클릭 시 기안 편집으로 이동.
// 설계: docs/groupware-ux-overhaul-blueprint.md §6, docs/e-approval-blueprint.md §5-1·§5-3.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, CheckCircle2, ClipboardCheck, FileEdit, FilePen, FileText, FolderOpen,
  Hourglass, Inbox, Plus, RefreshCw, Sparkles,
} from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdCount } from "@/components/cdash/CdBadge";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import { CdModal } from "@/components/cdash/CdModal";
import { CdSplitPane } from "@/components/cdash/CdSplitPane";
import { CdTabs } from "@/components/cdash/CdTabs";
import { ApprovalDocViewer, DOC_STATUS_LABEL } from "@/components/approval/ApprovalDocModal";
import "@/components/cdash/cdash.css";

interface DocSummary {
  docId: string;
  docNo: string | null;
  formId: string;
  formName: string;
  title: string;
  urgent: boolean;
  status: string;
  drafterName: string | null;
  deptName: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  myStepId?: string | null;
  aiSummary?: { lines: string[]; figures: { label: string; value: string }[]; precedent?: string | null } | null;
}

interface FormRow {
  formId: string;
  folderId: string | null;
  name: string;
  description: string | null;
}

interface FolderRow {
  folderId: string;
  name: string;
}

type BoxKey = "pending" | "upcoming" | "draft" | "in_progress" | "completed" | "acted";

const BOXES: { key: BoxKey; label: string; icon: typeof Inbox; group: "inbox" | "mine" }[] = [
  { key: "pending", label: "결재 대기", icon: Inbox, group: "inbox" },
  { key: "upcoming", label: "결재 예정", icon: Hourglass, group: "inbox" },
  { key: "acted", label: "내가 결재한 문서", icon: CheckCircle2, group: "inbox" },
  { key: "draft", label: "작성중 · 반려", icon: FileEdit, group: "mine" },
  { key: "in_progress", label: "결재 진행", icon: FilePen, group: "mine" },
  { key: "completed", label: "완료", icon: FileText, group: "mine" },
];

const short = (s: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "-");

/** 행당 상태 표현은 색 점 1개로 제한한다(Soft Glass Ink 상태 규정). */
const STATUS_DOT: Record<string, string> = {
  approved: "var(--cd-success)",
  rejected: "var(--cd-error)",
  in_progress: "var(--cd-primary)",
  pending: "var(--cd-primary)",
  draft: "var(--cd-faint)",
  canceled: "var(--cd-faint)",
};

export function ApprovalHomeBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  // 홈 위젯 등에서 특정 문서로 딥링크(/approval?docId=...) — 초기 선택으로만 사용.
  const initialDocId = useSearchParams().get("docId");
  const [box, setBox] = useState<BoxKey>("pending");
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [counts, setCounts] = useState<{ pending: number; upcoming: number }>({ pending: 0, upcoming: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialDocId);
  const [formModal, setFormModal] = useState(false);
  const [forms, setForms] = useState<FormRow[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [isWide, setIsWide] = useState(true);
  const [mobileView, setMobileView] = useState<"list" | "viewer">(initialDocId ? "viewer" : "list");

  // 반응형 감지(lg=1024) — 메일 3-pane 과 동일 기준.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // 대기/예정 카운트는 좌측 뱃지용으로 항상 로드한다(박스 선택과 무관).
  const loadCounts = useCallback(async () => {
    try {
      const [p, u] = await Promise.all([
        fetch("/api/approval/docs?box=pending", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/approval/docs?box=upcoming", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setCounts({ pending: (p.docs ?? []).length, upcoming: (u.docs ?? []).length });
    } catch {
      // 무시 — 뱃지 0 유지
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/approval/docs?box=${box}`, { cache: "no-store" });
      const data = await res.json();
      setDocs(res.ok ? (data.docs ?? []) : []);
    } catch {
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [box]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);
  useEffect(() => {
    loadList();
  }, [loadList]);

  // 진입 시 첫 문서 자동 선택 — 뷰어가 빈 상태로 시작하던 문제(분석 §2 /approval).
  // 작성중·반려함은 클릭이 기안 편집으로 가는 흐름이라 자동 선택에서 제외한다.
  useEffect(() => {
    if (!isWide || loading || box === "draft") return;
    if (selectedId && docs.some((d) => d.docId === selectedId)) return;
    setSelectedId(docs[0]?.docId ?? null);
  }, [docs, loading, isWide, box, selectedId]);

  const refreshAll = useCallback(() => {
    loadCounts();
    loadList();
  }, [loadCounts, loadList]);

  const openFormModal = async () => {
    setFormModal(true);
    if (!forms.length) {
      try {
        const res = await fetch("/api/approval/forms", { cache: "no-store" });
        const data = await res.json();
        if (res.ok) {
          setForms(data.forms ?? []);
          setFolders(data.folders ?? []);
        }
      } catch {
        // 무시
      }
    }
  };

  const openDoc = (d: DocSummary) => {
    // 미상신(작성중)·반려 문서는 기안 편집으로 — 기존 흐름 유지.
    if (box === "draft" && (d.status === "draft" || d.status === "rejected")) {
      router.push(`/approval/draft?docId=${encodeURIComponent(d.docId)}`);
      return;
    }
    setSelectedId(d.docId);
    setMobileView("viewer");
  };

  // 결재 처리 후 — 목록·카운트 갱신, 처리한 문서는 대기함에서 빠지므로 뷰어를 비운다.
  const onActed = useCallback(() => {
    setSelectedId(null);
    setMobileView("list");
    refreshAll();
  }, [refreshAll]);

  const boxLabel = useMemo(() => BOXES.find((b) => b.key === box)?.label ?? "", [box]);

  const boxPane = (
    <div className="h-full min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
      <CdButton variant="primary" icon={<Plus className="w-4 h-4" />} block onClick={openFormModal}>
        새 기안
      </CdButton>
      {(["inbox", "mine"] as const).map((group) => (
        <div key={group} className="flex flex-col gap-0.5">
          <p className="px-2 pt-1 pb-1 text-[10.5px] font-bold cd-text-faint tracking-wide">
            {group === "inbox" ? "결재함" : "기안함"}
          </p>
          {BOXES.filter((b) => b.group === group).map((b) => {
            const Icon = b.icon;
            const count = b.key === "pending" ? counts.pending : b.key === "upcoming" ? counts.upcoming : null;
            return (
              <button
                key={b.key}
                type="button"
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-left transition-colors ${
                  box === b.key ? "cd-glass-active font-bold" : "cd-text-muted cd-row-hover"
                }`}
                onClick={() => {
                  setBox(b.key);
                  setSelectedId(null);
                  setMobileView("list");
                }}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 truncate">{b.label}</span>
                {count != null && <CdCount count={count} />}
              </button>
            );
          })}
        </div>
      ))}
      <p className="mt-auto px-2 text-[10px] cd-text-faint leading-relaxed">
        결재 예정 문서는 앞 순번 처리 후 차례가 옵니다. 완료 문서의 부서·전사 조회는 문서함에서.
      </p>
    </div>
  );

  const listPane = (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b cd-hairline-c shrink-0">
        <span className="text-[13px] font-bold cd-text">{boxLabel}</span>
        <span className="text-[11px] cd-text-faint">{docs.length}건</span>
        <button type="button" className="ml-auto cd-btn cd-btn-soft rounded-lg p-1.5" title="새로고침" onClick={refreshAll}>
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <p className="text-sm cd-text-faint p-4">불러오는 중입니다.</p>
        ) : docs.length === 0 ? (
          <CdEmptyState icon={<FolderOpen className="w-7 h-7" />} title="문서가 없습니다" description={`${boxLabel} 문서가 없습니다.`} />
        ) : (
          // 행 위계 반전(Soft Glass Ink): pill 3개(긴급·양식·상태) → 상태 색 점 1개 + 긴급 배지만.
          // 제목이 노이즈에 밀리던 문제를 없애고, 양식·기안자·시각은 무채 메타 1줄로 내린다.
          docs.map((d) => (
            <button
              key={d.docId}
              type="button"
              className={`w-full text-left px-3.5 py-3 border-b cd-hairline-row-c flex items-start gap-2.5 transition-colors ${
                selectedId === d.docId ? "cd-glass-active" : "cd-row-hover"
              }`}
              onClick={() => openDoc(d)}
              title={DOC_STATUS_LABEL[d.status] ?? d.status}
            >
              <span
                className="w-2 h-2 rounded-full mt-[5px] shrink-0"
                style={{ background: STATUS_DOT[d.status] ?? "var(--cd-faint)" }}
                aria-hidden
              />
              <span className="flex-1 min-w-0">
                <span className="block text-[13.5px] font-bold cd-text leading-[1.4] truncate" title={d.title}>
                  {d.urgent && (
                    <span className="text-[10px] font-extrabold rounded-[5px] px-1.5 py-0.5 mr-1.5 cd-error-bg cd-error-text align-[1px]">
                      긴급
                    </span>
                  )}
                  {d.title}
                  {d.aiSummary && d.aiSummary.lines.length > 0 && (
                    <Sparkles className="inline w-3 h-3 ml-1 cd-text-primary" aria-label="AI 요약 있음" />
                  )}
                </span>
                <span className="block mt-[3px] text-[11.5px] truncate" style={{ color: "var(--cd-faint)" }}>
                  {d.formName} · {d.drafterName ?? "-"}
                  {d.deptName ? ` · ${d.deptName}` : ""} · {short(d.submittedAt ?? d.updatedAt)}
                  {d.docNo ? ` · ${d.docNo}` : ""}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  const viewerPane = (
    <div className="h-full min-h-0 overflow-y-auto">
      {selectedId ? (
        <div className="p-4">
          <ApprovalDocViewer docId={selectedId} onActed={onActed} />
        </div>
      ) : (
        <div className="h-full flex items-center justify-center">
          <CdEmptyState
            icon={<ClipboardCheck className="w-7 h-7" />}
            title="문서를 선택하세요"
            description="왼쪽 목록에서 문서를 클릭하면 내용과 결재선이 표시됩니다."
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="전자결재"
        meta={`결재 대기 ${counts.pending} · 결재 예정 ${counts.upcoming}`}
        actions={
          <CdButton variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openFormModal}>
            새 기안
          </CdButton>
        }
      />

      <div className="flex-1 min-h-0 cd-card overflow-hidden">
        {isWide ? (
          <CdSplitPane
            first={boxPane}
            second={<CdSplitPane first={listPane} second={viewerPane} defaultSize={380} minSize={280} maxSize={620} storageKey="approval-list-w" />}
            defaultSize={220}
            minSize={180}
            maxSize={320}
            storageKey="approval-box-w"
          />
        ) : (
          <div className="flex flex-col h-full min-h-0">
            {mobileView === "list" ? (
              <>
                <div className="px-2 pt-2 flex items-center gap-2 flex-wrap">
                  <CdTabs
                    variant="pill"
                    items={BOXES.map((b) => ({
                      key: b.key,
                      label: b.label,
                      count: b.key === "pending" ? counts.pending || undefined : undefined,
                    }))}
                    active={box}
                    onChange={(k) => {
                      setBox(k as BoxKey);
                      setSelectedId(null);
                    }}
                  />
                </div>
                <div className="flex-1 min-h-0">{listPane}</div>
              </>
            ) : (
              <>
                <div className="px-2 py-1.5 border-b cd-hairline-c">
                  <CdButton size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => setMobileView("list")}>
                    목록
                  </CdButton>
                </div>
                <div className="flex-1 min-h-0">{viewerPane}</div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 양식 선택 모달(G0 CdModal) */}
      <CdModal open={formModal} onClose={() => setFormModal(false)} title="결재양식 선택" size="lg">
        <div className="flex flex-col gap-3">
          {[...folders, { folderId: "__none__", name: "미분류" }].map((fold) => {
            const list = forms.filter((f) => (f.folderId ?? "__none__") === fold.folderId);
            if (!list.length) return null;
            return (
              <div key={fold.folderId}>
                <div className="flex items-center gap-1.5 text-[11px] font-bold cd-text-faint mb-1">
                  <FolderOpen className="w-3.5 h-3.5" /> {fold.name}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mb-2">
                  {list.map((f) => (
                    <button
                      key={f.formId}
                      type="button"
                      className="text-left rounded-xl border cd-border-c px-3 py-2 hover:bg-[color:var(--cd-surface)]"
                      onClick={() => router.push(`/approval/draft?formId=${encodeURIComponent(f.formId)}`)}
                    >
                      <span className="text-[12.5px] cd-text font-semibold">{f.name}</span>
                      {f.description && <p className="text-[10.5px] cd-text-faint truncate">{f.description}</p>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {forms.length === 0 && <p className="text-sm cd-text-faint py-4 text-center">사용 가능한 양식이 없습니다.</p>}
        </div>
      </CdModal>
    </div>
  );
}
