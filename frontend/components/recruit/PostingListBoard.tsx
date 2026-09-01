"use client";

// 채용공고 목록 — 작성된 공고 관리 + "새 공고"(템플릿 선택 → 에디터 진입).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2, Megaphone, Trash2 } from "lucide-react";
import { CdBadge, CdButton, CdEmptyState, CdModal, CdPageHeader, useCdashTheme, useCdToast } from "@/components/cdash";
import type { RecruitPostingRow, RecruitTemplateRow } from "@/lib/recruit/types";
import { DocMiniPreview } from "./DocCanvas";

export function PostingListBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();
  const [postings, setPostings] = useState<RecruitPostingRow[] | null>(null);
  const [templates, setTemplates] = useState<RecruitTemplateRow[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RecruitPostingRow | null>(null);

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

  const openPicker = useCallback(async () => {
    setPickerOpen(true);
    if (templates === null) {
      try {
        const res = await fetch("/api/recruit/templates", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "템플릿을 불러오지 못했습니다.");
        setTemplates(data.templates as RecruitTemplateRow[]);
      } catch (e) {
        toast((e as Error).message, "error");
        setTemplates([]);
      }
    }
  }, [templates, toast]);

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
        meta={postings ? `${postings.length}건` : ""}
        actions={
          <div className="flex gap-2">
            <CdButton variant="soft" onClick={() => router.push("/admin/recruit/templates")}>
              템플릿 관리
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
        <div className="rounded-2xl border cd-border-c cd-card-bg overflow-hidden" style={{ boxShadow: "var(--cd-shadow)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs cd-text-muted">
                <th className="px-5 py-3 font-semibold">공고 제목</th>
                <th className="px-5 py-3 font-semibold">템플릿</th>
                <th className="px-5 py-3 font-semibold">상태</th>
                <th className="px-5 py-3 font-semibold">최근 수정</th>
                <th className="px-5 py-3 font-semibold w-16"></th>
              </tr>
            </thead>
            <tbody>
              {postings.map((p, i) => (
                <tr
                  key={p.postingId}
                  className="cursor-pointer transition-colors hover:cd-soft-primary"
                  style={{ borderTop: i > 0 ? "1px solid var(--cd-border)" : undefined }}
                  onClick={() => router.push(`/admin/recruit/${p.postingId}`)}
                >
                  <td className="px-5 py-3.5 font-semibold cd-text">{p.title}</td>
                  <td className="px-5 py-3.5 cd-text-muted">{p.templateName ?? "-"}</td>
                  <td className="px-5 py-3.5">
                    <CdBadge tone={p.status === "final" ? "success" : "info"}>
                      {p.status === "final" ? "확정" : "작성중"}
                    </CdBadge>
                  </td>
                  <td className="px-5 py-3.5 cd-text-muted">{p.updatedAt.slice(0, 16).replace("T", " ")}</td>
                  <td className="px-5 py-3.5">
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
              ))}
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
    </div>
  );
}
