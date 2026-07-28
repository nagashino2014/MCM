"use client";

// 공지·게시판(G6-B) — 좌측 게시판 선택(전사 공지 / 내 부서 게시판) + 우측 글 목록.
// 글을 클릭하면 별도 상세 화면(/board/[postId])으로 전환된다(모달 아님 — 읽기 편의).
// 상단 고정(기간 내) 글이 목록 맨 위에 오고, 공지 기간이 끝난 글은 '종료'로 표시된다.

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Megaphone, Paperclip, Pin, Plus, Users } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdButton } from "@/components/cdash/CdButton";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import type { BoardPost } from "@/lib/board";
import "@/components/cdash/cdash.css";

const short = (s: string | null) => (s ? s.slice(0, 10) : "-");

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

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Megaphone className="w-5 h-5" />}
        eyebrow="Board"
        title="공지 · 게시판"
        subtitle="전사 공지와 부서 게시판을 한 곳에서 확인합니다."
        actions={
          <CdButton variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => router.push(`/board/write?scope=${scope}`)}>
            글쓰기
          </CdButton>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4">
        {/* 게시판 선택 */}
        <div className="lg:w-56 shrink-0 rounded-2xl border cd-border-c cd-card-bg p-3">
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
                  scope === it.key ? "cd-tint-primary font-semibold" : "cd-text hover:bg-[color:var(--cd-surface)]"
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
            <div className="flex-1 min-h-0 overflow-auto rounded-2xl border cd-border-c cd-card-bg">
              <table className="cd-table text-[12.5px]">
                <thead>
                  <tr>
                    <th className="w-16">구분</th>
                    <th>제목</th>
                    <th className="w-28">작성자</th>
                    <th className="w-32">공지 기간</th>
                    <th className="w-24">작성일</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((p) => (
                    <tr key={p.postId} className="cursor-pointer" onClick={() => router.push(`/board/${p.postId}`)}>
                      <td>
                        {p.pinnedNow ? (
                          <span className="cd-pill cd-pill-info inline-flex items-center gap-1">
                            <Pin className="w-3 h-3" /> 고정
                          </span>
                        ) : p.expired ? (
                          <span className="text-[11px] cd-text-faint">종료</span>
                        ) : (
                          <span className="text-[11px] cd-text-faint">일반</span>
                        )}
                      </td>
                      <td className="cd-text">
                        {p.unread && <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: "var(--cd-primary)" }} />}
                        <span className={p.unread ? "font-bold" : ""}>{p.title}</span>
                        {(p.attachmentCount ?? 0) > 0 && <Paperclip className="w-3 h-3 inline ml-1 cd-text-faint" />}
                      </td>
                      <td className="cd-text-muted whitespace-nowrap">{p.authorName ?? "-"}</td>
                      <td className="cd-text-faint whitespace-nowrap text-[11px]">
                        {p.noticeFrom || p.noticeTo ? `${short(p.noticeFrom)} ~ ${short(p.noticeTo)}` : "제한 없음"}
                      </td>
                      <td className="cd-text-faint whitespace-nowrap text-[11px]">{short(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
