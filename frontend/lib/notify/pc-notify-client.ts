"use client";

/**
 * PC 알림(웹 브라우저) — 새 메일·내 차례 결재·내 문서 결과·메신저 새 메시지를 브라우저 Notification 으로 띄운다.
 * (2026-11-12 1차 메일 → 같은 날 메일·결재·메신저로 확장. 데스크탑 위젯은 public/pc-notify-bridge.html + 셸이 따로 띄운다.)
 *
 * - 켜기·끄기는 **이 브라우저(PC)** 단위로 localStorage 에 둔다. 알림 권한이 브라우저마다 따로라 서버 저장이 의미가 없다.
 *   마스터 스위치 키는 1차와 같은 `mcm:mail-notify:on` 이라 이미 켠 사람은 그대로 켜져 있다.
 * - 감지는 기존 네비 뱃지 폴링(/api/nav/badges, 60초)의 신호(mailArrivedAt·approvalArrivedAt·chatArrivedAt, 서버 시계)를
 *   재사용한다. 어떤 종류든 기준선보다 커졌을 때만 /api/notify/pc-feed 를 한 번 부른다 → 새 일이 없으면 추가 요청 0.
 * - 여러 탭: Web Locks(navigator.locks)로 확인 구간을 직렬화하고 기준선을 localStorage 로 공유한다. tag 로도 한 번 더 막는다.
 * - 위젯과 중복: 뱃지 응답의 pcWidgetActive(이 사용자의 위젯이 90초 안에 피드를 불렀음)가 참이고
 *   "위젯이 켜져 있으면 위젯에만" 설정(기본 켬)이면 브라우저는 띄우지 않고 기준선만 올린다.
 * - 권한 요청은 설정의 켜기 스위치(사용자 클릭)에서만 한다. 페이지 진입 시 요청하지 않는다.
 */

export type PcNotifyKind = "mail" | "approval" | "chat";
export const PC_NOTIFY_KINDS: PcNotifyKind[] = ["mail", "approval", "chat"];

const KEY_ON = "mcm:mail-notify:on";
const KEY_KINDS = "mcm:pc-notify:kinds";
const KEY_YIELD = "mcm:pc-notify:yield-to-widget";
const MARK_KEY: Record<PcNotifyKind, string> = {
  mail: "mcm:mail-notify:mark", // 1차와 같은 키(이미 켠 사람의 기준선 유지)
  approval: "mcm:pc-notify:mark:approval",
  chat: "mcm:pc-notify:mark:chat",
};
const LOCK_NAME = "mcm-pc-notify";
/** 종류별로 한 번에 하나씩 띄울 최대 건수 — 넘으면 "새 메일 N통" 같은 한 장으로 묶는다. */
const MAX_EACH = 3;

export type PcNotifyPermission = "unsupported" | "default" | "granted" | "denied";

type Target = { kind: "mail"; id: string } | { kind: "approval"; id: string } | { kind: "chat"; roomId: number; name: string };
interface FeedItem {
  key: string;
  title: string;
  body: string;
  at: string;
  target: Target;
}
interface FeedSection {
  total: number;
  items: FeedItem[];
}
type FeedResponse = { serverNow: string; pcWidgetActive?: boolean } & Partial<Record<PcNotifyKind, FeedSection>>;

/** 뱃지 응답에서 읽는 신호. */
export interface PcNotifySignals {
  mail: string | null;
  approval: string | null;
  chat: string | null;
  pcWidgetActive: boolean;
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

export function pcNotifyPermission(): PcNotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as PcNotifyPermission;
}

/** 마스터 스위치 값만(권한과 무관) — 설정 화면 표시용. */
export function pcNotifySwitchValue(): boolean {
  return storageGet(KEY_ON) === "1";
}

/** 이 브라우저에서 알림이 켜져 있는가(스위치 + 권한). */
export function isPcNotifyOn(): boolean {
  return pcNotifySwitchValue() && pcNotifyPermission() === "granted";
}

/** 종류별 켜기(기본 전부 켬). */
export function pcNotifyKinds(): Record<PcNotifyKind, boolean> {
  const out: Record<PcNotifyKind, boolean> = { mail: true, approval: true, chat: true };
  try {
    const raw = JSON.parse(storageGet(KEY_KINDS) ?? "{}") as Partial<Record<PcNotifyKind, unknown>>;
    for (const k of PC_NOTIFY_KINDS) if (raw[k] === false) out[k] = false;
  } catch {
    /* 기본값 */
  }
  return out;
}

