"use client";

// 메일 3-pane 우측 — 본문 뷰어(G2-2/4): 헤더·첨부·본문(sandbox iframe)·답장/전달/삭제.
// 외부 발신 HTML 은 XSS 방지를 위해 sandbox iframe(스크립트 차단)으로 렌더한다.

import { Archive, ChevronDown, CornerUpRight, Download, Loader2, Reply, ReplyAll, RotateCcw, ShieldAlert, Tag, Trash2 } from "lucide-react";
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

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* 액션 바 */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b cd-border-c flex-wrap">
        <CdButton size="sm" variant="soft" icon={<Reply className="w-3.5 h-3.5" />} onClick={onReply}>
          답장
        </CdButton>
        <CdButton size="sm" icon={<ReplyAll className="w-3.5 h-3.5" />} onClick={onReplyAll}>
          전체답장
        </CdButton>
        <CdButton size="sm" icon={<CornerUpRight className="w-3.5 h-3.5" />} onClick={onForward}>
          전달
        </CdButton>
        <span className="w-px h-4 mx-0.5" style={{ background: "var(--cd-border)" }} />

        {/* 카테고리 설정(G2-12) — 등록된 카테고리 선택으로 분류(라벨) */}
        <CdDropdown
          align="left"
          trigger={() => {
            const current = categories.find((c) => c.folderId === detail?.categoryId);
            return (
              <span className="cd-btn cd-btn-sm cd-btn-ghost inline-flex items-center gap-1 cursor-pointer" role="button">
                <Tag className="w-3.5 h-3.5" />
                {current ? current.name : "카테고리"}
                <ChevronDown className="w-3 h-3 opacity-50" />
              </span>
            );
          }}
          items={[
            ...categories.map((c) => ({
              key: c.folderId,
              label: c.name,
              onSelect: () => onSetCategory(c.folderId),
            })),
            { key: "__none", label: "분류 해제", onSelect: () => onSetCategory(null) },
          ]}
        />
        <CdButton size="sm" icon={<Archive className="w-3.5 h-3.5" />} onClick={onArchive} title="카테고리 폴더(미지정 시 보관함)로 이동">
          보관
        </CdButton>
        {folder !== "spam" && (
          <CdButton size="sm" icon={<ShieldAlert className="w-3.5 h-3.5" />} onClick={onSpam}>
            스팸 분류
          </CdButton>
        )}
        <div className="flex-1" />
        {inTrash ? (
          <>
            <CdButton size="sm" icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={onRestore}>
              복원
            </CdButton>
            <CdButton size="sm" variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={onDelete}>
              영구삭제
            </CdButton>
          </>
        ) : (
          <CdButton size="sm" variant="danger" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={onTrash}>
            삭제
          </CdButton>
        )}
      </div>

      {/* 헤더 */}
      <div className="px-4 py-3 border-b cd-border-c flex flex-col gap-2">
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
        {detail.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {detail.attachments.map((a) => (
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
          </div>
        )}
      </div>

      {/* 본문 — 흰 배경 고정(메일 본문은 발신자 서식 기준).
          인라인 이미지: cid: 참조를 첨부 다운로드 URL 로 치환.
          sandbox 는 allow-same-origin 만 부여(스크립트는 여전히 차단 → XSS 안전) — 이미지 요청에 세션 쿠키가 필요해서다. */}
      <div className="flex-1 min-h-0 overflow-hidden bg-white">
        {detail.bodyHtml ? (
          <iframe
            title="mail-body"
            sandbox="allow-same-origin"
            srcDoc={detail.attachments.reduce(
              (html, a) =>
                a.contentId ? html.split(`cid:${a.contentId}`).join(`/api/mail/attachments?id=${encodeURIComponent(a.attachmentId)}`) : html,
              detail.bodyHtml
            )}
            className="w-full h-full border-0"
          />
        ) : (
          <pre className="p-4 text-sm whitespace-pre-wrap font-sans text-black overflow-y-auto h-full">{detail.bodyText || "(내용 없음)"}</pre>
        )}
      </div>
    </div>
  );
}
