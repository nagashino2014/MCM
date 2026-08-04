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

/** from_addr 원문에서 표시 이름을 파싱한다 — `"홍길동" <a@b>` / `홍길동 <a@b>` / `a@b`. */
function parseFrom(addr: string | null): { name: string | null; email: string } {
  if (!addr) return { name: null, email: "-" };
  const m = addr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim() };
  return { name: null, email: addr.trim() };
}

/** 발신자별 안정적 아바타 색 — 전용 팔레트(cd-av 6종) 순환. */
function avatarIndex(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (h % 6) + 1;
}

/**
 * 안읽은 메일(홈, G3) — 받은편지함 안읽음 카운트(폴더 API) + 최근 안읽은 메일 미리보기.
 * 행에 발신자 이니셜 아바타(28px, 파스텔)를 붙인다(핸드오프 2a).
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
      accent="var(--cd-secondary)"
      href="/mail"
      loading={loading}
      error={error}
      empty={unreadItems.length === 0}
      emptyText="안읽은 메일이 없습니다."
    >
      <ul className="flex flex-col gap-1.5">
        {unreadItems.map((m) => {
          const from = parseFrom(m.fromAddr);
          const initial = (from.name?.trim()?.[0] ?? from.email[0] ?? "?").toUpperCase();
          const av = avatarIndex(from.email);
          return (
            <li key={m.messageId}>
              <HomeRow href="/mail">
                <span
                  className="w-7 h-7 rounded-full inline-flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{
                    background: `color-mix(in srgb, var(--cd-av-${av}) 18%, transparent)`,
                    color: `var(--cd-av-${av})`,
                  }}
                >
                  {initial}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold cd-text truncate">{m.subject || "(제목 없음)"}</span>
                  <span className="block text-[11px] cd-text-faint truncate">
                    {from.name ?? from.email} · {short(m.createdAt)}
                  </span>
                </span>
              </HomeRow>
            </li>
          );
        })}
        {unreadCount > unreadItems.length && unreadItems.length > 0 && (
          <li className="text-[11px] cd-text-faint text-center pt-0.5">외 {unreadCount - unreadItems.length}건 — 메일에서 확인</li>
        )}
      </ul>
    </HomeCard>
  );
}
