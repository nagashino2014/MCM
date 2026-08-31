"use client";

// 작성 중 첨부 미리보기 모달(2026-08-25) — 공문·기안 작성 화면의 첨부 목록에서 항목을 누르면
// 상신 전에도 내용을 확인할 수 있다(대금청구서 PDF·개인카드 영수증 등). 아직 docId 가 없어
// key 기반 preview 라우트(/api/approval/attachments/preview)를 쓰고, pdf·이미지는 원본 그대로,
// hwpx·docx·xlsx·pptx 는 서버 변환 PDF(DocAttachmentViewer 와 같은 규약)를 띄운다.

import { useEffect, useState } from "react";
import { Download, FileWarning, X } from "lucide-react";
import {
  attachmentPreviewKind,
  attachmentTypeLabel,
  formatBytes,
  type DocAttachment,
} from "@/lib/approval/attachments";

export default function AttachmentPreviewModal({ item, onClose }: { item: DocAttachment; onClose: () => void }) {
  const [convertError, setConvertError] = useState<string | null>(null);

  const kind = attachmentPreviewKind(item.name);
  const base = `/api/approval/attachments/preview?key=${encodeURIComponent(item.key)}&name=${encodeURIComponent(item.name)}`;
  const src = kind === "convert" ? `${base}&mode=pdf` : base;

  // 변환 실패는 iframe 안에 JSON 이 뜨는 형태라 사용자가 이해하기 어렵다.
  // GET 으로 상태만 미리 확인해 배너로 안내한다(본문은 캐시로 재사용됨).
  useEffect(() => {
    setConvertError(null);
    if (kind !== "convert") return;
    let cancelled = false;
    fetch(src, { cache: "no-store" })
      .then(async (r) => {
        if (r.ok || cancelled) return;
        const data = await r.json().catch(() => null);
        setConvertError((data as { error?: string } | null)?.error ?? `미리보기를 만들지 못했습니다(HTTP ${r.status}).`);
      })
      .catch((err) => {
        if (!cancelled) setConvertError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [src, kind]);

  return (
    <div className="fixed inset-0 z-[97] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative cd-solid-bg border cd-border-c rounded-3xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl" style={{ maxWidth: 960 }}>
        <div className="flex items-center gap-2 px-5 py-3 border-b cd-border-c">
          <span className="text-[13px] font-bold cd-text truncate">{item.name}</span>
          <span className="text-[10.5px] rounded-full px-2 py-0.5 border cd-border-c cd-text-faint shrink-0">{attachmentTypeLabel(item.name)}</span>
          {item.size > 0 && <span className="text-[11px] cd-text-faint shrink-0">{formatBytes(item.size)}</span>}
          {kind === "convert" && !convertError && (
            <span className="text-[10.5px] cd-text-faint hidden md:inline">원본을 PDF 로 변환해 표시합니다 — 서식이 일부 다를 수 있습니다.</span>
          )}
          <a
            href={`${base}&download=1`}
            className="ml-auto cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] flex items-center gap-1 shrink-0"
          >
            <Download className="w-3.5 h-3.5" /> 원본 내려받기
          </a>
          <button type="button" onClick={onClose} className="cd-text-muted hover:cd-text shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {convertError ? (
            <div
              className="rounded-xl border px-3.5 py-3 flex flex-col gap-1"
              style={{ borderColor: "var(--cd-warning,#FFAE1F)", background: "var(--cd-warning-soft, rgba(255,174,31,0.1))" }}
            >
              <span className="text-[11.5px] font-bold flex items-center gap-1.5" style={{ color: "var(--cd-warning,#FFAE1F)" }}>
                <FileWarning className="w-4 h-4" /> 미리보기를 표시할 수 없습니다
              </span>
              <p className="text-[12px] cd-text">{convertError}</p>
              <span className="text-[10.5px] cd-text-faint">위 [원본 내려받기]로 파일을 확인해 주세요.</span>
            </div>
          ) : kind === "image" ? (
            <div className="rounded-[14px] p-3 flex justify-center" style={{ border: "1px solid var(--cd-active-border)", background: "var(--cd-active-fill)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={item.name} className="max-w-full" style={{ maxHeight: "76vh" }} />
            </div>
          ) : (
            <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--cd-active-border)" }}>
              <iframe title={item.name} src={src} className="w-full" style={{ height: "76vh", background: "#fff" }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
