"use client";

// 채용공고 관리 — 태그로 고르고 요약·미리보기로 확인한다(2026-10-13 사용자 요청, 종전 표+상단 검색 옵션 대체).
// 왼쪽: 채용사이트 │ 게재연도 │ 신입/경력 세 줄의 태그(공고가 있는 값만) + 조건에 맞는 공고 목록.
// 오른쪽: 고른 공고의 요약(채용사이트·대상 분야·근무지역·게재일·기간·상태 …)과 공고 전체 미리보기.
// "새 공고"(템플릿 선택 → 에디터 진입)·파일 가져오기·복제·삭제는 그대로.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, ExternalLink, FilePlus2, FileText, FileUp, Loader2, Megaphone, Pencil, Search, Trash2 } from "lucide-react";
import { CdBadge, CdButton, CdEmptyState, CdHelp, CdModal, CdPageHeader, useCdashTheme, useCdToast } from "@/components/cdash";
import type { RecruitPostingRow, RecruitTemplateRow } from "@/lib/recruit/types";
import {
  HIRE_TYPE_PRESETS,
  PLATFORM_PRESETS,
  daysUntilEnd,
  formatPeriod,
  periodState,
  postingYear,
  siteUrlOf,
  splitDivision,
  workLocationOf,
} from "@/lib/recruit/meta";
import type { ApplicantCountRow } from "@/lib/recruit/tracking";
import { DocCanvas, DocFitPreview, DocMiniPreview } from "./DocCanvas";
import { PngExportModal } from "./PngExportModal";
import { exportElementPdf, exportElementPng } from "@/lib/recruit/export";
import { ImportPostingModal } from "./ImportPostingModal";
import { PostingTrackingCard } from "./PostingTrackingCard";

/** 태그 열 — 값이 비어 있는 공고도 고를 수 있게 빈 값은 대체 이름으로 묶는다 */
const NO_PLATFORM = "미지정";
const NO_YEAR = "연도 미정";
const NO_HIRE = "미분류";

type TagKey = "platform" | "year" | "hire";
type TagSelection = Record<TagKey, string | null>;

const tagOf = (p: RecruitPostingRow, key: TagKey): string =>
  key === "platform" ? p.platform ?? NO_PLATFORM : key === "year" ? postingYear(p) ?? NO_YEAR : p.hireType ?? NO_HIRE;

/** 열별 정렬 — 플랫폼·구분은 프리셋 순서(그 밖은 가나다), 연도는 최신부터, 빈 값 묶음은 맨 뒤 */
function sortTags(key: TagKey, values: string[]): string[] {
  const presets: readonly string[] = key === "platform" ? PLATFORM_PRESETS : key === "hire" ? HIRE_TYPE_PRESETS : [];
  const fallback = key === "platform" ? NO_PLATFORM : key === "year" ? NO_YEAR : NO_HIRE;
  return [...values].sort((a, b) => {
    if (a === fallback) return 1;
    if (b === fallback) return -1;
    if (key === "year") return b.localeCompare(a);
    const ia = presets.indexOf(a);
    const ib = presets.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b, "ko");
  });
}

const matches = (p: RecruitPostingRow, sel: TagSelection, except?: TagKey): boolean =>
  (["platform", "year", "hire"] as TagKey[]).every((k) => k === except || !sel[k] || tagOf(p, k) === sel[k]);

