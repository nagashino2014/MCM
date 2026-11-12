"use client";

// 메일 3-pane 우측 — 본문 뷰어(G2-2/4): 헤더·첨부·본문(sandbox iframe)·답장/전달/삭제.
// 외부 발신 HTML 은 XSS 방지를 위해 sandbox iframe(스크립트 차단)으로 렌더한다.

import { useEffect, useRef, useState } from "react";
import { Archive, CornerUpRight, Download, ExternalLink, FileArchive, ListChecks, Loader2, Reply, ReplyAll, RotateCcw, ShieldAlert, Tag, Trash2 } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdDropdown } from "@/components/cdash/CdDropdown";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import { CdAvatar } from "@/components/cdash/CdAvatar";
import type { MailMessageDetail } from "@/lib/mail/messages";
import type { MailCategory } from "@/lib/mail/categories";

function fmtFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtKB(n: number | null): string {
  return n == null ? "" : `${Math.ceil(n / 1024)} KB`;
}

/**
 * HTML 본문 iframe — 내용 높이만큼 늘려 읽기 창 전체(머리·첨부·본문)가 한 번에 스크롤되게 한다(직원 요청 5, 11-12).
 * sandbox="allow-same-origin"(스크립트 차단)은 그대로 두고, 같은 출처라 부모 쪽에서 contentDocument 높이를 잰다.
 * 이미지 로드·창 폭 변화(ResizeObserver)·글꼴 로드 때 다시 잰다. 넓은 표는 iframe 안에서 가로 스크롤된다.
 */
function MailBodyFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(160);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let cleanup: (() => void) | null = null;
    const attach = () => {
      cleanup?.();
      const doc = frame.contentDocument;
      if (!doc?.documentElement) return;
      // 높이를 내용에 맞추는 동안 html·body 의 퍼센트 높이(height:100% 등)는 의미가 없고,
      // 남겨 두면 iframe 을 늘릴 때마다 본문도 같이 늘어 높이가 끝없이 커진다 — auto 로 고정한다.
      if (!doc.getElementById("__mcm_autoheight")) {
        const st = doc.createElement("style");
        st.id = "__mcm_autoheight";
        st.textContent = "html,body{height:auto!important;min-height:0!important}";
        (doc.head ?? doc.documentElement).appendChild(st);
      }
      const measure = () => {
        const root = doc.documentElement;
        const body = doc.body;
        const h = Math.max(root.getBoundingClientRect().height, body ? body.scrollHeight : 0);
        // 가로로 넘치는 본문은 iframe 안 가로 스크롤 막대 높이만큼 여유를 둔다.
        const hScroll = root.scrollWidth > root.clientWidth + 1 ? 18 : 0;
        // 상한 — 100vh 요소처럼 iframe 높이를 따라 커지는 본문이 있어도 무한히 늘지 않게 한다(넘치면 iframe 안에서 스크롤).
        setHeight(Math.min(40000, Math.max(80, Math.ceil(h) + hScroll)));
      };
      measure();
      const onLoadCapture = () => measure();
      doc.addEventListener("load", onLoadCapture, true); // 이미지 load 는 bubble 되지 않아 capture 로 받는다
      doc.fonts?.ready.then(measure).catch(() => {});
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
      ro?.observe(frame); // 폭이 바뀌면 줄바꿈이 달라진다
      if (doc.body) ro?.observe(doc.body);
      cleanup = () => {
        doc.removeEventListener("load", onLoadCapture, true);
        ro?.disconnect();
      };
    };
    frame.addEventListener("load", attach);
    if (frame.contentDocument?.readyState === "complete") attach();
    return () => {
      frame.removeEventListener("load", attach);
      cleanup?.();
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      title="mail-body"
      sandbox="allow-same-origin"
      srcDoc={html}
      style={{ height }}
      className="block w-full border-0"
    />
  );
}

