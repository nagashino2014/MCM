"use client";

/**
 * 새 메일 PC 알림(직원 개선 요청 11, 2026-11-12) — 브라우저 Notification.
 *
 * - 켜기·끄기는 **이 브라우저(PC)** 단위로 localStorage 에 둔다. 알림 권한 자체가 브라우저마다 따로라
 *   서버에 저장해도 다른 PC 에서는 권한을 다시 받아야 한다 → 마이그레이션 없이 브라우저에 둔다.
 * - 새 메일 감지는 기존 네비 뱃지 폴링(/api/nav/badges, 60초)을 재사용한다. 뱃지 응답의 mailArrivedAt
 *   (받은편지함 안읽음 중 가장 늦게 들어온 시각, 서버 시계)이 기준선(mark)보다 커졌을 때만
 *   /api/mail/notify-feed 를 한 번 더 부른다 → 새 메일이 없으면 추가 요청 0.
 * - 여러 탭: Web Locks(navigator.locks)로 확인 구간을 직렬화하고 기준선을 localStorage 로 공유한다.
 *   먼저 잡은 탭이 알림을 띄우고 기준선을 올리면 뒤 탭은 할 일이 없다. 같은 메일은 tag 로도 한 번 더 막는다.
 * - 권한 요청은 메일 설정의 켜기 스위치(사용자 클릭)에서만 한다. 페이지 진입 시 요청하지 않는다.
 */

const KEY_ON = "mcm:mail-notify:on";
const KEY_MARK = "mcm:mail-notify:mark";
const LOCK_NAME = "mcm-mail-notify";
/** 한 번에 하나씩 띄울 최대 통수 — 넘으면 "새 메일 N통" 한 장으로 묶는다. */
const MAX_EACH = 3;

export type MailNotifyPermission = "unsupported" | "default" | "granted" | "denied";

interface FeedItem {
  messageId: string;
  subject: string;
  from: string;
  arrivedAt: string;
}

interface FeedResponse {
  serverNow: string;
  total: number;
  items: FeedItem[];
}

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* 저장소 차단(사생활 보호 모드 등) — 이번 탭에서만 동작 */
  }
}

export function mailNotifyPermission(): MailNotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as MailNotifyPermission;
}

/** 이 브라우저에서 알림이 켜져 있는가(스위치 + 권한 둘 다). */
export function isMailNotifyOn(): boolean {
  return storageGet(KEY_ON) === "1" && mailNotifyPermission() === "granted";
}

/** 스위치 값만(권한과 무관) — 설정 화면 표시용. */
export function mailNotifySwitchValue(): boolean {
  return storageGet(KEY_ON) === "1";
}

async function fetchFeed(since: string | null): Promise<FeedResponse | null> {
  try {
    const qs = since ? `?since=${encodeURIComponent(since)}` : "";
    const r = await fetch(`/api/mail/notify-feed${qs}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as FeedResponse;
  } catch {
    return null;
  }
}

/**
 * 켜기(스위치 클릭 처리기에서 호출) — 필요하면 권한을 요청하고, 기준선을 서버 현재 시각으로 잡는다.
 * 켜는 순간 이미 쌓여 있던 안읽은 메일로 알림이 쏟아지지 않게 하기 위함이다.
 */
export async function enableMailNotify(): Promise<MailNotifyPermission> {
  let perm = mailNotifyPermission();
  if (perm === "unsupported") return perm;
  if (perm === "default") {
    try {
      perm = (await Notification.requestPermission()) as MailNotifyPermission;
    } catch {
      perm = mailNotifyPermission();
    }
  }
  if (perm !== "granted") return perm;
  const feed = await fetchFeed(null);
  storageSet(KEY_MARK, feed?.serverNow ?? new Date().toISOString());
  storageSet(KEY_ON, "1");
  return perm;
}

export function disableMailNotify(): void {
  storageSet(KEY_ON, null);
}

function openMessage(messageId: string | null) {
  try {
    window.focus();
  } catch {
    /* 무시 */
  }
  // 메일 화면은 /mail?id=<id> 진입 시 그 메일을 연다. 이미 /mail 에 있어도 확실히 열리도록 새로 불러온다.
  window.location.assign(messageId ? `/mail?id=${encodeURIComponent(messageId)}` : "/mail");
}

function show(title: string, body: string, tag: string, messageId: string | null) {
  try {
    const n = new Notification(title, { body, tag, icon: "/icons/mcm-192.png" });
    n.onclick = () => {
      n.close();
      openMessage(messageId);
    };
  } catch {
    /* 알림 생성 실패(권한 회수 등) — 뱃지는 그대로 */
  }
}

/** 시험 알림 — 설정 화면의 [[시험 알림]] 버튼. */
export function showTestMailNotify(): boolean {
  if (mailNotifyPermission() !== "granted") return false;
  show("MCM 메일 알림", "새 메일이 오면 이렇게 보낸 사람과 제목이 표시됩니다.", "mcm-mail-test", null);
  return true;
}

function notifyFeed(feed: FeedResponse) {
  const items = feed.items;
  if (!items.length) return;
  if (feed.total <= MAX_EACH) {
    // 오래된 것부터 띄워 마지막(가장 최근) 알림이 맨 위에 남게 한다.
    for (const it of [...items].reverse()) {
      show(it.from || "새 메일", it.subject || "(제목 없음)", `mcm-mail-${it.messageId}`, it.messageId);
    }
    return;
  }
  const top = items[0];
  show(
    `새 메일 ${feed.total}통`,
    `${top.from || "새 메일"}: ${top.subject || "(제목 없음)"} 외 ${feed.total - 1}통`,
    `mcm-mail-batch-${top.messageId}`,
    null
  );
}

async function checkUnlocked(signal: string) {
  if (!isMailNotifyOn()) return;
  const mark = storageGet(KEY_MARK);
  if (mark && signal <= mark) return; // 다른 탭이 이미 처리했거나 새 메일 없음
  if (!mark) {
    // 기준선이 없으면(저장소가 지워짐 등) 이번 값을 기준선으로만 쓴다.
    storageSet(KEY_MARK, signal);
    return;
  }
  const feed = await fetchFeed(mark);
  if (!feed) return;
  // 기준선은 이번에 본 가장 늦은 도착 시각으로 올린다(신호값보다 늦을 수 있어 둘 중 큰 값).
  const newest = feed.items.reduce((m, x) => (x.arrivedAt > m ? x.arrivedAt : m), signal);
  storageSet(KEY_MARK, newest);
  // 지금 메일 화면을 보고 있으면(포커스) 알림은 군더더기다 — 기준선만 올린다.
  if (document.hasFocus() && window.location.pathname.startsWith("/mail")) return;
  notifyFeed(feed);
}

/**
 * 뱃지 폴링 결과(mailArrivedAt)를 받아 새 메일이면 알림을 띄운다. 꺼져 있으면 즉시 반환(요청 없음).
 */
export async function handleMailArrivedSignal(signal: string | null | undefined): Promise<void> {
  if (!signal || typeof window === "undefined") return;
  if (!isMailNotifyOn()) return;
  const mark = storageGet(KEY_MARK);
  if (mark && signal <= mark) return;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks?.request) {
    try {
      await locks.request(LOCK_NAME, () => checkUnlocked(signal));
      return;
    } catch {
      /* 잠금 실패 — 아래에서 그냥 처리(tag 가 중복을 막는다) */
    }
  }
  await checkUnlocked(signal);
}
