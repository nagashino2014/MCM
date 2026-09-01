"use client";

// 템플릿 관리 — 등록된 템플릿 라인업(축소 미리보기 카드) + 핸드오프 패키지 업로드로 라인업 확장.
// 기본 템플릿(저장소 번들 채용공고 디자인)은 목록이 비어 있을 때 원클릭으로 설치할 수 있다.

import { useCallback, useEffect, useState } from "react";
import { LayoutTemplate, Loader2, Sparkles, Upload } from "lucide-react";
import { CdBadge, CdButton, CdEmptyState, CdPageHeader, useCdashTheme, useCdToast } from "@/components/cdash";
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
                  <span className="text-sm font-bold cd-text truncate">{t.name}</span>
                  <CdBadge tone={t.isActive ? "success" : "idle"}>{t.isActive ? "사용중" : "비활성"}</CdBadge>
                </div>
                {t.description && <p className="text-xs cd-text-muted line-clamp-2">{t.description}</p>}
                <div className="text-[11px] cd-text-faint">등록 {t.createdAt.slice(0, 10)}</div>
                <div className="mt-auto pt-2">
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
    </div>
  );
}
