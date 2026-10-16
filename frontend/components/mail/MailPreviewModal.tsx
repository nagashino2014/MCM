"use client";

// 메일 미리보기 팝업(10-16) — 목록형 행의 돋보기로 연다. 읽음 상태는 바꾸지 않는다(?peek=1).
// 본문은 뷰어와 같은 방식(sandbox iframe, 스크립트 차단)으로 렌더한다. [열기]로 본문 보기로 넘어간다.

import { useEffect, useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdModal } from "@/components/cdash/CdModal";
import { fmtListDate } from "@/components/mail/mail-date";
import type { MailMessageDetail } from "@/lib/mail/messages";

export function MailPreviewModal({
  messageId,
  onClose,
  onOpen,
}: {
  messageId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const [detail, setDetail] = useState<MailMessageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!messageId) return;
    let alive = true;
    setDetail(null);
    setError(null);
    setLoading(true);
    fetch(`/api/mail/messages/${encodeURIComponent(messageId)}?peek=1`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (r.ok) setDetail(d as MailMessageDetail);
        else setError(String(d.error ?? "메일을 불러오지 못했습니다."));
      })
      .catch(() => alive && setError("메일을 불러오지 못했습니다."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [messageId]);

  const html =
    detail?.bodyHtml &&
    detail.attachments.reduce(
      (h, a) => (a.contentId ? h.split(`cid:${a.contentId}`).join(`/api/mail/attachments?id=${encodeURIComponent(a.attachmentId)}`) : h),
      detail.bodyHtml
    );
  const files = detail?.attachments.filter((a) => !a.contentId) ?? [];

  return (
    <CdModal
      open={!!messageId}
      onClose={onClose}
      size="xl"
      title={detail?.subject || (loading ? "불러오는 중…" : "(제목 없음)")}
      footer={
        <div className="flex justify-end gap-2">
          <CdButton onClick={onClose}>닫기</CdButton>
          {messageId && (
            <CdButton variant="primary" onClick={() => onOpen(messageId)}>
              메일 열기
            </CdButton>
          )}
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-10 cd-text-faint">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : error ? (
        <p className="text-sm cd-error-text">{error}</p>
      ) : detail ? (
        <div className="flex flex-col gap-2">
          <div className="text-xs cd-text-muted flex flex-col gap-0.5">
            <span>보낸 사람: {detail.fromAddr ?? "-"}</span>
            <span className="truncate">받는 사람: {detail.toAddrs.map((a) => a.address).join(", ") || "-"}</span>
            <span>{fmtListDate(detail.sentAt ?? detail.receivedAt ?? detail.createdAt)}</span>
          </div>
          {files.length > 0 && (
            <p className="text-xs cd-text-muted flex items-center gap-1 truncate">
              <Paperclip className="w-3.5 h-3.5 shrink-0" /> 첨부 {files.length}개 — {files.map((a) => a.filename).join(", ")}
            </p>
          )}
          {/* 본문 — 흰 배경 고정(발신자 서식 기준), 높이는 화면의 60% */}
          <div className="rounded-lg border cd-border-c overflow-hidden bg-white h-[60vh]">
            {html ? (
              <iframe title="mail-preview" sandbox="allow-same-origin" srcDoc={html} className="w-full h-full border-0" />
            ) : (
              <pre className="px-5 py-4 text-[13.5px] leading-[1.8] whitespace-pre-wrap font-sans text-black overflow-y-auto h-full">
                {detail.bodyText || "(내용 없음)"}
              </pre>
            )}
          </div>
        </div>
      ) : null}
    </CdModal>
  );
}
