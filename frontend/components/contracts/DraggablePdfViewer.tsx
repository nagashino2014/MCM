"use client";

import { useRef, useState } from "react";
import { Download, FileText, X } from "lucide-react";
import { CdTabs } from "@/components/cdash/CdTabs";

/**
 * 계약서 PDF 뷰어(끌어서 옮기는 창) — 매출 계약 관리 page.tsx 의 로컬 컴포넌트를 매입 계약(331)과 공유하려고
 * 그대로 옮겼다. 문서가 여럿이면 상단 탭으로 전환한다(2026-10-14).
 */
export interface PdfViewerDoc {
  label: string;
  url: string;
  fileName: string;
  documentId?: string;
  /** 다운로드 버튼이 쓸 주소 — 보기와 내려받기를 접속기록에서 나눌 때만 지정한다. */
  downloadUrl?: string;
}

export function withPdfViewerDefaults(url: string): string {
  const [base] = url.split("#", 1);
  return `${base}#toolbar=1&navpanes=0&view=FitH`;
}

export function DraggablePdfViewer({
  title,
  url: singleUrl,
  docs,
  initialIndex = 0,
  onClose,
}: {
  title: string;
  url: string;
  docs?: PdfViewerDoc[];
  initialIndex?: number;
  onClose: () => void;
}) {
  const [docIndex, setDocIndex] = useState(() => Math.min(Math.max(0, initialIndex), Math.max(0, (docs?.length ?? 1) - 1)));
  const activeDoc = docs?.[docIndex];
  const url = activeDoc?.url ?? singleUrl;
  const [position, setPosition] = useState(() => ({
    x: typeof window === "undefined"
      ? 96
      : Math.max(16, Math.round((window.innerWidth - Math.min(1280, window.innerWidth - 32)) / 2)),
    y: 24,
  }));
  const dragOffset = useRef<{ x: number; y: number } | null>(null);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = {
      x: event.clientX - position.x,
      y: event.clientY - position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOffset.current) return;
    const width = Math.min(1280, window.innerWidth - 32);
    const height = Math.min(1100, window.innerHeight - 32);
    setPosition({
      x: Math.min(Math.max(8, event.clientX - dragOffset.current.x), Math.max(8, window.innerWidth - width - 8)),
      y: Math.min(Math.max(8, event.clientY - dragOffset.current.y), Math.max(8, window.innerHeight - height - 8)),
    });
  };

  const stopDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      className="fixed z-[60] rounded-lg border cd-border-c cd-card-bg shadow-[var(--cd-shadow-dialog)] overflow-hidden flex flex-col"
      style={{
        left: position.x,
        top: position.y,
        width: "min(1280px, calc(100vw - 32px))",
        height: "min(1100px, calc(100vh - 32px))",
      }}
    >
      <div
        className="h-12 shrink-0 px-4 border-b cd-border-c cd-surface-bg flex items-center justify-between gap-3 cursor-move select-none"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <div className="min-w-0 flex items-center gap-2">
          <FileText className="w-4 h-4 cd-text-primary shrink-0" />
          <span className="text-sm cd-text truncate">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* 지금 보고 있는 문서 내려받기 — 같은 출처 프록시라 download 속성으로 저장된다 */}
          <a
            href={activeDoc?.downloadUrl ?? url}
            download={activeDoc?.fileName ?? true}
            onPointerDown={(event) => event.stopPropagation()}
            className="cd-action cd-btn cd-btn-ghost px-2 py-1 text-xs cd-text-muted flex items-center gap-1 whitespace-nowrap"
            title="현재 문서 다운로드"
          >
            <Download className="w-3.5 h-3.5" />
            다운로드
          </a>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="rounded-lg p-1 cd-text-faint hover:bg-[color:var(--cd-surface)] hover:text-[color:var(--cd-text)]"
            title="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {docs && docs.length > 1 && (
        <div className="shrink-0 px-4 pt-1 border-b cd-border-c cd-card-bg">
          <CdTabs
            items={docs.map((d, i) => ({ key: String(i), label: d.label }))}
            active={String(docIndex)}
            onChange={(key) => setDocIndex(Number(key))}
          />
        </div>
      )}
      <iframe
        key={url}
        title={activeDoc?.label ?? title}
        src={withPdfViewerDefaults(url)}
        className="w-full flex-1 min-h-0 cd-surface-bg"
      />
    </div>
  );
}
