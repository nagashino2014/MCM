"use client";

// 메일 3-pane 우측 — 본문 뷰어(G2-2/4): 헤더·첨부·본문(sandbox iframe)·답장/전달/삭제.
// 외부 발신 HTML 은 XSS 방지를 위해 sandbox iframe(스크립트 차단)으로 렌더한다.

import { Archive, CornerUpRight, Download, Loader2, Reply, ReplyAll, RotateCcw, ShieldAlert, Tag, Trash2 } from "lucide-react";
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
  onUnspam,
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
      {/* 액션 바 — 주요 3개(답장·전달·삭제)만 노출하고 나머지는 ⋯ 오버플로로.
          버튼 8개 평면 나열은 주요/보조 구분이 없어 전부 등가로 읽혔다(분석 §2 /mail). */}
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b cd-hairline-c">
        <CdButton size="sm" variant="soft" icon={<Reply className="w-3.5 h-3.5" />} onClick={onReply}>
          답장
        </CdButton>
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
            { key: "replyAll", label: "전체답장", icon: <ReplyAll className="w-4 h-4" />, onSelect: onReplyAll },
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
        {/* 첨부 칩 — 인라인 이미지(cid, 서명 명함 등)는 본문에 이미 그려지므로 목록에서 뺀다 */}
        {detail.attachments.some((a) => !a.contentId) && (
          <div className="flex flex-wrap gap-1.5">
            {detail.attachments.filter((a) => !a.contentId).map((a) => (
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
          // 평문 본문: 읽기 여백 확대 — 최대폭 70ch, 행간 1.8(분석 §2 /mail 처방).
          <pre className="px-6 py-5 text-[13.5px] leading-[1.8] whitespace-pre-wrap font-sans text-black overflow-y-auto h-full max-w-[70ch]">
            {detail.bodyText || "(내용 없음)"}
          </pre>
        )}
      </div>
    </div>
  );
}
