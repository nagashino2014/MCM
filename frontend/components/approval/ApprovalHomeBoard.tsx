"use client";

// 전자결재 홈(결재함) — 좌 결재함 박스 + 목록형(전체 폭 1줄, 열면 목록 자리에 상세) / 좌우 분할(목록·미리보기).
// 메일 보드(MailBoard)와 같은 구도·보기 전환(10-21 목록형 기본), <lg 는 pill 탭 + 목록↔뷰어 토글.
// 목록은 20·30·50개씩(기본 50) 페이지로 나눠 불러온다.
// 문서 상세는 ApprovalDocViewer(모달과 공용), 작성중 문서는 클릭 시 기안 편집으로 이동.
// 반려 문서는 상세 뷰어에서 사유를 확인한 뒤 [수정 후 재상신]·[삭제]로 처리한다.
// 설계: docs/groupware-ux-overhaul-blueprint.md §6, docs/e-approval-blueprint.md §5-1·§5-3.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, CheckCircle2, ClipboardCheck, Columns2, FileEdit, FilePen, FileText, FolderOpen,
  Hourglass, Inbox, Plus, RefreshCw, Rows3, Sparkles, Star,
} from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton, CdIconButton } from "@/components/cdash/CdButton";
import { CdCount } from "@/components/cdash/CdBadge";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import { CdModal } from "@/components/cdash/CdModal";
import { CdSplitPane } from "@/components/cdash/CdSplitPane";
import { CdTabs } from "@/components/cdash/CdTabs";
import { PAGE_SIZE_OPTIONS, PaginationControls, usePageSize } from "@/components/ui/PaginationControls";
import { ApprovalDocViewer, DOC_STATUS_LABEL } from "@/components/approval/ApprovalDocModal";
import { approvalEditHref, approvalMenuOnlyLabel, approvalNewHref } from "@/lib/approval/edit-route";
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

// 양식 선택 모달 상단 '자주 이용하는 양식' — 표시 순서 그대로(2026-10-20 사용자 지정).
const FAVORITE_FORM_IDS = [
  "frm-overtime-request",
  "frm-leave-request",
  "frm-biz-trip-request",
  "frm-biz-trip-report",
  "frm-expense-report",
  "frm-expense-personal",
  "frm-purchase-request",
  "frm-education-request",
  "frm-education-report",
  "frm-certificate-request",
];

