"use client";

// 공지·게시판(G6-B) — 좌측 게시판 선택(전사 공지 / 내 부서 게시판) + 우측 글 목록.
// 글을 클릭하면 별도 상세 화면(/board/[postId])으로 전환된다(모달 아님 — 읽기 편의).
// 상단 고정(기간 내) 글이 목록 맨 위에 오고, 공지 기간이 끝난 글은 '종료'로 표시된다.

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Megaphone, Paperclip, Pin, Plus, Users } from "lucide-react";
import { CdAvatar } from "@/components/cdash/CdAvatar";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import type { BoardPost } from "@/lib/board";
import "@/components/cdash/cdash.css";

const short = (s: string | null) => (s ? s.slice(0, 10) : "-");

/** 게시 종료까지 남은 일수 — "D-3" / 당일 "D-DAY". 기간 미설정이거나 지났으면 null. */
function dday(noticeTo: string | null): string | null {
  if (!noticeTo) return null;
  const end = new Date(`${noticeTo.slice(0, 10)}T23:59:59+09:00`);
  if (Number.isNaN(end.getTime())) return null;
  const diff = Math.ceil((end.getTime() - Date.now()) / 86_400_000);
  if (diff < 0) return null;
  return diff === 0 ? "D-DAY" : `D-${diff}`;
}

export function BoardListBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const sp = useSearchParams();
  const [scope, setScope] = useState<"company" | "dept">(sp.get("scope") === "dept" ? "dept" : "company");
  const [posts, setPosts] = useState<BoardPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/board?scope=${scope}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      setPosts(Array.isArray(d.posts) ? d.posts : []);
      setNotice(d.message ?? null);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  const pinned = posts.filter((p) => p.pinnedNow);
  const normal = posts.filter((p) => !p.pinnedNow);
  const unreadCount = posts.filter((p) => p.unread).length;

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="공지 · 게시판"
        meta={`${scope === "company" ? "전사 공지" : "부서 게시판"}${unreadCount > 0 ? ` · 안읽음 ${unreadCount}건` : ""}`}
        actions={
          <CdButton variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => router.push(`/board/write?scope=${scope}`)}>
            글쓰기
          </CdButton>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
        {/* 게시판 선택 */}
        <div className="lg:w-56 shrink-0 cd-card p-3">
          <div className="flex lg:flex-col gap-1">
            {(
              [
                { key: "company", label: "전사 공지", icon: <Building2 className="w-4 h-4 shrink-0" /> },
                { key: "dept", label: "부서 게시판", icon: <Users className="w-4 h-4 shrink-0" /> },
              ] as const
            ).map((it) => (
              <button
                key={it.key}
                type="button"
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-left transition-colors ${
                  scope === it.key ? "cd-glass-active font-bold" : "cd-text-muted cd-row-hover"
                }`}
                onClick={() => setScope(it.key)}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>
        </div>

        {/* 목록 */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {notice && <p className="text-[12px] cd-text-faint">{notice}</p>}
          {loading ? (
            <p className="text-sm cd-text-faint p-4">불러오는 중입니다.</p>
          ) : posts.length === 0 ? (
            <CdEmptyState
              icon={<Megaphone className="w-7 h-7" />}
              title="등록된 공지가 없습니다"
              description={scope === "company" ? "전사 공지가 아직 없습니다." : "부서 게시판에 첫 글을 남겨보세요."}
            />
          ) : (
            // 고정 공지는 상단 카드 스트립으로 분리하고, 일반 글은 제목 위주 리스트로.
            // 5열 균등 테이블에서는 제목이 주인공이 아니었다(분석 §2 /board).
            <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-3">
              {pinned.length > 0 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 shrink-0">
                  {pinned.map((p) => (
                    <button
                      key={p.postId}
                      type="button"
                      onClick={() => router.push(`/board/${p.postId}`)}
                      className="text-left rounded-2xl p-4 px-[18px] flex flex-col gap-2.5 transition-colors"
                      style={{
                        background: "linear-gradient(135deg, rgba(106,131,239,0.12), rgba(142,134,238,0.08))",
                        border: "1px solid rgba(106,131,239,0.22)",
                        backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                      }}
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[10px] font-extrabold cd-text-primary"
                          style={{ background: "rgba(255,255,255,0.75)" }}
                        >
                          <Pin className="w-2.5 h-2.5" /> 고정 공지
                        </span>
                        {dday(p.noticeTo) && (
                          <span className="ml-auto text-[10.5px] font-extrabold cd-warn-bg cd-warn-text rounded-full px-2.5 py-[3px] tabular-nums">
                            게시 종료 {dday(p.noticeTo)}
                          </span>
                        )}
                      </span>
                      <span className="text-[15px] font-extrabold tracking-[-0.015em] leading-[1.45] cd-text truncate">
                        {p.unread && (
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                            style={{ background: "var(--cd-primary)" }}
                          />
                        )}
                        {p.title}
                      </span>
                      <span className="flex items-center gap-[7px]">
                        <CdAvatar name={p.authorName ?? "-"} size="xs" className="w-[22px] h-[22px] text-[9.5px]" />
                        <span className="text-[11.5px] font-bold cd-text-muted">{p.authorName ?? "-"}</span>
                        <span className="text-[11px] cd-text-faint">{short(p.createdAt)}</span>
                        {(p.attachmentCount ?? 0) > 0 && <Paperclip className="w-3 h-3 cd-text-faint" />}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="cd-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b cd-hairline-c">
                  <span className="text-[13px] font-extrabold cd-text">일반 글</span>
                  <span className="text-[11.5px] cd-text-faint">{normal.length}건</span>
                </div>
                {normal.length === 0 ? (
                  <p className="text-[13px] cd-text-faint py-6 text-center">일반 글이 없습니다.</p>
                ) : (
                  normal.map((p) => (
                    <button
                      key={p.postId}
                      type="button"
                      onClick={() => router.push(`/board/${p.postId}`)}
                      className="w-full text-left flex items-center gap-3 px-[18px] py-[13px] border-b cd-hairline-row-c last:border-b-0 cd-row-hover"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: "var(--cd-primary)", opacity: p.unread ? 1 : 0 }}
                        aria-hidden
                      />
                      <CdAvatar name={p.authorName ?? "-"} size="sm" className="w-[30px] h-[30px] text-[11px]" />
                      <span className="flex-1 min-w-0">
                        <span
                          className={`block text-sm tracking-[-0.01em] cd-text truncate ${p.unread ? "font-bold" : "font-medium"}`}
                        >
                          {p.title}
                        </span>
                        <span className="block mt-0.5 text-[11.5px] cd-text-faint truncate">
                          {p.authorName ?? "-"} · {short(p.createdAt)}
                          {p.noticeFrom || p.noticeTo ? ` · 공지 ${short(p.noticeFrom)}~${short(p.noticeTo)}` : ""}
                        </span>
                      </span>
                      {(p.attachmentCount ?? 0) > 0 && <Paperclip className="w-3.5 h-3.5 cd-text-faint shrink-0" />}
                      {p.expired && (
                        <span className="cd-pill cd-pill-idle shrink-0 text-[10.5px]">종료</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
