"use client";

// 템플릿 관리 — 등록된 템플릿 라인업(축소 미리보기 카드) + 핸드오프 패키지 업로드로 라인업 확장.
// 기본 템플릿(저장소 번들 채용공고 디자인)은 목록이 비어 있을 때 원클릭으로 설치할 수 있다.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, LayoutTemplate, Loader2, Pencil, Sparkles, Upload } from "lucide-react";
import { CdBadge, CdButton, CdEmptyState, CdModal, CdPageHeader, useCdashTheme, useCdToast } from "@/components/cdash";
import type { RecruitTemplateRow } from "@/lib/recruit/types";
import { parseHandoffHtml } from "@/lib/recruit/parse";
import { DocMiniPreview } from "./DocCanvas";
import { TemplateUploadModal } from "./TemplateUploadModal";

// 저장소에 번들된 기본 템플릿(클로드 디자인 핸드오프 — 채용공고)
const SEED_URL = "/recruit-seed/job-posting-template.html";

export function TemplateBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const [templates, setTemplates] = useState<RecruitTemplateRow[] | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/recruit/templates?all=1", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "목록을 불러오지 못했습니다.");
      setTemplates(data.templates as RecruitTemplateRow[]);
    } catch (e) {
      toast((e as Error).message, "error");
      setTemplates([]);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const installSeed = useCallback(async () => {
    setSeeding(true);
    try {
      const html = await (await fetch(SEED_URL)).text();
      const parsed = parseHandoffHtml(html);
      const res = await fetch("/api/recruit/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "채용공고 기본 템플릿",
          description: "섹션형 모던 채용공고 — 헤더/모집부문/지원서 접수/전형절차/근무환경/문의 구성.",
          tree: parsed.tree,
          theme: parsed.theme,
          docWidth: parsed.docWidth,
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || "기본 템플릿 등록 실패");
      toast("기본 템플릿을 설치했습니다.", "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSeeding(false);
    }
  }, [load, toast]);

  // 템플릿 복제 — 새 이름으로 디자인·내용 그대로 사본 등록(예: 잡코리아 → 사람인 변형 만들기).
  const [dupTarget, setDupTarget] = useState<RecruitTemplateRow | null>(null);
  const [dupName, setDupName] = useState("");
  const [dupBusy, setDupBusy] = useState(false);
  const router = useRouter();

  const duplicateTemplate = useCallback(async () => {
    if (!dupTarget || !dupName.trim()) return;
    setDupBusy(true);
    try {
      const res = await fetch("/api/recruit/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: dupName,
          description: dupTarget.description ?? "",
          tree: dupTarget.designTree,
          theme: dupTarget.theme,
          docWidth: dupTarget.docWidth,
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || "복제 실패");
      toast(`「${dupName.trim()}」 템플릿을 만들었습니다. 내용 수정은 '내용 편집'으로 이어가세요.`, "success");
      setDupTarget(null);
      setDupName("");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setDupBusy(false);
    }
  }, [dupTarget, dupName, load, toast]);

  // 이름·설명 수정
  const [renameTarget, setRenameTarget] = useState<RecruitTemplateRow | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDesc, setRenameDesc] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  const renameTemplate = useCallback(async () => {
    if (!renameTarget || !renameName.trim()) return;
    setRenameBusy(true);
    try {
      const res = await fetch(`/api/recruit/templates/${renameTarget.templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameName, description: renameDesc }),
      });
      if (!res.ok) throw new Error((await res.json())?.error || "수정 실패");
      toast("템플릿 정보를 수정했습니다.", "success");
      setRenameTarget(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRenameBusy(false);
    }
  }, [renameTarget, renameName, renameDesc, load, toast]);

  // 템플릿 내용 편집 — 편집용 공고를 만들어 에디터로 이동. 수정 후 "부문 템플릿으로 저장"으로 마무리.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editTemplate = useCallback(
    async (t: RecruitTemplateRow) => {
      setEditingId(t.templateId);
      try {
        const res = await fetch("/api/recruit/postings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: t.templateId, title: `${t.name} — 템플릿 편집용` }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "편집용 공고 생성 실패");
        router.push(`/admin/recruit/${data.posting.postingId}`);
      } catch (e) {
        toast((e as Error).message, "error");
        setEditingId(null);
      }
    },
    [router, toast]
  );

  const toggleActive = useCallback(
    async (t: RecruitTemplateRow) => {
      try {
        const res = await fetch(`/api/recruit/templates/${t.templateId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !t.isActive }),
        });
        if (!res.ok) throw new Error((await res.json())?.error || "변경 실패");
        await load();
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [load, toast]
  );

  return (
    <div className="cdash cd-fields-white min-h-screen p-6" data-theme={theme}>
      <CdPageHeader
        breadcrumbs={[{ label: "홍보·채용공고", href: "/admin/recruit" }, { label: "템플릿 관리" }]}
        title="템플릿 관리"
        meta={templates ? `${templates.length}개 템플릿` : ""}
        actions={
          <CdButton variant="primary" icon={<Upload className="w-4 h-4" />} onClick={() => setUploadOpen(true)}>
            핸드오프 패키지 업로드
          </CdButton>
        }
      />

      {templates === null ? (
        <div className="flex items-center gap-2 py-20 justify-center text-sm cd-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
        </div>
      ) : templates.length === 0 ? (
        <CdEmptyState
          icon={<LayoutTemplate className="w-6 h-6" />}
          title="등록된 템플릿이 없습니다"
          description="클로드 디자인 핸드오프 패키지를 업로드하거나, 번들된 기본 채용공고 템플릿으로 시작하세요."
          action={
            <div className="flex gap-2">
              <CdButton variant="primary" loading={seeding} icon={<Sparkles className="w-4 h-4" />} onClick={() => void installSeed()}>
                기본 템플릿 설치
              </CdButton>
              <CdButton variant="soft" icon={<Upload className="w-4 h-4" />} onClick={() => setUploadOpen(true)}>
                패키지 업로드
              </CdButton>
            </div>
          }
        />
      ) : (
        <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
          {templates.map((t) => (
            <div
              key={t.templateId}
              className="rounded-2xl border cd-border-c cd-card-bg overflow-hidden flex flex-col"
              style={{ boxShadow: "var(--cd-shadow)", opacity: t.isActive ? 1 : 0.55 }}
            >
              <DocMiniPreview
                tree={t.designTree}
                theme={t.theme}
                docWidth={t.docWidth}
                previewWidth={250}
                previewHeight={220}
              />
              <div className="p-4 flex flex-col gap-1.5 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold cd-text truncate flex items-center gap-1 min-w-0">
                    <span className="truncate">{t.name}</span>
                    <button
                      type="button"
                      title="이름·설명 수정"
                      className="p-0.5 rounded cd-text-faint hover:text-[color:var(--cd-primary)] shrink-0"
                      onClick={() => {
                        setRenameTarget(t);
                        setRenameName(t.name);
                        setRenameDesc(t.description ?? "");
                      }}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </span>
                  <CdBadge tone={t.isActive ? "success" : "idle"}>{t.isActive ? "사용중" : "비활성"}</CdBadge>
                </div>
                {t.description && <p className="text-xs cd-text-muted line-clamp-2">{t.description}</p>}
                <div className="text-[11px] cd-text-faint">등록 {t.createdAt.slice(0, 10)}</div>
                <div className="mt-auto pt-2 flex flex-col gap-1.5">
                  <div className="flex gap-1.5">
                    <CdButton
                      size="sm"
                      variant="soft"
                      className="flex-1"
                      icon={<Copy className="w-3.5 h-3.5" />}
                      onClick={() => { setDupTarget(t); setDupName(`${t.name} 사본`); }}
                    >
                      복제
                    </CdButton>
                    <CdButton
                      size="sm"
                      variant="soft"
                      className="flex-1"
                      icon={editingId === t.templateId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />}
                      disabled={editingId !== null}
                      onClick={() => void editTemplate(t)}
                    >
                      내용 편집
                    </CdButton>
                  </div>
                  <CdButton size="sm" block onClick={() => void toggleActive(t)}>
                    {t.isActive ? "비활성으로 전환" : "다시 활성화"}
                  </CdButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <TemplateUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onRegistered={() => { setUploadOpen(false); void load(); }}
      />

      {/* 이름·설명 수정 */}
      <CdModal
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="템플릿 정보 수정"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <CdButton onClick={() => setRenameTarget(null)}>취소</CdButton>
            <CdButton variant="primary" loading={renameBusy} disabled={!renameName.trim()} onClick={() => void renameTemplate()}>
              저장
            </CdButton>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-bold mb-1 cd-text-muted">템플릿 이름</label>
            <input className="cd-input w-full" value={renameName} onChange={(e) => setRenameName(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1 cd-text-muted">설명</label>
            <textarea className="cd-input w-full resize-none" rows={3} value={renameDesc} onChange={(e) => setRenameDesc(e.target.value)} />
          </div>
        </div>
      </CdModal>

      {/* 템플릿 복제 — 새 이름 지정 */}
      <CdModal
        open={dupTarget !== null}
        onClose={() => setDupTarget(null)}
        title="템플릿 복제"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <CdButton onClick={() => setDupTarget(null)}>취소</CdButton>
            <CdButton variant="primary" loading={dupBusy} disabled={!dupName.trim()} onClick={() => void duplicateTemplate()}>
              복제
            </CdButton>
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          <label className="block text-xs font-bold cd-text-muted">새 템플릿 이름</label>
          <input
            className="cd-input w-full"
            value={dupName}
            onChange={(e) => setDupName(e.target.value)}
            placeholder="예: 사람인 채용공고 템플릿"
          />
          <p className="text-[11px] cd-text-faint">
            「{dupTarget?.name}」의 디자인과 내용을 그대로 사본으로 만듭니다.
            텍스트를 고친 변형 템플릿이 목적이라면, 복제 대신 원본 카드의 <b>내용 편집</b>으로
            들어가 수정한 뒤 <b>부문 템플릿으로 저장</b>에서 새 이름을 붙이는 쪽이 한 번에 끝납니다
            (편집용 공고는 공고 목록에서 지우면 됩니다).
          </p>
        </div>
      </CdModal>
    </div>
  );
}