export function PostingListBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();
  const [postings, setPostings] = useState<RecruitPostingRow[] | null>(null);
  const [templates, setTemplates] = useState<RecruitTemplateRow[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RecruitPostingRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [sel, setSel] = useState<TagSelection>({ platform: null, year: null, hire: null });
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 고른 공고의 본문 — 목록 조회는 본문을 비워 보내므로 단건으로 받는다
  const [detail, setDetail] = useState<RecruitPostingRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // 최신 누적 지원자 수(273) — 지원 현황 카드가 알려 주면 요약에 보인다
  const [latestCount, setLatestCount] = useState<ApplicantCountRow | null>(null);
  // PNG·PDF 내보내기(2026-10-13) — 편집 화면에 들어가지 않고 목록에서 바로. 캡처는 화면 밖에 원본 크기로 그린 문서를 쓴다
  // (미리보기는 축소돼 있어 그대로 캡처하면 해상도가 떨어진다).
  const exportRef = useRef<HTMLDivElement | null>(null);
  const [exporting, setExporting] = useState<"png" | "pdf" | null>(null);
  const [pngOpen, setPngOpen] = useState(false);
  const [docRatio, setDocRatio] = useState(0);
  const doExport = useCallback(
    async (kind: "png" | "pdf", pngWidthPx?: number, pngFormat: "png" | "jpeg" = "png") => {
      const el = exportRef.current;
      if (!el || !detail) return;
      setExporting(kind);
      try {
        const base = (detail.title || "채용공고").replace(/[\\/:*?"<>|]/g, "_");
        if (kind === "png") await exportElementPng(el, base, pngWidthPx, pngFormat);
        else await exportElementPdf(el, base);
        toast(`${kind.toUpperCase()} 로 내보냈습니다.`, "success");
      } catch (e) {
        toast(`내보내기 실패: ${(e as Error).message}`, "error");
      } finally {
        setExporting(null);
      }
    },
    [detail, toast]
  );
  const openPngModal = () => {
    const el = exportRef.current;
    if (el && el.offsetWidth > 0) setDocRatio(el.offsetHeight / el.offsetWidth);
    setPngOpen(true);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/recruit/postings", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "목록을 불러오지 못했습니다.");
      setPostings(data.postings as RecruitPostingRow[]);
    } catch (e) {
      toast((e as Error).message, "error");
      setPostings([]);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  /** 열별 태그 — 전체 공고에 있는 값만, 건수는 다른 두 열의 현재 선택과 겹치는 수(0 이면 흐리게) */
  const columns = useMemo(() => {
    const all = postings ?? [];
    return (["platform", "year", "hire"] as TagKey[]).map((key) => {
      const values = sortTags(key, Array.from(new Set(all.map((p) => tagOf(p, key)))));
      return {
        key,
        label: key === "platform" ? "채용사이트" : key === "year" ? "게재연도" : "신입/경력",
        tags: values.map((v) => ({ value: v, count: all.filter((p) => tagOf(p, key) === v && matches(p, sel, key)).length })),
      };
    });
  }, [postings, sel]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (postings ?? [])
      .filter((p) => matches(p, sel) && (!needle || p.title.toLowerCase().includes(needle)))
      .sort((a, b) => (b.periodStart ?? b.createdAt).localeCompare(a.periodStart ?? a.createdAt));
  }, [postings, sel, q]);

  // 조건에 맞는 공고가 하나뿐이면 바로 고르고, 고른 공고가 조건 밖으로 나가면 선택을 푼다
  useEffect(() => {
    if (filtered.length === 1) setSelectedId(filtered[0].postingId);
    else if (selectedId && !filtered.some((p) => p.postingId === selectedId)) setSelectedId(null);
  }, [filtered, selectedId]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/recruit/postings/${selectedId}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "공고를 불러오지 못했습니다.");
        if (!cancelled) setDetail(data.posting as RecruitPostingRow);
      } catch (e) {
        if (!cancelled) { toast((e as Error).message, "error"); setDetail(null); }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, toast]);

  const toggleTag = (key: TagKey, value: string) => setSel((s) => ({ ...s, [key]: s[key] === value ? null : value }));
  const anyFilter = sel.platform || sel.year || sel.hire || q;

  // 열 때마다 재조회 — 캐시하면 방금 "부문 템플릿으로 저장"한 새 템플릿이 목록에 안 나타난다.
  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    try {
      const res = await fetch("/api/recruit/templates", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "템플릿을 불러오지 못했습니다.");
      setTemplates(data.templates as RecruitTemplateRow[]);
    } catch (e) {
      toast((e as Error).message, "error");
      setTemplates([]);
    }
  }, [toast]);

  const createFrom = useCallback(
    async (t: RecruitTemplateRow) => {
      setCreating(t.templateId);
      try {
        const res = await fetch("/api/recruit/postings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: t.templateId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "공고 생성 실패");
        router.push(`/admin/recruit/${(data.posting as RecruitPostingRow).postingId}`);
      } catch (e) {
        toast((e as Error).message, "error");
        setCreating(null);
      }
    },
    [router, toast]
  );

  // 재활용 — 지난 공고를 복제해 새 작성중 공고로(내용·부문·구분·플랫폼·근무지역 유지, 기간·공고 주소는 새로).
  const duplicate = useCallback(
    async (p: RecruitPostingRow) => {
      setDuplicating(p.postingId);
      try {
        const res = await fetch("/api/recruit/postings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ copyFrom: p.postingId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "공고 복제 실패");
        router.push(`/admin/recruit/${(data.posting as RecruitPostingRow).postingId}`);
      } catch (e) {
        toast((e as Error).message, "error");
        setDuplicating(null);
      }
    },
    [router, toast]
  );

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      const res = await fetch(`/api/recruit/postings/${confirmDelete.postingId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json())?.error || "삭제 실패");
      toast("공고를 삭제했습니다.", "success");
      if (selectedId === confirmDelete.postingId) setSelectedId(null);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [confirmDelete, load, selectedId, toast]);

  const selected = detail ?? (postings ?? []).find((p) => p.postingId === selectedId) ?? null;
  const siteUrl = selected ? siteUrlOf(selected) : null;

  return (
    <div className="cdash cd-fields-white min-h-screen p-6" data-theme={theme}>
      <CdPageHeader
        breadcrumbs={[{ label: "홍보·채용공고" }, { label: "채용 공고 관리" }]}
        title="채용 공고 관리"
        meta={postings ? (filtered.length === postings.length ? `${postings.length}건` : `${filtered.length}건 / 전체 ${postings.length}건`) : ""}
        actions={
          <div className="flex gap-2">
            <CdButton variant="soft" onClick={() => router.push("/admin/recruit/templates")}>
              템플릿 관리
            </CdButton>
            <CdButton variant="soft" icon={<FileUp className="w-4 h-4" />} onClick={() => setImportOpen(true)}>
              파일에서 가져오기
            </CdButton>
            <CdButton variant="primary" icon={<FilePlus2 className="w-4 h-4" />} onClick={() => void openPicker()}>
              새 공고 작성
            </CdButton>
          </div>
        }
      />

      {postings === null ? (
        <div className="flex items-center gap-2 py-20 justify-center text-sm cd-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
        </div>
      ) : postings.length === 0 ? (
        <CdEmptyState
          icon={<Megaphone className="w-6 h-6" />}
          title="작성된 공고가 없습니다"
          description="템플릿을 골라 첫 채용 공고를 만들어 보세요. 모든 문구는 에디터에서 자유롭게 수정할 수 있습니다."
          action={
            <CdButton variant="primary" icon={<FilePlus2 className="w-4 h-4" />} onClick={() => void openPicker()}>
              새 공고 작성
            </CdButton>
          }
        />
      ) : (
        <div className="grid gap-4 items-start lg:grid-cols-[400px_minmax(0,1fr)]">
          {/* ── 왼쪽: 태그 + 공고 목록 ── */}
          <section className="rounded-lg border cd-border-c cd-card-bg overflow-hidden" aria-label="태그로 찾기">
            <div className="flex items-center gap-2 px-4 py-3 border-b cd-border-c">
              <h2 className="text-sm font-bold cd-text">태그로 찾기</h2>
              <CdHelp label="태그 사용법">
                <p>채용사이트·게재연도·신입/경력 태그는 공고가 있는 값만 보입니다. 같은 줄에서는 하나만 고르고, 다시 누르면 풉니다.</p>
                <p className="mt-1">태그 옆 숫자는 다른 줄의 선택과 함께 남는 공고 수입니다. 0 이면 흐리게 보입니다.</p>
                <p className="mt-1">게재연도는 게재 시작일 기준이고, 시작일이 없는 공고는 작성일 연도로 묶입니다. 비어 있는 값은 미지정·연도 미정·미분류로 모입니다.</p>
              </CdHelp>
              {anyFilter && (
                <button
                  type="button"
                  className="cd-chip cd-chip-sm ml-auto"
                  onClick={() => { setSel({ platform: null, year: null, hire: null }); setQ(""); }}
                >
                  초기화
                </button>
              )}
            </div>
            {/* 세 줄 — 열 사이 연한 세로 구분선 */}
            <div className="grid grid-cols-3">
              {columns.map((col, ci) => (
                <div key={col.key} className="px-3 py-3" style={ci > 0 ? { borderLeft: "1px solid var(--cd-border)" } : undefined}>
                  <div className="text-[11px] font-bold cd-text-muted mb-2">{col.label}</div>
                  <div className="flex flex-col gap-1.5" role="group" aria-label={col.label}>
                    {col.tags.map((t) => {
                      const active = sel[col.key] === t.value;
                      return (
                        <button
                          key={t.value}
                          type="button"
                          className="cd-chip cd-chip-sm justify-between w-full"
                          data-active={active ? "true" : "false"}
                          aria-pressed={active}
                          style={t.count === 0 && !active ? { opacity: 0.45 } : undefined}
                          onClick={() => toggleTag(col.key, t.value)}
                        >
                          <span className="truncate">{t.value}</span>
                          <span className="text-[11px] cd-text-faint tabular-nums">{t.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {/* 조건에 맞는 공고 */}
            <div className="border-t cd-border-c">
              <div className="px-3 py-2 border-b cd-border-c relative">
                <Search className="w-4 h-4 absolute left-6 top-1/2 -translate-y-1/2 cd-text-faint pointer-events-none" />
                <input
                  className="cd-input w-full"
                  style={{ paddingLeft: 36 }}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="제목 검색"
                  aria-label="제목 검색"
                />
              </div>
              {filtered.length === 0 ? (
                <p className="px-4 py-6 text-sm cd-text-muted text-center">조건에 맞는 공고가 없습니다 — 태그를 바꾸거나 초기화하세요.</p>
              ) : (
                <ul className="max-h-[48vh] overflow-y-auto" aria-label="공고 목록">
                  {filtered.map((p, i) => {
                    const ps = periodState(p);
                    const active = p.postingId === selectedId;
                    return (
                      <li key={p.postingId} style={{ borderTop: i > 0 ? "1px solid var(--cd-border)" : undefined }}>
                        <button
                          type="button"
                          className={`w-full text-left px-4 py-2.5 ${active ? "cd-soft-primary" : "hover:cd-soft-primary"}`}
                          aria-current={active ? "true" : undefined}
                          onClick={() => setSelectedId(p.postingId)}
                        >
                          <div className="text-sm font-semibold cd-text truncate" style={{ opacity: ps === "expired" ? 0.75 : undefined }}>{p.title}</div>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] cd-text-muted">
                            <span>{p.platform ?? NO_PLATFORM}</span>
                            <span>·</span>
                            <span>{p.hireType ?? NO_HIRE}</span>
                            {formatPeriod(p) && <><span>·</span><span>{formatPeriod(p)}</span></>}
                            {ps === "expired" && <CdBadge tone="error">만료</CdBadge>}
                            {ps === "open" && <CdBadge tone="success">진행중</CdBadge>}
                            {ps === "upcoming" && <CdBadge tone="info">예정</CdBadge>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* ── 오른쪽: 요약 + 미리보기 ── */}
          <section className="min-w-0" aria-label="공고 요약·미리보기">
            {!selected ? (
              <div className="rounded-lg border cd-border-c cd-card-bg">
                <CdEmptyState
                  icon={<Megaphone className="w-6 h-6" />}
                  title="공고를 고르세요"
                  description="왼쪽에서 태그를 고르거나 목록의 공고를 누르면 요약과 미리보기가 여기에 보입니다."
                />
              </div>
            ) : (
              <>
                <div className="rounded-lg border cd-border-c cd-card-bg p-4 mb-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-bold cd-text truncate">{selected.title}</h2>
                      <div className="flex items-center gap-1.5 mt-1">
                        <CdBadge tone={selected.status === "final" ? "success" : "info"}>{selected.status === "final" ? "확정" : "작성중"}</CdBadge>
                        {periodState(selected) === "expired" && <CdBadge tone="error">만료</CdBadge>}
                        {periodState(selected) === "open" && <CdBadge tone="success">진행중</CdBadge>}
                        {periodState(selected) === "upcoming" && <CdBadge tone="info">예정</CdBadge>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <CdButton
                        variant="soft"
                        icon={<ExternalLink className="w-4 h-4" />}
                        disabled={!siteUrl}
                        title={siteUrl ? siteUrl : "플랫폼을 모르거나 공고 주소가 없습니다 — 에디터에서 플랫폼·공고 주소를 적으세요"}
                        onClick={() => { if (siteUrl) window.open(siteUrl, "_blank", "noopener"); }}
                      >
                        채용사이트 열기
                      </CdButton>
                      <CdButton
                        variant="soft"
                        icon={exporting === "png" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        disabled={exporting !== null || !detail}
                        title="채용 플랫폼 게시용 PNG(가로 px 선택)"
                        onClick={openPngModal}
                      >
                        PNG
                      </CdButton>
                      <CdButton
                        variant="soft"
                        icon={exporting === "pdf" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                        disabled={exporting !== null || !detail}
                        title="인쇄·공유용 PDF"
                        onClick={() => void doExport("pdf")}
                      >
                        PDF
                      </CdButton>
                      <CdButton
                        variant="soft"
                        icon={duplicating === selected.postingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                        disabled={duplicating !== null}
                        title="복제해서 새 공고 작성 (내용·부문·구분·플랫폼·근무지역 유지, 기간·공고 주소는 새로 입력)"
                        onClick={() => void duplicate(selected)}
                      >
                        복제
                      </CdButton>
                      <CdButton variant="soft" icon={<Trash2 className="w-4 h-4" />} onClick={() => setConfirmDelete(selected)}>
                        삭제
                      </CdButton>
                      <CdButton variant="primary" icon={<Pencil className="w-4 h-4" />} onClick={() => router.push(`/admin/recruit/${selected.postingId}`)}>
                        편집
                      </CdButton>
                    </div>
                  </div>
                  <dl className="grid gap-x-6 gap-y-2 mt-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
                    <SummaryItem label="채용사이트" value={selected.platform ?? "-"} />
                    <SummaryItem label="대상 분야" value={splitDivision(selected.division).field ?? "-"} />
                    <SummaryItem label="근무지역" value={workLocationOf(selected) ?? "-"} />
                    <SummaryItem label="신입/경력" value={selected.hireType ?? "-"} />
                    <SummaryItem label="게재일" value={selected.periodStart ?? "-"} />
                    <SummaryItem
                      label="게재기간"
                      value={
                        formatPeriod(selected)
                          ? `${formatPeriod(selected)}${dDayText(daysUntilEnd(selected))}`
                          : "-"
                      }
                    />
                    <SummaryItem
                      label="지원자 수"
                      value={latestCount ? `${latestCount.count}명 (${latestCount.countedOn} 기준)` : "미기록"}
                    />
                    <SummaryItem label="템플릿" value={selected.templateName ?? "-"} />
                    <SummaryItem label="최근 수정" value={selected.updatedAt.slice(0, 16).replace("T", " ")} />
                    <SummaryItem
                      label="공고 주소"
                      value={
                        selected.postingUrl ? (
                          <a href={selected.postingUrl} target="_blank" rel="noopener noreferrer" className="underline break-all" style={{ color: "var(--cd-primary)" }}>
                            {selected.postingUrl}
                          </a>
                        ) : (
                          "-"
                        )
                      }
                    />
                  </dl>
                  {!selected.platform && !selected.hireType && !selected.periodStart && (
                    <p className="mt-3 text-xs cd-text-muted">
                      채용사이트·신입/경력·게재일이 비어 있어 태그에 미지정으로 묶입니다 — [편집]의 구분 메타에서 채우세요.
                    </p>
                  )}
                </div>
                <PostingTrackingCard key={selected.postingId} postingId={selected.postingId} canManage onCountsChange={setLatestCount} />
                <div className="rounded-lg border cd-border-c overflow-hidden">
                  {detailLoading || !detail ? (
                    <div className="flex items-center gap-2 py-16 justify-center text-sm cd-text-muted">
                      <Loader2 className="w-4 h-4 animate-spin" /> 미리보기 불러오는 중…
                    </div>
                  ) : (
                    <DocFitPreview tree={detail.contentTree} theme={detail.theme} docWidth={detail.docWidth ?? 900} />
                  )}
                </div>
                {/* 내보내기용 원본 크기 문서 — 화면 밖(스크롤 영향 없음) */}
                {detail && (
                  <div aria-hidden style={{ position: "absolute", left: -20000, top: 0, pointerEvents: "none" }}>
                    <DocCanvas ref={exportRef} tree={detail.contentTree} theme={detail.theme} width={detail.docWidth ?? 900} />
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {/* 템플릿 선택 모달 */}
      <CdModal open={pickerOpen} onClose={() => setPickerOpen(false)} title="템플릿 선택" size="xl">
        {templates === null ? (
          <div className="flex items-center gap-2 py-10 justify-center text-sm cd-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" /> 템플릿 불러오는 중…
          </div>
        ) : templates.length === 0 ? (
          <CdEmptyState
            title="사용 가능한 템플릿이 없습니다"
            description="템플릿 관리에서 기본 템플릿을 설치하거나 핸드오프 패키지를 업로드하세요."
            action={
              <CdButton variant="primary" onClick={() => router.push("/admin/recruit/templates")}>
                템플릿 관리로 이동
              </CdButton>
            }
          />
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
            {templates.map((t) => (
              <button
                key={t.templateId}
                type="button"
                disabled={creating !== null}
                onClick={() => void createFrom(t)}
                className="rounded-lg border cd-border-c overflow-hidden text-left hover:border-[color:var(--cd-primary)]"
              >
                <DocMiniPreview tree={t.designTree} theme={t.theme} docWidth={t.docWidth} previewWidth={210} previewHeight={170} />
                <div className="p-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-bold cd-text truncate">{t.name}</span>
                  {creating === t.templateId && <Loader2 className="w-4 h-4 animate-spin cd-text-muted" />}
                </div>
              </button>
            ))}
          </div>
        )}
      </CdModal>

      {/* 삭제 확인 */}
      <CdModal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="공고 삭제"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <CdButton onClick={() => setConfirmDelete(null)}>취소</CdButton>
            <CdButton variant="danger" onClick={() => void doDelete()}>삭제</CdButton>
          </div>
        }
      >
        <p className="text-sm cd-text">
          「{confirmDelete?.title}」 공고를 삭제할까요? 삭제된 공고는 목록에서 사라집니다.
        </p>
      </CdModal>

      {/* 원본 공고 파일에서 가져오기 */}
      <ImportPostingModal open={importOpen} onClose={() => setImportOpen(false)} />
      <PngExportModal open={pngOpen} onClose={() => setPngOpen(false)} docRatio={docRatio} onExport={(w, f) => void doExport("png", w, f)} />
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold cd-text-muted">{label}</dt>
      <dd className="cd-text break-words">{value}</dd>
    </div>
  );
}

/** 마감 D-day 꼬리표 — " · D-3" / " · D-day" / 지났으면 " · 3일 지남" */
function dDayText(days: number | null): string {
  if (days == null) return "";
  if (days === 0) return " · D-day";
  return days > 0 ? ` · D-${days}` : ` · ${-days}일 지남`;
}