export function setPcNotifyKind(kind: PcNotifyKind, on: boolean): void {
  const cur = pcNotifyKinds();
  cur[kind] = on;
  storageSet(KEY_KINDS, JSON.stringify(cur));
  // 다시 켤 때 그동안 쌓인 것이 쏟아지지 않게 기준선을 새로 잡게 한다.
  if (on) storageSet(MARK_KEY[kind], null);
}

/** 위젯이 켜져 있으면 브라우저는 띄우지 않는다(기본 켬). */
export function pcNotifyYieldToWidget(): boolean {
  return storageGet(KEY_YIELD) !== "0";
}

export function setPcNotifyYieldToWidget(on: boolean): void {
  storageSet(KEY_YIELD, on ? "1" : "0");
}

async function fetchFeed(since: Partial<Record<PcNotifyKind, string>>): Promise<FeedResponse | null> {
  try {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(since)) if (v) qs.set(k, v);
    const q = qs.toString();
    const r = await fetch(`/api/notify/pc-feed${q ? `?${q}` : ""}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as FeedResponse;
  } catch {
    return null;
  }
}

/**
 * 켜기(스위치 클릭 처리기에서 호출) — 필요하면 권한을 요청하고, 모든 종류의 기준선을 서버 현재 시각으로 잡는다.
 * 켜는 순간 이미 쌓여 있던 안읽은 메일·결재로 알림이 쏟아지지 않게 하기 위함이다.
 */
export async function enablePcNotify(): Promise<PcNotifyPermission> {
  let perm = pcNotifyPermission();
  if (perm === "unsupported") return perm;
  if (perm === "default") {
    try {
      perm = (await Notification.requestPermission()) as PcNotifyPermission;
    } catch {
      perm = pcNotifyPermission();
    }
  }
  if (perm !== "granted") return perm;
  const feed = await fetchFeed({});
  const now = feed?.serverNow ?? new Date().toISOString();
  for (const k of PC_NOTIFY_KINDS) storageSet(MARK_KEY[k], now);
  storageSet(KEY_ON, "1");
  return perm;
}

export function disablePcNotify(): void {
  storageSet(KEY_ON, null);
}

const POPUP_W = 480;
const POPUP_H = 720;

function openTarget(t: Target | null, fallback: PcNotifyKind) {
  try {
    window.focus();
  } catch {
    /* 무시 */
  }
  if (t?.kind === "chat") {
    // 웹 앱에는 메신저 화면이 없어 모바일 앱 웹판(/m-app)의 대화방을 팝업으로 연다(m-app 의 브라우저 팝업과 같은 창 이름·크기).
    const qs = new URLSearchParams({ popup: "1" });
    if (t.name) qs.set("name", t.name);
    const w = window.open(`/m-app/chat/${t.roomId}?${qs.toString()}`, `mcm-chat-popup-${t.roomId}`, `popup=yes,width=${POPUP_W},height=${POPUP_H}`);
    w?.focus();
    return;
  }
  // 메일·결재 화면은 주소 파라미터로 그 건을 연다. 이미 그 화면에 있어도 확실히 열리도록 새로 불러온다.
  if (t?.kind === "mail") window.location.assign(`/mail?id=${encodeURIComponent(t.id)}`);
  else if (t?.kind === "approval") window.location.assign(`/approval?docId=${encodeURIComponent(t.id)}`);
  else if (fallback === "mail") window.location.assign("/mail");
  else if (fallback === "approval") window.location.assign("/approval");
  else window.open("/m-app/chat", "mcm-chat-list");
}

function show(title: string, body: string, tag: string, target: Target | null, kind: PcNotifyKind) {
  try {
    const n = new Notification(title, { body, tag, icon: "/icon.png" });
    n.onclick = () => {
      n.close();
      openTarget(target, kind);
    };
  } catch {
    /* 알림 생성 실패(권한 회수 등) — 뱃지는 그대로 */
  }
}

/** 시험 알림 — 설정 화면의 [[시험 알림]] 버튼. */
export function showTestPcNotify(): boolean {
  if (pcNotifyPermission() !== "granted") return false;
  try {
    new Notification("MCM 알림", { body: "새 메일·결재·메신저가 오면 이렇게 화면 오른쪽 아래에 표시됩니다.", tag: "mcm-pc-test", icon: "/icon.png" });
  } catch {
    return false;
  }
  return true;
}

const BATCH_TITLE: Record<PcNotifyKind, (n: number) => string> = {
  mail: (n) => `새 메일 ${n}통`,
  approval: (n) => `전자결재 알림 ${n}건`,
  chat: (n) => `새 메시지 ${n}건`,
};

function notifySection(kind: PcNotifyKind, sec: FeedSection) {
  if (!sec.items.length) return;
  if (sec.total <= MAX_EACH) {
    // 오래된 것부터 띄워 마지막(가장 최근) 알림이 맨 위에 남게 한다.
    for (const it of [...sec.items].reverse()) show(it.title, it.body, `mcm-${it.key}`, it.target, kind);
    return;
  }
  const top = sec.items[0];
  show(BATCH_TITLE[kind](sec.total), `${top.title}: ${top.body} 외 ${sec.total - 1}건`, `mcm-batch-${top.key}`, null, kind);
}

/** 지금 그 종류의 화면을 보고 있으면(포커스) 알림은 군더더기다. 웹에는 메신저 화면이 없다. */
function lookingAt(kind: PcNotifyKind): boolean {
  if (!document.hasFocus()) return false;
  const p = window.location.pathname;
  if (kind === "mail") return p.startsWith("/mail");
  if (kind === "approval") return p === "/approval";
  return false;
}

async function checkUnlocked(signals: PcNotifySignals) {
  if (!isPcNotifyOn()) return;
  const kinds = pcNotifyKinds();
  const since: Partial<Record<PcNotifyKind, string>> = {};
  for (const k of PC_NOTIFY_KINDS) {
    const sig = signals[k];
    if (!kinds[k] || !sig) continue;
    const mark = storageGet(MARK_KEY[k]);
    if (!mark) {
      // 기준선이 없으면(종류를 다시 켬·저장소 지워짐) 이번 신호를 기준선으로만 쓴다.
      storageSet(MARK_KEY[k], sig);
      continue;
    }
    if (sig > mark) since[k] = mark; // 다른 탭이 이미 처리했으면 여기서 걸러진다
  }
  if (!Object.keys(since).length) return;
  const feed = await fetchFeed(since);
  if (!feed) return;
  const yieldToWidget = (feed.pcWidgetActive ?? signals.pcWidgetActive) && pcNotifyYieldToWidget();
  for (const k of Object.keys(since) as PcNotifyKind[]) {
    const sec = feed[k];
    const sig = signals[k] ?? "";
    // 기준선은 이번에 본 가장 늦은 시각으로 올린다(신호값보다 늦을 수 있어 둘 중 큰 값).
    const newest = (sec?.items ?? []).reduce((m, x) => (x.at > m ? x.at : m), sig);
    if (newest) storageSet(MARK_KEY[k], newest);
    if (!sec || yieldToWidget || lookingAt(k)) continue;
    notifySection(k, sec);
  }
}

/** 뱃지 응답에서 신호를 꺼낸다. */
export function readPcNotifySignals(d: Record<string, unknown>): PcNotifySignals {
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { mail: s(d.mailArrivedAt), approval: s(d.approvalArrivedAt), chat: s(d.chatArrivedAt), pcWidgetActive: d.pcWidgetActive === true };
}

/**
 * 뱃지 폴링 결과를 받아 새 일이면 알림을 띄운다. 꺼져 있거나 바뀐 신호가 없으면 즉시 반환(요청 없음).
 */
export async function handlePcNotifySignals(signals: PcNotifySignals): Promise<void> {
  if (typeof window === "undefined" || !isPcNotifyOn()) return;
  const kinds = pcNotifyKinds();
  const changed = PC_NOTIFY_KINDS.some((k) => {
    const sig = signals[k];
    if (!kinds[k] || !sig) return false;
    const mark = storageGet(MARK_KEY[k]);
    return !mark || sig > mark;
  });
  if (!changed) return;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks?.request) {
    try {
      await locks.request(LOCK_NAME, () => checkUnlocked(signals));
      return;
    } catch {
      /* 잠금 실패 — 아래에서 그냥 처리(tag 가 중복을 막는다) */
    }
  }
  await checkUnlocked(signals);
}
