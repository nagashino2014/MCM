"use client";

// 기안 화면 첨부 미리보기 — 아직 문서로 저장되기 전이라 docId 대신 스토리지 key 로 읽는다.
// 개인카드 영수증 증빙 PDF·법인카드 전자 전표가 자동으로 첨부되므로, 담은 증빙이 맞는지
// 상신 전에 그 자리에서 확인할 수 있어야 한다(사용자 요구 2026-08-20).
// 저장된 문서의 뷰어는 DocAttachmentViewer(docId 경로) — 렌더 규칙은 같다.

import { useEffect, useState } from "react";
import { Download, FileWarning } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import {
  attachmentPreviewKind,
  attachmentTypeLabel,
  formatBytes,
  type DocAttachment,
} from "@/lib/approval/attachments";

export function DraftAttachmentModal({ item, onClose }: { item: DocAttachment | null; onClose: () => void }) {
  const [convertError, setConvertError] = useState<string | null>(null);
  const kind = item ? attachmentPreviewKind(item.name) : "pdf";
  const base = item ? `/api/approval/attachments?key=${encodeURIComponent(item.key)}` : "";
  const src = kind === "convert" ? `${base}&mode=pdf` : base;

  // 변환 실패는 iframe 안에 JSON 이 뜨는 형태라 사용자가 이해하기 어렵다 — 배너로 안내한다.
  useEffect(() => {
    setConvertError(null);
    if (!item || kind !== "convert") return;
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
  }, [src, kind, item]);

  return (
    <CdModal open={!!item} onClose={onClose} title={item?.name ?? "첨부 미리보기"} size="xl">
      {item && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10.5px] rounded-full px-2 py-0.5 border cd-border-c cd-text-faint">
              {attachmentTypeLabel(item.name)}
            </span>
            {item.size > 0 && <span className="text-[11px] cd-text-faint">{formatBytes(item.size)}</span>}
            {kind === "convert" && !convertError && (
              <span className="text-[10.5px] cd-text-faint">원본을 PDF 로 변환해 표시합니다 — 서식이 일부 다를 수 있습니다.</span>
            )}
            <a
              href={`${base}&download=1`}
              className="ml-auto cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" /> 원본 내려받기
            </a>
          </div>

          {convertError ? (
            <div
              className="rounded-xl border px-3.5 py-3 flex flex-col gap-1"
              style={{ borderColor: "var(--cd-warning,#FFAE1F)", background: "var(--cd-warning-soft, rgba(255,174,31,0.1))" }}
            >
              <span className="text-[11.5px] font-bold flex items-center gap-1.5" style={{ color: "var(--cd-warning,#FFAE1F)" }}>
                <FileWarning className="w-4 h-4" /> 미리보기를 표시할 수 없습니다
              </span>
              <p className="text-[12px] cd-text">{convertError}</p>
              <span className="text-[10.5px] cd-text-faint">위 [원본 내려받기]로 확인해 주세요.</span>
            </div>
          ) : kind === "image" ? (
            <div
              className="rounded-[14px] p-3 flex justify-center"
              style={{ border: "1px solid var(--cd-active-border)", background: "var(--cd-active-fill)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={item.name} className="max-w-full" style={{ maxHeight: "68vh" }} />
            </div>
          ) : (
            <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--cd-active-border)" }}>
              <iframe title={item.name} src={src} className="w-full" style={{ height: "68vh", background: "#fff" }} />
            </div>
          )}
        </div>
      )}
    </CdModal>
  );
}
