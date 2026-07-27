"use client";

import { Mail } from "lucide-react";
import { HomeCard, HomeRow } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";

interface FolderInfo {
  folderId: string;
  name: string;
  systemKind: string | null;
  unread: number;
}

interface ListItem {
  messageId: string;
  subject: string;
  snippet: string;
  fromAddr: string | null;
  createdAt: string;
  isRead: boolean;
}

const short = (s: string) => s.slice(5, 16).replace("T", " ");

/**
 * 안읽은 메일(홈, G3) — 받은편지함 안읽음 카운트(폴더 API) + 최근 안읽은 메일 미리보기.
 * 협업 3종 요약(미결재·안읽은 메일·오늘 일정)의 하나로 홈 상단에 노출한다.
 */
export function MailUnreadCard() {
  const wf = useHomeWidget<{ folders: FolderInfo[] }>("/api/mail/folders");
  const wm = useHomeWidget<{ items: ListItem[] }>("/api/mail/messages?folder=inbox&limit=20");
  if (wf.status === "forbidden" || wm.status === "forbidden") return null;

  const unreadCount = wf.status === "ok" ? (wf.data.folders.find((f) => f.systemKind === "inbox")?.unread ?? 0) : 0;
  const unreadItems = wm.status === "ok" ? wm.data.items.filter((m) => !m.isRead).slice(0, 5) : [];
  const loading = wf.status === "loading" || wm.status === "loading";
  const error = wm.status === "error" ? wm.message : wf.status === "error" ? wf.message : undefined;

  return (
    <HomeCard
      icon={<Mail className="w-4 h-4" />}
      title="안읽은 메일"
      count={unreadCount}
      accent="#49BEFF"
      href="/mail"
      loading={loading}
      error={error}
      empty={unreadItems.length === 0}
      emptyText="안읽은 메일이 없습니다."
    >
      <ul className="flex flex-col gap-1.5">
        {unreadItems.map((m) => (
          <li key={m.messageId}>
            <HomeRow href="/mail">
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold cd-text truncate">{m.subject || "(제목 없음)"}</span>
                <span className="block text-[11px] cd-text-faint truncate">
                  {m.fromAddr ?? "-"} · {short(m.createdAt)}
                </span>
              </span>
            </HomeRow>
          </li>
        ))}
        {unreadCount > unreadItems.length && unreadItems.length > 0 && (
          <li className="text-[11px] cd-text-faint text-center pt-0.5">외 {unreadCount - unreadItems.length}건 — 메일에서 확인</li>
        )}
      </ul>
    </HomeCard>
  );
}
