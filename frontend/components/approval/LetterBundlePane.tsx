"use client";

// 공문 + 첨부서류 이어 보기(2026-11-03 사용자 요청) — 공문 뷰어의 미리보기 칸.
// 왼쪽 칸: 위쪽에 '공문 + 첨부서류' 목록(누르면 그 문서 첫 쪽으로 이동·첨부 하나씩 내려받기),
// 아래쪽에 결합 PDF 의 쪽 미리보기(pdf.js)를 공문 → 첨부 순서로 모두 보여 준다.
// 오른쪽: 결합 PDF 를 브라우저 PDF 뷰어로 연다(자체 썸네일 칸은 navpanes=0 으로 접는다).
// 결합 PDF 를 만들지 못하면 종전처럼 공문 PDF 만 보여 주고 목록은 그대로 둔다.

import { useEffect, useRef, useState } from "react";
import { Download, FileText, Paperclip } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { formatBytes } from "@/lib/approval/attachments";
import type { LetterBundlePart } from "@/lib/letter/bundle";

export interface LetterAttachmentMeta {
  index: number;
  name: string;
  size: number;
}

function PageThumb({ doc, pageNo, active, scrollRoot, onClick }: { doc: PDFDocumentProxy; pageNo: number; active: boolean; scrollRoot: HTMLElement | null; onClick: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.414);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || drawn) return;
    let cancelled = false;
    // 보이는 쪽만 그린다 — 첨부가 수십 쪽이어도 처음 열 때 몇 장만 렌더한다
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void (async () => {
          const page = await doc.getPage(pageNo);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          setRatio(base.height / base.width);
          const cssWidth = el.parentElement?.clientWidth || 168;
          const viewport = page.getViewport({ scale: (cssWidth / base.width) * (window.devicePixelRatio || 1) });
          el.width = Math.floor(viewport.width);
          el.height = Math.floor(viewport.height);
          await page.render({ canvas: el, viewport }).promise;
          if (!cancelled) setDrawn(true);
        })().catch(() => {});
      },
      { root: scrollRoot, rootMargin: "200px 0px" }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [doc, pageNo, drawn, scrollRoot]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col items-center gap-1 p-1.5 border${active ? "border-[color:var(--cd-primary)] bg-[color:var(--cd-primary-soft)]" : "border-transparent hover:bg-[color:var(--cd-hover)]"}`}
      title={`${pageNo}쪽으로 이동`}
    >
      <span className="block w-full bg-white shadow-[var(--cd-shadow)]" style={{ aspectRatio: `1 / ${ratio}` }}>
        <canvas ref={canvasRef} className="block w-full h-full" />
      </span>
      <span className={`text-[10px] ${active ? "text-[color:var(--cd-primary)] font-semibold" : "cd-text-faint"}`}>{pageNo}</span>
    </button>
  );
}

export function LetterBundlePane({ letterId, attachments, letterTitle }: { letterId: string; attachments: LetterAttachmentMeta[]; letterTitle: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [parts, setParts] = useState<LetterBundlePart[]>([]);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // iframe 를 다시 열어야 #page 이동이 확실하다(PDF 뷰어가 해시 변경을 무시하는 경우가 있다)
  const [navKey, setNavKey] = useState(0);
  const [thumbRoot, setThumbRoot] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    let loaded: PDFDocumentProxy | null = null;
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/letters/${encodeURIComponent(letterId)}/bundle?disposition=inline`, { cache: "no-store" });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "공문과 첨부서류를 합치지 못했습니다.");
        }
        const meta = JSON.parse(decodeURIComponent(res.headers.get("X-Letter-Parts") ?? "%5B%5D")) as LetterBundlePart[];
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
        setParts(meta);
        setBlobUrl(url);
        // pdfjs-dist 는 serverExternalPackages 라 new URL(worker) 를 쓸 수 없다 — 워커 모듈을 불러와
        // globalThis.pdfjsWorker 로 메인 스레드에서 돌린다(썸네일 축소 렌더라 부담이 작다).
        // 본체는 pdf.min.mjs — pdf.mjs 는 최상위 `var __webpack_exports__` 가 webpack 래퍼 인자를 가려
        // "Object.defineProperty called on non-object" 로 실패한다(2026-11-03 실측).
        try {
          await import("pdfjs-dist/build/pdf.worker.min.mjs");
          const pdfjs = await import("pdfjs-dist/build/pdf.min.mjs");
          loaded = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
        } catch {
          throw new Error("쪽 미리보기를 만들지 못했습니다. 오른쪽 화면에서 쪽을 넘겨 보세요.");
        }
        if (cancelled) {
          void loaded.destroy();
          return;
        }
        setDoc(loaded);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      if (loaded) void loaded.destroy();
    };
  }, [letterId]);

  const goto = (p: number) => {
    setPage(p);
    setNavKey((k) => k + 1);
    thumbRoot?.querySelector(`[data-page="${p}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const partOf = (kind: "letter" | "attachment", index: number) => parts.find((p) => p.kind === kind && (kind === "letter" || p.index === index));
  const activePart = parts.find((p) => p.pageCount > 0 && page >= p.startPage && page < p.startPage + p.pageCount);
  const rangeText = (p: LetterBundlePart | undefined) =>
    !p ? "" : p.pageCount === 0 ? "미리보기 불가" : p.pageCount === 1 ? `${p.startPage}쪽` : `${p.startPage}–${p.startPage + p.pageCount - 1}쪽`;

  const rows = [
    { kind: "letter" as const, index: -1, label: "공문", name: letterTitle, size: 0 },
    ...attachments.map((a) => ({ kind: "attachment" as const, index: a.index, label: `첨부 ${a.index + 1}`, name: a.name, size: a.size })),
  ];
  const totalPages = doc?.numPages ?? 0;

  return (
    <div className="absolute inset-0 flex">
      <aside className="w-[212px] shrink-0 border-r cd-border-c flex flex-col min-h-0 bg-[color:var(--cd-card)]">
        <div className="px-2 py-2 border-b cd-border-c max-h-[42%] overflow-auto flex flex-col gap-0.5">
          <span className="px-1 pb-1 text-[11px] font-semibold cd-text">공문 + 첨부서류 {attachments.length}건</span>
          {rows.map((r) => {
            const part = partOf(r.kind, r.index);
            const active = activePart != null && part === activePart;
            const canGo = part != null && part.pageCount > 0;
            return (
              <div
                key={`${r.kind}-${r.index}`}
                className={`flex items-start gap-1 rounded-[var(--cd-radius-control)] px-1 py-1 ${active ? "bg-[color:var(--cd-primary-soft)]" : "hover:bg-[color:var(--cd-hover)]"}`}
              >
                <button
                  type="button"
                  className="flex-1 min-w-0 flex items-start gap-1.5 text-left disabled:cursor-default"
                  disabled={!canGo}
                  onClick={() => part && goto(part.startPage)}
                  title={part?.error ? `${r.name} — ${part.error}` : `${r.name}${canGo ? " — 이 문서로 이동" : ""}`}
                >
                  {r.kind === "letter" ? <FileText className="w-3.5 h-3.5 mt-px shrink-0 cd-text-faint" /> : <Paperclip className="w-3.5 h-3.5 mt-px shrink-0 cd-text-faint" />}
                  <span className="min-w-0 flex flex-col">
                    <span className={`text-[11px] truncate ${active ? "text-[color:var(--cd-primary)] font-semibold" : "cd-text"}`}>
                      {r.label} · {r.name}
                    </span>
                    <span className={`text-[10px] ${part?.error ? "text-[color:var(--cd-warning)]" : "cd-text-faint"}`}>
                      {rangeText(part)}
                      {r.size > 0 ? `${part ? " · " : ""}${formatBytes(r.size)}` : ""}
                    </span>
                  </span>
                </button>
                {r.kind === "letter" && (
                  <span className="shrink-0 flex items-center gap-0.5">
                    {/* 공문만 따로 — 상단 아이콘은 첨부까지 합친 파일을 받는다 */}
                    <button
                      type="button"
                      className="px-1 py-0.5 text-[10px] cd-text-faint hover:cd-text"
                      title="공문만 PDF로 내려받기"
                      onClick={() => window.open(`/api/letters/${encodeURIComponent(letterId)}/pdf`, "_blank")}
                    >
                      PDF
                    </button>
                    <button
                      type="button"
                      className="px-1 py-0.5 text-[10px] cd-text-faint hover:cd-text"
                      title="공문만 한글 파일(HWPX/HWP)로 내려받기"
                      onClick={() => window.open(`/api/letters/${encodeURIComponent(letterId)}/hwpx`, "_blank")}
                    >
                      한글
                    </button>
                  </span>
                )}
                {r.kind === "attachment" && (
                  <button
                    type="button"
                    className="shrink-0 p-1 cd-text-faint hover:cd-text"
                    title={`${r.name} 내려받기`}
                    aria-label={`${r.name} 내려받기`}
                    onClick={() => window.open(`/api/letters/${encodeURIComponent(letterId)}/attachments/${r.index}`, "_blank")}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div ref={setThumbRoot} className="flex-1 min-h-0 overflow-auto px-3 py-2.5 flex flex-col gap-1">
          {error && <p className="text-[11px] text-[color:var(--cd-error)]">{error}</p>}
          {!error && !doc && <p className="text-[11px] cd-text-faint">쪽 미리보기를 만드는 중...</p>}
          {doc &&
            Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
              const head = parts.find((x) => x.pageCount > 0 && x.startPage === p);
              return (
                <div key={p} data-page={p} className="flex flex-col">
                  {head && (
                    <span className="text-[10px] font-semibold cd-text-faint truncate pt-1.5 pb-0.5" title={head.name}>
                      {head.kind === "letter" ? "공문" : `첨부 ${head.index + 1} · ${head.name}`}
                    </span>
                  )}
                  <PageThumb doc={doc} pageNo={p} active={p === page} scrollRoot={thumbRoot} onClick={() => goto(p)} />
                </div>
              );
            })}
        </div>
      </aside>
      <div className="relative flex-1 min-w-0">
        {blobUrl ? (
          <iframe key={navKey} title="공문·첨부서류 미리보기" src={`${blobUrl}#page=${page}&navpanes=0`} className="absolute inset-0 w-full h-full" />
        ) : error ? (
          <iframe title="공문 미리보기" src={`/api/letters/${encodeURIComponent(letterId)}/pdf?disposition=inline`} className="absolute inset-0 w-full h-full" />
        ) : (
          <div className="flex items-center justify-center h-full cd-text-faint text-sm">공문과 첨부서류를 불러오는 중...</div>
        )}
      </div>
    </div>
  );
}