// 양식 선택 모달의 카테고리 순서 — 업무·회계·인사, 그 밖의 폴더는 기존 순서로 뒤에 둔다.
const FOLDER_ORDER = ["fld-biz", "fld-finance", "fld-hr"];

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
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = usePageSize("approval-page-size");
  const [isWide, setIsWide] = useState(true);
  const [mobileView, setMobileView] = useState<"list" | "viewer">(initialDocId ? "viewer" : "list");
  // 넓은 화면 보기(10-21): list = 목록형(전체 폭 1줄, 열면 목록 자리에 상세) / split = 좌우 분할(기존). 사람별로 기억.
  const [viewMode, setViewMode] = useState<"list" | "split">("list");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("approval-view-mode");
      if (saved === "split" || saved === "list") setViewMode(saved);
    } catch {
      /* 저장소 차단 — 기본값 유지 */
    }
  }, []);
  const changeViewMode = (m: "list" | "split") => {
    setViewMode(m);
    setMobileView("list");
    try {
      window.localStorage.setItem("approval-view-mode", m);
    } catch {
      /* noop */
    }
  };
  const changePageSize = (n: number) => {
    setPageSize(n);
    setOffset(0);
  };
  const listMode = isWide && viewMode === "list";

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
        fetch("/api/approval/docs?box=pending&limit=1", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/approval/docs?box=upcoming&limit=1", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setCounts({ pending: Number(p.total ?? (p.docs ?? []).length), upcoming: Number(u.total ?? (u.docs ?? []).length) });
    } catch {
      // 무시 — 뱃지 0 유지
    }
  }, []);

  // 박스·쪽을 빠르게 바꿀 때 늦게 도착한 앞 요청이 목록을 덮지 않도록 마지막 요청만 반영한다.
  const listReq = useRef(0);
  const loadList = useCallback(async () => {
    const req = ++listReq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/approval/docs?box=${box}&limit=${pageSize}&offset=${offset}`, { cache: "no-store" });
      const data = await res.json();
      if (req !== listReq.current) return;
      setDocs(res.ok ? (data.docs ?? []) : []);
      setTotal(res.ok ? Number(data.total ?? (data.docs ?? []).length) : 0);
    } catch {
      if (req !== listReq.current) return;
      setDocs([]);
      setTotal(0);
    } finally {
      if (req === listReq.current) setLoading(false);
    }
  }, [box, pageSize, offset]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);
  useEffect(() => {
    loadList();
  }, [loadList]);

  // 좌우 분할 보기 진입 시 첫 문서 자동 선택 — 뷰어가 빈 상태로 시작하던 문제(분석 §2 /approval).
  // 작성중·반려함은 클릭이 기안 편집으로 가는 흐름이라, 목록형은 목록을 먼저 보여 주므로 자동 선택에서 제외한다.
  useEffect(() => {
    if (!isWide || viewMode === "list" || loading || box === "draft") return;
    if (selectedId && docs.some((d) => d.docId === selectedId)) return;
    setSelectedId(docs[0]?.docId ?? null);
  }, [docs, loading, isWide, viewMode, box, selectedId]);

  // 마지막 쪽의 문서를 모두 처리해 쪽이 비면 앞 쪽으로 돌아간다.
  useEffect(() => {
    if (!loading && docs.length === 0 && offset > 0) setOffset(Math.max(0, offset - pageSize));
  }, [loading, docs.length, offset, pageSize]);

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
    // 미상신(작성중) 문서는 바로 기안 편집으로 — 기존 흐름 유지. 양식 전용 화면(공문·견적서)은 그쪽으로.
    // 반려 문서는 먼저 상세(반려 사유·결재선)를 보여주고, 뷰어의 [수정 후 재상신]으로 편집에 들어간다.
    if (box === "draft" && d.status === "draft") {
      router.push(approvalEditHref(d.formId, d.docId));
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
          <p className="px-2 pt-1 pb-1 text-[11px] font-medium cd-text-faint">
            {group === "inbox" ? "결재함" : "기안함"}
          </p>
          {BOXES.filter((b) => b.group === group).map((b) => {
            const Icon = b.icon;
            const count = b.key === "pending" ? counts.pending : b.key === "upcoming" ? counts.upcoming : null;
            return (
              <button
                key={b.key}
                type="button"
                className={`flex items-center gap-2 rounded-lg px-2.5 py-[13px] text-[13px] text-left transition-colors ${
                  box === b.key ? "cd-glass-active font-semibold" : "cd-text-muted cd-row-hover"
                }`}
                onClick={() => {
                  setBox(b.key);
                  setOffset(0);
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
      <p className="mt-auto px-2 text-[11px] cd-text-faint leading-relaxed">
        결재 예정 문서는 앞 순번 처리 후 차례가 옵니다. 완료 문서의 부서·전사 조회는 문서함에서.
      </p>
    </div>
  );

  // 보기 전환(넓은 화면만) — 목록형 / 좌우 분할(메일과 같은 버튼).
  const viewToggle = isWide ? (
    <div className="flex items-center gap-0.5" role="group" aria-label="결재 목록 보기 방식">
      <CdIconButton label="목록형 보기" size="sm" active={viewMode === "list"} aria-pressed={viewMode === "list"} onClick={() => changeViewMode("list")}>
        <Rows3 className="w-4 h-4" />
      </CdIconButton>
      <CdIconButton label="좌우 분할 보기" size="sm" active={viewMode === "split"} aria-pressed={viewMode === "split"} onClick={() => changeViewMode("split")}>
        <Columns2 className="w-4 h-4" />
      </CdIconButton>
    </div>
  ) : null;

  const urgentTag = (
    <span className="text-[11px] font-semibold rounded-lg px-1.5 py-0.5 mr-1.5 cd-error-bg cd-error-text align-[1px]">
      긴급
    </span>
  );

  const listPane = (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b cd-hairline-c shrink-0">
        <span className="text-[13px] font-semibold cd-text">{boxLabel}</span>
        {(box === "pending" || box === "upcoming") && <CdHelp topic="approval.inbox-boxes" />}
        <span className="text-[11px] cd-text-faint">{total}건</span>
        <span className="ml-auto flex items-center gap-1">
          <CdIconButton label="새로고침" size="sm" onClick={refreshAll}>
            <RefreshCw className="w-3.5 h-3.5" />
          </CdIconButton>
          {viewToggle}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <p className="text-sm cd-text-faint p-4">불러오는 중입니다.</p>
        ) : docs.length === 0 ? (
          <CdEmptyState icon={<FolderOpen className="w-7 h-7" />} title="문서가 없습니다" description={`${boxLabel} 문서가 없습니다.`} />
        ) : listMode ? (
          // 목록형(10-21): 한 줄 = 상태 점 · 제목(긴급·AI 요약) · 양식 · 기안자·부서 · 문서번호 · 일시.
          docs.map((d) => (
            <button
              key={d.docId}
              type="button"
              className="w-full text-left px-4 py-[15.5px] border-b cd-hairline-row-c flex items-center gap-3 transition-colors cd-row-hover"
              onClick={() => openDoc(d)}
              title={DOC_STATUS_LABEL[d.status] ?? d.status}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_DOT[d.status] ?? "var(--cd-faint)" }} aria-hidden />
              <span className="flex-1 min-w-0 truncate text-[14px] font-semibold cd-text leading-[1.4]" title={d.title}>
                {d.urgent && urgentTag}
                {d.title}
                {d.aiSummary && d.aiSummary.lines.length > 0 && (
                  <Sparkles className="inline w-3 h-3 ml-1 cd-text-primary" aria-label="AI 요약 있음" />
                )}
              </span>
              <span className="w-40 shrink-0 truncate text-[12px] cd-text-muted" title={d.formName}>{d.formName}</span>
              <span className="w-48 shrink-0 truncate text-[12px] cd-text-muted">
                {d.drafterName ?? "-"}
                {d.deptName ? ` · ${d.deptName}` : ""}
              </span>
              <span className="hidden xl:block w-36 shrink-0 truncate text-[12px] tabular-nums cd-text-faint">
                {d.docNo ?? ""}
              </span>
              <span className="w-32 shrink-0 text-right text-[12px] tabular-nums cd-text-faint">
                {short(d.submittedAt ?? d.updatedAt)}
              </span>
            </button>
          ))
        ) : (
          // 행 위계 반전(Soft Glass Ink): pill 3개(긴급·양식·상태) → 상태 색 점 1개 + 긴급 배지만.
          // 제목이 노이즈에 밀리던 문제를 없애고, 양식·기안자·시각은 무채 메타 1줄로 내린다.
          docs.map((d) => (
            <button
              key={d.docId}
              type="button"
              className={`w-full text-left px-3.5 py-[15.5px] border-b cd-hairline-row-c flex items-start gap-2.5 transition-colors ${
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
                <span className="block text-[14px] font-semibold cd-text leading-[1.4] truncate" title={d.title}>
                  {d.urgent && urgentTag}
                  {d.title}
                  {d.aiSummary && d.aiSummary.lines.length > 0 && (
                    <Sparkles className="inline w-3 h-3 ml-1 cd-text-primary" aria-label="AI 요약 있음" />
                  )}
                </span>
                <span className="block mt-[3px] text-[12px] truncate cd-text-faint">
                  {d.formName} · {d.drafterName ?? "-"}
                  {d.deptName ? ` · ${d.deptName}` : ""} · {short(d.submittedAt ?? d.updatedAt)}
                  {d.docNo ? ` · ${d.docNo}` : ""}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
      {/* 페이지 — 우하단 쪽 번호 + 화면당 표시 수(20·30·50) */}
      <div className="shrink-0 border-t cd-hairline-c px-3 py-2">
        <PaginationControls
          total={total}
          limit={pageSize}
          offset={offset}
          loading={loading}
          onPageChange={setOffset}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          onPageSizeChange={changePageSize}
        />
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
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col p-4 md:p-5 rounded-lg" data-theme={theme}>
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
            second={
              listMode ? (
                // 목록형 — 목록이 전체 폭, 문서를 열면 그 자리에 상세 + [목록] 복귀(메일 목록형과 같은 방식).
                mobileView === "viewer" ? (
                  <div className="flex flex-col h-full min-h-0">
                    <div className="px-2 py-1.5 border-b cd-hairline-c">
                      <CdButton size="sm" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={() => setMobileView("list")}>
                        목록
                      </CdButton>
                    </div>
                    <div className="flex-1 min-h-0">{viewerPane}</div>
                  </div>
                ) : (
                  listPane
                )
              ) : (
                <CdSplitPane first={listPane} second={viewerPane} defaultSize={380} minSize={280} maxSize={620} storageKey="approval-list-w" />
              )
            }
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
                    items={BOXES.map((b) => ({
                      key: b.key,
                      label: b.label,
                      count: b.key === "pending" ? counts.pending || undefined : undefined,
                    }))}
                    active={box}
                    onChange={(k) => {
                      setBox(k as BoxKey);
                      setOffset(0);
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
      <CdModal open={formModal} onClose={() => setFormModal(false)} title="결재양식 선택" size="lg" maxHeightClass="max-h-[72vh]">
        <div className="flex flex-col gap-3">
          {[
            {
              key: "__favorite__",
              name: "자주 이용하는 양식",
              favorite: true,
              list: FAVORITE_FORM_IDS.map((id) => forms.find((f) => f.formId === id)).filter((f): f is FormRow => !!f),
            },
            ...[...folders, { folderId: "__none__", name: "미분류" }]
              .map((fold, idx) => ({ fold, rank: FOLDER_ORDER.includes(fold.folderId) ? FOLDER_ORDER.indexOf(fold.folderId) : FOLDER_ORDER.length + idx }))
              .sort((a, b) => a.rank - b.rank)
              .map(({ fold }) => ({
                key: fold.folderId,
                name: fold.name,
                favorite: false,
                list: forms.filter((f) => (f.folderId ?? "__none__") === fold.folderId),
              })),
          ].map((sec) => {
            if (!sec.list.length) return null;
            return (
              <div key={sec.key}>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold cd-text-faint mb-1">
                  {sec.favorite ? <Star className="w-3.5 h-3.5" /> : <FolderOpen className="w-3.5 h-3.5" />} {sec.name}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mb-2">
                  {sec.list.map((f) => {
                    // 공문·내부고시·견적서는 메뉴에서 작성 — 목록에는 보이되 누를 수 없게 둔다.
                    const menuOnly = approvalMenuOnlyLabel(f.formId);
                    return (
                      <button
                        key={f.formId}
                        type="button"
                        disabled={menuOnly != null}
                        title={menuOnly ? `${menuOnly} 메뉴에서 작성합니다` : undefined}
                        className="text-left rounded-lg border cd-border-c px-3 py-2 hover:bg-[color:var(--cd-surface)] disabled:opacity-55 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        onClick={() => router.push(approvalNewHref(f.formId))}
                      >
                        <span className="text-[13px] cd-text font-semibold">{f.name}</span>
                        {menuOnly ? (
                          <p className="text-[11px] cd-text-faint truncate">{menuOnly} 메뉴에서 작성하세요</p>
                        ) : (
                          f.description && <p className="text-[11px] cd-text-faint truncate">{f.description}</p>
                        )}
                      </button>
                    );
                  })}
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
