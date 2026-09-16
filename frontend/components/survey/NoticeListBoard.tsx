"use client";

// QR 배포 이미지 목록 — 설문과 무관하게 단독으로도 만들 수 있다(외부 기관 의뢰 건 등).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Image as ImageIcon, Loader2 } from "lucide-react";
import { CdBadge, CdButton, CdEmptyState, CdPageHeader, useCdashTheme, useCdToast } from "@/components/cdash";
import type { SurveyNoticeRow } from "@/lib/survey/types";

export function NoticeListBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();
  const [notices, setNotices] = useState<SurveyNoticeRow[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/survey/notices", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "목록을 불러오지 못했습니다.");
      setNotices(data.notices as SurveyNoticeRow[]);
    } catch (e) {
      toast((e as Error).message, "error");
      setNotices([]);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/survey/notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "새 배포 이미지", layout: "phone" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "생성 실패");
      router.push(`/survey/notices/${(data.notice as SurveyNoticeRow).noticeId}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setCreating(false);
    }
  }, [router, toast]);

  return (
    <div className="cdash cd-fields-white min-h-screen p-6" data-theme={theme}>
      <CdPageHeader
        breadcrumbs={[{ label: "설문" }, { label: "QR 배포 이미지" }]}
        title="QR 배포 이미지"
        meta={notices ? `${notices.length}건` : ""}
        actions={
          <CdButton variant="primary" icon={<FilePlus2 className="w-4 h-4" />} disabled={creating} onClick={() => void create()}>
            {creating ? "생성 중…" : "새 배포 이미지"}
          </CdButton>
        }
      />

      {notices === null ? (
        <div className="flex items-center gap-2 py-20 justify-center text-sm cd-text-muted">
          <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
        </div>
      ) : notices.length === 0 ? (
        <CdEmptyState
          icon={<ImageIcon className="w-6 h-6" />}
          title="배포 이미지가 없습니다"
          description="설문 링크를 QR로 바꾸고, 대상 기관 로고·기간·주관을 넣은 안내 이미지를 만듭니다."
          action={
            <CdButton variant="primary" icon={<FilePlus2 className="w-4 h-4" />} onClick={() => void create()}>
              새 배포 이미지
            </CdButton>
          }
        />
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {notices.map((n) => (
            <button
              key={n.noticeId}
              type="button"
              className="rounded-2xl border cd-border-c cd-card-bg p-5 text-left transition-colors hover:cd-soft-primary"
              onClick={() => router.push(`/survey/notices/${n.noticeId}`)}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold cd-text">{n.name}</span>
                <CdBadge tone="idle">{n.layout === "phone" ? "스마트폰" : "메일"}</CdBadge>
              </div>
              {n.surveyTitle && <p className="mt-1 text-xs cd-text-faint">설문: {n.surveyTitle}</p>}
              <div className="mt-3 flex items-center gap-2">
                {n.theme.bandColors.map((c, i) => (
                  <span key={i} className="inline-block rounded" style={{ width: 22, height: 10, background: c }} />
                ))}
                <span className="text-xs cd-text-faint ml-auto">{n.updatedAt.slice(0, 10)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
