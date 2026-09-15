"use client";

// 채용공고 목록 — 작성된 공고 관리 + "새 공고"(템플릿 선택 → 에디터 진입).
// 공고는 제목 외에 부문·구분·플랫폼·기간으로 구별한다: 상단 검색 옵션, 열 표시, 만료 표시, 행 복제(재활용).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, FilePlus2, FileUp, Loader2, Megaphone, Search, Trash2 } from "lucide-react";
import { CdBadge, CdButton, CdEmptyState, CdModal, CdPageHeader, useCdashTheme, useCdToast } from "@/components/cdash";
import type { RecruitPostingRow, RecruitTemplateRow } from "@/lib/recruit/types";
import { DIVISION_PRESETS, HIRE_TYPE_PRESETS, PLATFORM_PRESETS, formatPeriod, periodState } from "@/lib/recruit/meta";
import { DocMiniPreview } from "./DocCanvas";
import { ImportPostingModal } from "./ImportPostingModal";

/** 프리셋 ∪ 목록에 실제로 쓰인 값 — 자유 입력한 값도 검색 옵션에 나타나게. */
function optionsOf(presets: readonly string[], values: (string | null | undefined)[]): string[] {
  const set = new Set<string>(presets);
  values.forEach((v) => { if (v) set.add(v); });
  return Array.from(set);
}

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
  // 검색 옵션 — 목록이 작아 클라이언트에서 거른다(서버 GET 도 같은 파라미터를 받는다).
  const [fDivision, setFDivision] = useState("");
  const [fHire, setFHire] = useState("");
  const [fPlatform, setFPlatform] = useState("");
  const [q, setQ] = useState("");

  const divisionOptions = useMemo(() => optionsOf(DIVISION_PRESETS, (postings ?? []).map((p) => p.division)), [postings]);
  const hireOptions = useMemo(() => optionsOf(HIRE_TYPE_PRESETS, (postings ?? []).map((p) => p.hireType)), [postings]);
  const platformOptions = useMemo(() => optionsOf(PLATFORM_PRESETS, (postings ?? []).map((p) => p.platform)), [postings]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (postings ?? []).filter(
      (p) =>
        (!fDivision || p.division === fDivision) &&
        (!fHire || p.hireType === fHire) &&
        (!fPlatform || p.platform === fPlatform) &&
        (!needle || p.title.toLowerCase().includes(needle))
    );
  }, [postings, fDivision, fHire, fPlatform, q]);

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

  // 재활용 — 지난 공고를 복제해 새 작성중 공고로(내용·부문·구분·플랫폼 유지, 기간은 새로).
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
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }, [confirmDelete, load, toast]);

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

      {/* 검색 옵션 — 부문·구분·플랫폼 + 제목 검색 */}
      {postings !== null && postings.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select className="cd-select" value={fDivision} onChange={(e) => setFDivision(e.target.value)} aria-label="공고부문">
            <option value="">부문: 전체</option>
            {divisionOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="cd-select" value={fHire} onChange={(e) => setFHire(e.target.value)} aria-label="공고 구분">
            <option value="">구분: 전체</option>
            {hireOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="cd-select" value={fPlatform} onChange={(e) => setFPlatform(e.target.value)} aria-label="플랫폼">
            <option value="">플랫폼: 전체</option>
            {platformOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 cd-text-faint pointer-events-none" />
            <input
              className="cd-input pl-8"
              style={{ width: 240 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="제목 검색"
              aria-label="제목 검색"
            />
          </div>
          {(fDivision || fHire || fPlatform || q) && (
            <CdButton size="sm" onClick={() => { setFDivision(""); setFHire(""); setFPlatform(""); setQ(""); }}>
              초기화
            </CdButton>
          )}
        </div>
      )}

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
      ) : filtered.length === 0 ? (
        <CdEmptyState
          icon={<Search className="w-6 h-6" />}
          title="검색 조건에 맞는 공고가 없습니다"
          description="부문·구분·플랫폼·제목 조건을 바꾸거나 초기화하세요."
        />
      ) : (
        <div className="rounded-2xl border cd-border-c cd-card-bg overflow-hidden" style={{ boxShadow: "var(--cd-shadow)" }}>
          <table className="w-full text-sm">
            <thead className="cd-table-head">
              <tr className="text-left text-xs cd-text-muted">
                <th className="px-5 py-3 font-semibold">공고 제목</th>
                <th className="px-4 py-3 font-semibold">부문</th>
                <th className="px-4 py-3 font-semibold">구분</th>
                <th className="px-4 py-3 font-semibold">플랫폼</th>
                <th className="px-4 py-3 font-semibold">공고기간</th>
                <th className="px-4 py-3 font-semibold">템플릿</th>
                <th className="px-4 py-3 font-semibold">상태</th>
                <th className="px-4 py-3 font-semibold">최근 수정</th>
                <th className="px-4 py-3 font-semibold w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const ps = periodState(p);
                return (
                  <tr
                    key={p.postingId}
                    className="cursor-pointer transition-colors hover:cd-soft-primary"
                    style={{ borderTop: i > 0 ? "1px solid var(--cd-border)" : undefined, opacity: ps === "expired" ? 0.75 : undefined }}
                    onClick={() => router.push(`/admin/recruit/${p.postingId}`)}
                  >
                    <td className="px-5 py-3.5 font-semibold cd-text">{p.title}</td>
                    <td className="px-4 py-3.5 cd-text-muted whitespace-nowrap">{p.division ?? "-"}</td>
                    <td className="px-4 py-3.5 cd-text-muted whitespace-nowrap">{p.hireType ?? "-"}</td>
                    <td className="px-4 py-3.5 cd-text-muted whitespace-nowrap">{p.platform ?? "-"}</td>
                    <td className="px-4 py-3.5 cd-text-muted whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        {formatPeriod(p) || "-"}
                        {ps === "expired" && <CdBadge tone="error">만료</CdBadge>}
                        {ps === "open" && <CdBadge tone="success">진행중</CdBadge>}
                        {ps === "upcoming" && <CdBadge tone="info">예정</CdBadge>}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 cd-text-muted">{p.templateName ?? "-"}</td>
                    <td className="px-4 py-3.5">
                      <CdBadge tone={p.status === "final" ? "success" : "info"}>
                        {p.status === "final" ? "확정" : "작성중"}
                      </CdBadge>
                    </td>
                    <td className="px-4 py-3.5 cd-text-muted whitespace-nowrap">{p.updatedAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <button
                        type="button"
                        title="복제해서 새 공고 작성 (내용·부문·구분·플랫폼 유지, 기간은 새로 입력)"
                        className="p-1.5 rounded-lg cd-text-faint hover:text-[color:var(--cd-primary)]"
                        disabled={duplicating !== null}
                        onClick={(e) => { e.stopPropagation(); void duplicate(p); }}
                      >
                        {duplicating === p.postingId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        title="삭제"
                        className="p-1.5 rounded-lg cd-text-faint hover:text-[color:var(--cd-error)]"
                        onClick={(e) => { e.stopPropagation(); setConfirmDelete(p); }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
                className="rounded-xl border cd-border-c overflow-hidden text-left hover:shadow-md transition-shadow"
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
    </div>
  );
}