export function MailViewerPane({
  detail,
  loading,
  folder,
  categories,
  onReply,
  onReplyAll,
  onForward,
  onTrash,
  onRestore,
  onDelete,
  onSetCategory,
  onArchive,
  onSpam,
  onUnspam,
  onTodo,
  myAddress,
}: {
  detail: MailMessageDetail | null;
  loading: boolean;
  folder: string;
  categories: MailCategory[];
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onSetCategory: (folderId: string | null) => void;
  onArchive: () => void;
  onSpam: () => void;
  onUnspam: () => void;
  /** §26-1 이 메일을 연결한 할 일 만들기(/todo?new=1&linkKind=mail…) */
  onTodo?: () => void;
  /** 내 메일 주소 — 전체답장 버튼 표시 판단(받는 사람·참조에 나 말고 다른 사람이 있을 때만). */
  myAddress?: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full cd-text-faint">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (!detail) {
    return <CdEmptyState className="h-full justify-center" title="메일을 선택하세요." description="왼쪽 목록에서 메일을 클릭하면 내용이 여기에 표시됩니다." />;
  }

  const inTrash = folder === "trash";
  const fromName = detail.fromAddr?.split("@")[0] ?? "-";
  // 메일 본문에서 주소를 추출하지 않는다. 서버가 공유 원장과 현재 문서 권한으로 확인한 내부 링크만 연다.
  const briefingLink = detail.briefingLink
    && /^[a-zA-Z0-9_-]{1,128}$/.test(detail.briefingLink.briefingId)
    && detail.briefingLink.href === `/sales/rag?briefingId=${encodeURIComponent(detail.briefingLink.briefingId)}`
      ? detail.briefingLink : null;
  // 전체답장은 보낸 사람 말고도 받는 사람·참조에 나 아닌 주소가 있을 때만 답장과 결과가 달라진다.
  const me = (myAddress ?? "").toLowerCase();
  const sender = (detail.fromAddr ?? "").toLowerCase();
  const canReplyAll = [...detail.toAddrs, ...detail.ccAddrs].some((a) => {
    const x = (a.address ?? "").toLowerCase();
    return !!x && x !== me && x !== sender;
  });
  // 전체 저장(ZIP) — 인라인(cid) 이미지는 본문에 이미 그려지므로 뺀다(직원 요청 10, 11-12).
  const files = detail.attachments.filter((a) => !a.contentId);

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* 액션 바 — 주요 버튼(답장·전체답장·전달·삭제)만 노출하고 나머지는 ⋯ 오버플로로.
          버튼 8개 평면 나열은 주요/보조 구분이 없어 전부 등가로 읽혔다(분석 §2 /mail).
          전체답장은 메뉴에 숨어 찾기 어렵다는 요청(직원 요청 6, 11-12)으로 답장 옆에 꺼냈다. */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b cd-hairline-c">
        <CdButton size="sm" variant="soft" icon={<Reply className="w-3.5 h-3.5" />} onClick={onReply}>
          답장
        </CdButton>
        {canReplyAll && (
          <CdButton size="sm" icon={<ReplyAll className="w-3.5 h-3.5" />} onClick={onReplyAll}>
            전체답장
          </CdButton>
        )}
        <CdButton size="sm" icon={<CornerUpRight className="w-3.5 h-3.5" />} onClick={onForward}>
          전달
        </CdButton>
        {inTrash ? (
          <CdButton size="sm" variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={onDelete}>
            영구삭제
          </CdButton>
        ) : (
          <CdButton size="sm" variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={onTrash}>
            삭제
          </CdButton>
        )}
        <div className="flex-1" />
        <CdDropdown
          align="right"
          trigger={() => (
            <span
              className="cd-btn cd-btn-sm cd-btn-ghost inline-flex items-center cursor-pointer tracking-[0.1em] font-extrabold"
              role="button"
              title="더 보기"
            >
              ⋯
            </span>
          )}
          items={[
            ...(onTodo ? [{ key: "todo", label: "할 일로 만들기", icon: <ListChecks className="w-4 h-4" />, onSelect: onTodo }] : []),
            ...(inTrash
              ? [{ key: "restore", label: "복원", icon: <RotateCcw className="w-4 h-4" />, onSelect: onRestore }]
              : [
                  {
                    key: "archive",
                    label: "보관(카테고리 폴더로 이동)",
                    icon: <Archive className="w-4 h-4" />,
                    onSelect: onArchive,
                  },
                  folder !== "spam"
                    ? { key: "spam", label: "스팸 분류", icon: <ShieldAlert className="w-4 h-4" />, onSelect: onSpam }
                    : { key: "unspam", label: "스팸 해제", icon: <RotateCcw className="w-4 h-4" />, onSelect: onUnspam },
                ]),
            // 카테고리(라벨) 지정 — 현재 지정된 항목은 라벨에 · 로 표시한다.
            ...categories.map((c) => ({
              key: c.folderId,
              label: `${detail?.categoryId === c.folderId ? "· " : ""}카테고리: ${c.name}`,
              icon: <Tag className="w-4 h-4" />,
              onSelect: () => onSetCategory(c.folderId),
            })),
            ...(detail?.categoryId
              ? [{ key: "__none", label: "분류 해제", icon: <Tag className="w-4 h-4" />, onSelect: () => onSetCategory(null) }]
              : []),
          ]}
        />
      </div>

      {/* 머리·첨부·본문을 한 스크롤로 묶는다 — 액션 바만 위에 남는다(직원 요청 5, 11-12). */}
      <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="min-h-full flex flex-col">
      {/* 헤더 */}
      <div className="px-4 py-3 border-b cd-hairline-c flex flex-col gap-2">
        <h2 className="text-base font-bold cd-text break-words">{detail.subject || "(제목 없음)"}</h2>
        <div className="flex items-center gap-2.5">
          <CdAvatar name={fromName} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold cd-text truncate">{detail.fromAddr ?? "-"}</p>
            <p className="text-xs cd-text-faint truncate">
              받는 사람: {detail.toAddrs.map((a) => a.address).join(", ") || "-"}
              {detail.ccAddrs.length > 0 && ` · 참조: ${detail.ccAddrs.map((a) => a.address).join(", ")}`}
            </p>
          </div>
          <span className="text-xs cd-text-faint shrink-0">{fmtFull(detail.receivedAt ?? detail.sentAt ?? detail.createdAt)}</span>
        </div>
        {briefingLink && (
          <a href={briefingLink.href} target="_blank" rel="noopener noreferrer" className="cd-btn cd-btn-soft cd-btn-sm inline-flex items-center justify-center gap-1.5 self-start">
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            브리핑 보고서 열기
          </a>
        )}
        {/* 첨부 칩 — 인라인 이미지(cid, 서명 명함 등)는 본문에 이미 그려지므로 목록에서 뺀다 */}
        {files.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {files.map((a) => (
              <a
                key={a.attachmentId}
                href={`/api/mail/attachments?id=${encodeURIComponent(a.attachmentId)}`}
                className="cd-chip cd-chip-sm inline-flex items-center gap-1.5"
              >
                <Download className="w-3 h-3" />
                {a.filename}
                <span className="cd-text-faint">{fmtKB(a.sizeBytes)}</span>
              </a>
            ))}
            {files.length > 1 && (
              <a
                href={`/api/mail/attachments/zip?messageId=${encodeURIComponent(detail.messageId)}`}
                className="cd-btn cd-btn-ghost cd-btn-sm inline-flex items-center gap-1.5"
                title={`첨부 ${files.length}개를 ZIP 파일 하나로 내려받습니다.`}
              >
                <FileArchive className="w-3.5 h-3.5" aria-hidden="true" />
                전체 저장(ZIP)
              </a>
            )}
          </div>
        )}
      </div>

      {/* 본문 — 흰 배경 고정(메일 본문은 발신자 서식 기준).
          인라인 이미지: cid: 참조를 첨부 다운로드 URL 로 치환.
          sandbox 는 allow-same-origin 만 부여(스크립트는 여전히 차단 → XSS 안전) — 이미지 요청에 세션 쿠키가 필요해서다. */}
      <div className="flex-1 bg-white">
        {detail.bodyHtml ? (
          <MailBodyFrame
            key={detail.messageId}
            html={detail.attachments.reduce(
              (html, a) =>
                a.contentId ? html.split(`cid:${a.contentId}`).join(`/api/mail/attachments?id=${encodeURIComponent(a.attachmentId)}`) : html,
              detail.bodyHtml
            )}
          />
        ) : (
          // 평문 본문: 읽기 여백 확대 — 최대폭 70ch, 행간 1.8(분석 §2 /mail 처방). 바깥 스크롤을 함께 쓴다.
          <pre className="px-6 py-5 text-[13.5px] leading-[1.8] whitespace-pre-wrap break-words font-sans text-black max-w-[70ch]">
            {detail.bodyText || "(내용 없음)"}
          </pre>
        )}
      </div>
      </div>
      </div>
    </div>
  );
}
