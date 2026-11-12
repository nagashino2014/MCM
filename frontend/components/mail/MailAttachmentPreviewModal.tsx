"use client";

// 메일 첨부 미리보기(직원 요청 23, 2026-11-12) — 받은/보낸 메일 첨부 목록의 눈 아이콘으로 열어 내려받지 않고 본다.
// 규약은 결재 첨부 미리보기(components/approval/AttachmentPreviewModal.tsx)를 따른다:
//   이미지·PDF 는 원본 그대로, 한글·오피스는 문서 변환 서비스가 만든 PDF(서버 S3 캐시).
// 여기에 메일에만 있는 글자(txt·csv)·html 을 더했다 — html 은 스크립트·외부 요청을 막은 sandbox iframe 에 그린다.
// 모든 요청은 다운로드 API(/api/mail/attachments?id=…&preview=…)라 같은 소유권 검증을 거친다.
// 모달은 CdModal(포털 토큰·Esc 닫기·포커스 가두기)을 쓴다.

import { useEffect, useState, type ReactNode } from "react";
import { Download, FileWarning, Loader2 } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { FileTypeIcon } from "@/components/mail/FileTypeIcon";
import { mailAttachmentPreviewKind } from "@/lib/mail/attachment-preview-kind";

export interface MailAttachmentPreviewTarget {
  attachmentId: string;
  filename: string;
  sizeBytes: number | null;
}

/** html 미리보기 머리 — 외부 이미지·글꼴·스크립트 요청을 모두 막는다(sandbox 와 이중 차단, 수신 확인 픽셀도 안 불린다). */
const HTML_PREVIEW_HEAD =
  `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">` +
  `<style>body{font-family:'Pretendard Variable',Pretendard,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;background:#fff;margin:16px;word-break:break-word}</style>`;

type Loaded =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "blob"; url: string }
  | { state: "text"; text: string; truncated: boolean };

function fmtSize(n: number | null): string {
  if (n == null) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.ceil(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function MailAttachmentPreviewModal({
  file,
  onClose,
}: {
  file: MailAttachmentPreviewTarget | null;
  onClose: () => void;
}) {
  const kind = file ? mailAttachmentPreviewKind(file.filename) : "none";
  const base = file ? `/api/mail/attachments?id=${encodeURIComponent(file.attachmentId)}` : "";
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  // 변환 PDF·글자는 미리 받아 둔다 — 실패하면 iframe 안에 JSON 이 뜨는 대신 안내 문구를 보여 줄 수 있다.
  // 이미지·PDF 원본은 브라우저가 주소로 바로 그린다(PDF 뷰어의 점진 표시를 살린다).
  useEffect(() => {
    if (!file) return;
    setLoaded({ state: "loading" });
    if (kind !== "convert" && kind !== "text" && kind !== "html") return;
    let alive = true;
    let objectUrl: string | null = null;
    const url = `${base}&preview=${kind === "convert" ? "pdf" : "text"}`;
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const data = (await r.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? `미리보기를 만들지 못했습니다(HTTP ${r.status}).`);
        }
        if (kind === "convert") {
          const blob = await r.blob();
          if (!alive) return;
          objectUrl = URL.createObjectURL(blob);
          setLoaded({ state: "blob", url: objectUrl });
        } else {
          const text = await r.text();
          if (alive) setLoaded({ state: "text", text, truncated: r.headers.get("X-Preview-Truncated") === "1" });
        }
      })
      .catch((err: Error) => {
        if (alive) setLoaded({ state: "error", message: err.message || "미리보기를 만들지 못했습니다." });
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, kind, base]);

  if (!file) return null;

  const errorBox = (message: string) => (
    <div className="rounded-[10px] border cd-warn-border cd-warn-bg px-3.5 py-3 flex flex-col gap-1" role="alert">
      <span className="text-sm font-semibold flex items-center gap-1.5 cd-warn-text">
        <FileWarning className="w-4 h-4" aria-hidden="true" /> 미리보기를 표시할 수 없습니다
      </span>
      <p className="text-sm cd-text">{message}</p>
      <span className="text-xs cd-text-faint">아래 [내 PC에 저장]으로 내려받아 확인해 주세요.</span>
    </div>
  );
  const loadingBox = (label: string) => (
    <div className="h-[60vh] flex flex-col items-center justify-center gap-2 cd-text-muted text-sm" role="status">
      <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
  // 문서 미리보기 면은 본문처럼 흰 바탕(PDF 뷰어·html 원본 색을 다크에서도 그대로 보이게).
  const frameCls = "w-full h-[70vh] rounded-[10px] border cd-border-c bg-white";

  let body: ReactNode;
  if (kind === "none") {
    body = errorBox("미리보기를 지원하지 않는 형식입니다.");
  } else if (kind === "image") {
    body =
      loaded.state === "error" ? (
        errorBox(loaded.message)
      ) : (
        <div className="rounded-[10px] border cd-border-c cd-surface-bg p-3 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${base}&preview=raw`}
            alt={file.filename}
            className="max-w-full h-auto object-contain"
            style={{ maxHeight: "70vh" }}
            onError={() => setLoaded({ state: "error", message: "이미지를 불러오지 못했습니다." })}
          />
        </div>
      );
  } else if (kind === "pdf") {
    body = <iframe title={file.filename} src={`${base}&preview=raw`} className={frameCls} />;
  } else if (loaded.state === "loading") {
    body = loadingBox(kind === "convert" ? "PDF로 바꾸는 중입니다… 큰 문서는 30초 넘게 걸릴 수 있습니다." : "불러오는 중…");
  } else if (loaded.state === "error") {
    body = errorBox(loaded.message);
  } else if (loaded.state === "blob") {
    body = <iframe title={file.filename} src={loaded.url} className={frameCls} />;
  } else if (kind === "html") {
    // sandbox 에 아무 권한도 주지 않는다 — 스크립트·폼·팝업·같은 출처 접근 모두 차단.
    body = <iframe title={file.filename} sandbox="" srcDoc={HTML_PREVIEW_HEAD + loaded.text} className={frameCls} />;
  } else {
    body = (
      <pre className="h-[70vh] overflow-auto rounded-[10px] border cd-border-c cd-surface-bg p-3 text-[13px] leading-relaxed cd-text whitespace-pre-wrap break-words font-mono">
        {loaded.text}
      </pre>
    );
  }

  const truncated = loaded.state === "text" && loaded.truncated;
  return (
    <CdModal
      open
      onClose={onClose}
      widthClass="max-w-5xl"
      maxHeightClass="max-h-[94vh]"
      title={
        <span className="flex items-center gap-2 min-w-0">
          <FileTypeIcon filename={file.filename} size={22} className="shrink-0" />
          <span className="truncate" title={file.filename}>{file.filename}</span>
          <span className="shrink-0 text-xs font-normal cd-text-faint tabular-nums">{fmtSize(file.sizeBytes)}</span>
        </span>
      }
      footer={
        <>
          {kind === "convert" && loaded.state === "blob" && (
            <span className="mr-auto text-xs cd-text-faint">원본을 PDF로 바꿔 보여 줍니다 — 서식이 일부 다를 수 있습니다.</span>
          )}
          {truncated && <span className="mr-auto text-xs cd-text-faint">파일이 커서 앞부분(1MB)만 보여 줍니다.</span>}
          <a href={base} className="cd-btn cd-btn-ghost cd-btn-sm inline-flex items-center gap-1.5">
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            내 PC에 저장
          </a>
        </>
      }
    >
      {body}
    </CdModal>
  );
}
