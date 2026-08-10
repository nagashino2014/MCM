"use client";

// 문서 첨부 미리보기 — 결재자가 승인 전에 첨부서류 내용을 앱 안에서 확인한다.
// pdf·이미지는 원본 그대로, hwpx·docx·xlsx·pptx 는 서버 변환 PDF(백엔드 LibreOffice)를 띄운다.
// 변환기가 없거나 실패하면 안내 + 내려받기로 떨어진다(뷰어가 빈 화면으로 남지 않게).

import { useEffect, useState } from "react";
import { Download, FileWarning, Paperclip } from "lucide-react";
import {
  attachmentPreviewKind,
  attachmentTypeLabel,
  formatBytes,
  type DocAttachment,
} from "@/lib/approval/attachments";

export function DocAttachmentViewer({ docId, items }: { docId: string; items: DocAttachment[] }) {
  const [active, setActive] = useState(0);
  const [convertError, setConvertError] = useState<string | null>(null);
  const item = items[active];

  const base = `/api/approval/docs/${encodeURIComponent(docId)}/attachments/${active}`;
  const kind = item ? attachmentPreviewKind(item.name) : "pdf";
  const src = kind === "convert" ? `${base}?mode=pdf` : base;

  // 변환 실패는 iframe 안에 JSON 이 뜨는 형태라 사용자가 이해하기 어렵다.
  // 미리 HEAD 대신 GET 으로 상태만 확인해 배너로 안내한다(본문은 캐시로 재사용됨).
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

  if (!items.length) return null;

  return (
    <div className="flex flex-col gap-3">
      {/* 첨부가 여러 건이면 파일 선택 줄 — 선택된 항목만 아래에 렌더한다. */}
      {items.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {items.map((f, i) => (
            <button
              key={`${f.key}-${i}`}
              type="button"
              className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] flex items-center gap-1.5 ${
                i === active ? "cd-tint-primary font-bold" : "cd-border-c cd-text-muted cd-row-hover"
              }`}
              onClick={() => setActive(i)}
            >
              <Paperclip className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[220px]">{f.name}</span>
              <span className="cd-text-faint">{formatBytes(f.size)}</span>
            </button>
          ))}
        </div>
      )}

      {item && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12.5px] font-bold cd-text truncate">{item.name}</span>
          <span className="text-[10.5px] rounded-full px-2 py-0.5 border cd-border-c cd-text-faint">{attachmentTypeLabel(item.name)}</span>
          <span className="text-[11px] cd-text-faint">{formatBytes(item.size)}</span>
          {kind === "convert" && !convertError && (
            <span className="text-[10.5px] cd-text-faint">원본을 PDF 로 변환해 표시합니다 — 서식이 일부 다를 수 있습니다.</span>
          )}
          <a
            href={`${base}?download=1`}
            className="ml-auto cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] flex items-center gap-1"
          >
            <Download className="w-3.5 h-3.5" /> 원본 내려받기
          </a>
        </div>
      )}

      {convertError ? (
        <div
          className="rounded-xl border px-3.5 py-3 flex flex-col gap-1"
          style={{ borderColor: "var(--cd-warning,#FFAE1F)", background: "var(--cd-warning-soft, rgba(255,174,31,0.1))" }}
        >
          <span className="text-[11.5px] font-bold flex items-center gap-1.5" style={{ color: "var(--cd-warning,#FFAE1F)" }}>
            <FileWarning className="w-4 h-4" /> 미리보기를 표시할 수 없습니다
          </span>
          <p className="text-[12px] cd-text">{convertError}</p>
          <span className="text-[10.5px] cd-text-faint">위 [원본 내려받기]로 파일을 확인한 뒤 결재해 주세요.</span>
        </div>
      ) : kind === "image" ? (
        <div className="rounded-[14px] p-3 flex justify-center" style={{ border: "1px solid var(--cd-active-border)", background: "var(--cd-active-fill)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={item?.name ?? "첨부 이미지"} className="max-w-full" style={{ maxHeight: "80vh" }} />
        </div>
      ) : (
        <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--cd-active-border)" }}>
          <iframe title={item?.name ?? "첨부 미리보기"} src={src} className="w-full" style={{ height: "80vh", background: "#fff" }} />
        </div>
      )}
    </div>
  );
}
