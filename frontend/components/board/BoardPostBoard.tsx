"use client";

// 공지 상세(G6-B) — 목록에서 클릭하면 별도 화면으로 전환된다(모달이 아니라 읽기에 편하도록).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Megaphone, Paperclip, Pencil, Pin, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdModal } from "@/components/cdash/CdModal";
import { useCdToast } from "@/components/cdash/CdToast";
import type { BoardPost } from "@/lib/board";
import "@/components/cdash/cdash.css";

interface PostDetail extends BoardPost {
  attachments: { attachmentId: string; fileName: string; byteSize: number | null; storageKey: string }[];
}

const short = (s: string | null) => (s ? s.slice(0, 10) : "-");

export function BoardPostBoard({ postId }: { postId: string }) {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const router = useRouter();
  const [post, setPost] = useState<PostDetail | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch(`/api/board/${encodeURIComponent(postId)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error ?? "공지를 불러오지 못했습니다.");
        setPost(d.post);
        setCanEdit(d.canEdit === true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "오류가 발생했습니다."));
  }, [postId]);

  const listHref = post ? `/board?scope=${post.scope}` : "/board";

  const remove = async () => {
    const r = await fetch(`/api/board/${encodeURIComponent(postId)}`, { method: "DELETE" });
    if (r.ok) {
      toast("공지를 삭제했습니다.", "success");
      router.push(listHref);
    } else {
      const d = await r.json().catch(() => ({}));
      toast(String(d.error ?? "삭제에 실패했습니다."), "error");
      setDeleting(false);
    }
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-4 p-4 md:p-5 rounded-3xl overflow-y-auto" data-theme={theme}>
      <CdPageHeader
        icon={<Megaphone className="w-5 h-5" />}
        breadcrumbs={[{ label: "공지·게시판", href: listHref }, { label: post?.scope === "company" ? "전사 공지" : "부서 게시판" }]}
        title={post?.title ?? "공지"}
        actions={
          <div className="flex items-center gap-2">
            <CdButton icon={<ArrowLeft className="w-4 h-4" />} onClick={() => router.push(listHref)}>
              목록
            </CdButton>
            {canEdit && (
              <>
                <CdButton icon={<Pencil className="w-4 h-4" />} onClick={() => router.push(`/board/write?edit=${postId}`)}>
                  수정
                </CdButton>
                <CdButton variant="danger" icon={<Trash2 className="w-4 h-4" />} onClick={() => setDeleting(true)}>
                  삭제
                </CdButton>
              </>
            )}
          </div>
        }
      />

      {error ? (
        <p className="text-sm text-[color:var(--cd-danger,#FA896B)] p-4">{error}</p>
      ) : !post ? (
        <p className="text-sm cd-text-faint p-4">불러오는 중입니다.</p>
      ) : (
        <div className="flex flex-col gap-3 w-full">
          {/* 메타 정보 */}
          <div className="flex items-center gap-2 flex-wrap text-[12px] cd-text-faint">
            <span className="cd-pill cd-pill-idle">{post.scope === "company" ? "전사 공지" : `${post.deptName ?? "부서"} 게시판`}</span>
            {post.pinnedNow && (
              <span className="cd-pill cd-pill-info inline-flex items-center gap-1">
                <Pin className="w-3 h-3" /> 상단 고정
                {(post.pinFrom || post.pinTo) && ` ${short(post.pinFrom)} ~ ${short(post.pinTo)}`}
              </span>
            )}
            {post.expired && <span className="cd-pill cd-pill-idle">게시 종료</span>}
            <span>{post.authorName ?? "-"}</span>
            <span>· {short(post.createdAt)}</span>
            {(post.noticeFrom || post.noticeTo) && (
              <span>
                · 공지 기간 {short(post.noticeFrom)} ~ {short(post.noticeTo)}
              </span>
            )}
          </div>

          {/* 본문 — 메일 본문과 동일하게 흰 배경 고정 */}
          <div
            className="cd-mail-editor rounded-2xl border cd-border-c bg-white text-black px-5 py-4 text-sm min-h-[420px]"
            style={{ lineHeight: 1.7 }}
            dangerouslySetInnerHTML={{ __html: post.bodyHtml }}
          />

          {post.attachments.length > 0 && (
            <div className="rounded-2xl border cd-border-c cd-card-bg p-4 flex flex-col gap-1.5">
              <span className="text-[11px] font-bold cd-text-faint">첨부 {post.attachments.length}건</span>
              {post.attachments.map((a) => (
                <a
                  key={a.attachmentId}
                  href={`/api/board/attachments?key=${encodeURIComponent(a.storageKey)}`}
                  className="flex items-center gap-2 text-[12.5px] cd-text-primary hover:underline"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  {a.fileName}
                  {a.byteSize != null && <span className="cd-text-faint">({Math.ceil(a.byteSize / 1024)} KB)</span>}
                </a>
              ))}
            </div>
          )}

          <div className="pb-6">
            <CdButton icon={<ArrowLeft className="w-4 h-4" />} onClick={() => router.push(listHref)}>
              목록으로
            </CdButton>
          </div>
        </div>
      )}

      <CdModal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="공지 삭제"
        size="sm"
        footer={
          <>
            <CdButton onClick={() => setDeleting(false)}>취소</CdButton>
            <CdButton variant="danger" icon={<Trash2 className="w-4 h-4" />} onClick={remove}>
              삭제
            </CdButton>
          </>
        }
      >
        <p className="text-sm cd-text">{post ? `'${post.title}' 공지를 삭제할까요?` : ""}</p>
      </CdModal>
    </div>
  );
}
