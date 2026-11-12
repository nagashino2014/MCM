/**
 * PC 알림 피드(2026-11-12, 메일·전자결재·메신저) — 웹 브라우저 알림(lib/notify/pc-notify-client.ts)과
 * 데스크탑 위젯 브리지(public/pc-notify-bridge.html)가 같이 쓴다.
 *
 * 모든 기준 시각은 **서버 시계**로 기록된 열이다(클라이언트 시계 차이 무관):
 *   메일   = mail_message_state.created_at(받은편지함에 들어온 시각)
 *   결재   = approval_steps.activated_at(내 차례가 된 시각) · approval_docs.completed_at(내 문서 완료·반려)
 *   메신저 = chat_messages.created_at
 * since 이후 것만 최대 5건 + 총 건수를 돌려준다. 클라이언트는 받은 것 중 가장 늦은 시각으로 기준선을 올린다.
 */
import { getDb, rowsToObjects } from "@/lib/db";

/** ISO 시각 문자열(toISOString 형식)만 받는다 — 문자열 비교로 쓰므로 형식이 다르면 무시. */
export const PC_FEED_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export type PcNotifyKind = "mail" | "approval" | "chat";

export type PcNotifyTarget =
  | { kind: "mail"; id: string }
  | { kind: "approval"; id: string }
  | { kind: "chat"; roomId: number; name: string };

export interface PcNotifyItem {
  /** 알림 tag — 같은 건은 같은 키(중복 표시 방지). */
  key: string;
  title: string;
  body: string;
  /** 기준 시각(서버 시계, ISO). */
  at: string;
  target: PcNotifyTarget;
}

export interface PcFeedSection {
  total: number;
  items: PcNotifyItem[];
}

const LIMIT = 5;
const clip = (s: string, n = 120) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * 메일 — since 이후 받은편지함에 들어온 안읽은 메일.
 * 메일 가져오기(281)·보관함→받은편지함 이동은 들어온 시각이 새로워도 메일 자체 날짜가 오래됐으므로
 * 메일 날짜(m.created_at)가 기준선 하루 전보다 이른 것은 뺀다(옛 메일 수천 통 알림 방지).
 */
export async function mailFeed(userId: string, since: string): Promise<PcFeedSection> {
  const floor = new Date(Date.parse(since) - 24 * 60 * 60 * 1000).toISOString();
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.message_id, m.subject, m.from_addr, s.created_at AS arrived_at,
              sb.display_name AS from_name, COUNT(*) OVER ()::int AS total
         FROM mail_message_state s
         JOIN mail_folders f ON f.folder_id = s.folder_id
         JOIN mailboxes mb ON mb.mailbox_id = s.mailbox_id
         JOIN mail_messages m ON m.message_id = s.message_id
         LEFT JOIN mailboxes sb ON lower(sb.address) = lower(m.from_addr)
        WHERE mb.user_id = $1 AND f.system_kind = 'inbox' AND s.is_read = 0 AND s.is_deleted = 0
          AND s.created_at > $2 AND m.created_at >= $3
        ORDER BY s.created_at DESC
        LIMIT ${LIMIT}`,
      [userId, since, floor]
    )
  );
  const items = rows.map((r): PcNotifyItem => {
    const addr = r.from_addr != null ? String(r.from_addr) : "";
    const name = r.from_name != null ? String(r.from_name).trim() : "";
    const id = String(r.message_id);
    return {
      key: `mail-${id}`,
      title: name || addr || "새 메일",
      body: clip(r.subject != null && String(r.subject) ? String(r.subject) : "(제목 없음)"),
      at: String(r.arrived_at),
      target: { kind: "mail", id },
    };
  });
  return { total: rows.length ? Number(rows[0].total) : 0, items };
}

/**
 * 전자결재 — ① 내 차례가 된 결재·합의(기안자 본인 단계 제외) ② 내가 올린 문서의 완료·반려.
 * 관리자 취소(346)는 열이 없는 환경이 있어 넣지 않는다.
 */
export async function approvalFeed(userId: string, since: string): Promise<PcFeedSection> {
  const db = await getDb();
  const turn = rowsToObjects(
    await db.exec(
      `SELECT s.step_id, s.doc_id, s.step_type, s.activated_at AS at, d.title, d.drafter_name,
              COUNT(*) OVER ()::int AS total
         FROM approval_steps s JOIN approval_docs d ON d.doc_id = s.doc_id
        WHERE s.assignee_user_id = $1 AND s.status = 'pending' AND d.status = 'in_progress'
          AND COALESCE(d.drafter_user_id, '') <> $1
          AND s.activated_at IS NOT NULL AND s.activated_at > $2
        ORDER BY s.activated_at DESC
        LIMIT ${LIMIT}`,
      [userId, since]
    )
  );
  const done = rowsToObjects(
    await db.exec(
      `SELECT doc_id, status, title, completed_at AS at, COUNT(*) OVER ()::int AS total
         FROM approval_docs
        WHERE drafter_user_id = $1 AND status IN ('approved', 'rejected')
          AND completed_at IS NOT NULL AND completed_at > $2
        ORDER BY completed_at DESC
        LIMIT ${LIMIT}`,
      [userId, since]
    )
  );
  const items: PcNotifyItem[] = [
    ...turn.map((r): PcNotifyItem => {
      const id = String(r.doc_id);
      const who = r.drafter_name != null ? String(r.drafter_name).trim() : "";
      return {
        key: `appr-step-${String(r.step_id)}`,
        title: String(r.step_type) === "agree" ? "합의 요청" : "결재 요청",
        body: clip(`${who ? who + " · " : ""}${String(r.title ?? "")}`),
        at: String(r.at),
        target: { kind: "approval", id },
      };
    }),
    ...done.map((r): PcNotifyItem => {
      const id = String(r.doc_id);
      const rejected = String(r.status) === "rejected";
      return {
        key: `appr-done-${id}-${String(r.status)}`,
        title: rejected ? "내 문서 반려" : "내 문서 결재 완료",
        body: clip(String(r.title ?? "")),
        at: String(r.at),
        target: { kind: "approval", id },
      };
    }),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, LIMIT);
  const total = (turn.length ? Number(turn[0].total) : 0) + (done.length ? Number(done[0].total) : 0);
  return { total, items };
}

/** 메신저 — 내가 아직 안 읽은, 남이 보낸 메시지(알림 끈 방·나간 방·시스템 메시지 제외). */
export async function chatFeed(userId: string, since: string): Promise<PcFeedSection> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT cm.message_id, cm.room_id, cm.kind, cm.body, cm.created_at, r.room_type, r.name AS room_name,
              COALESCE(e.name, u.name) AS sender_name, COUNT(*) OVER ()::int AS total
         FROM chat_messages cm
         JOIN chat_room_members m ON m.room_id = cm.room_id AND m.user_id = $1
         JOIN chat_rooms r ON r.room_id = cm.room_id
         JOIN users u ON u.user_id = cm.sender_id
         LEFT JOIN employee_profiles e ON e.user_id = cm.sender_id
        WHERE m.left_at IS NULL AND m.notify_muted = false
          AND cm.message_id > m.last_read_message_id AND cm.sender_id <> $1
          AND cm.deleted_at IS NULL AND cm.kind <> 'system' AND cm.created_at > $2
        ORDER BY cm.created_at DESC
        LIMIT ${LIMIT}`,
      [userId, since]
    )
  );
  const items = rows.map((r): PcNotifyItem => {
    const sender = r.sender_name != null ? String(r.sender_name) : "알 수 없음";
    const kind = String(r.kind);
    const text = String(r.body ?? "").trim() || (kind === "image" ? "(사진)" : kind === "file" ? "(파일)" : "");
    const dm = String(r.room_type) === "dm";
    const roomName = dm ? sender : (r.room_name != null && String(r.room_name).trim()) || "그룹 대화";
    return {
      key: `chat-${String(r.message_id)}`,
      title: dm ? sender : roomName,
      body: clip(dm ? text : `${sender}: ${text}`),
      at: String(r.created_at),
      target: { kind: "chat", roomId: Number(r.room_id), name: roomName },
    };
  });
  return { total: rows.length ? Number(rows[0].total) : 0, items };
}

const FEEDS: Record<PcNotifyKind, (userId: string, since: string) => Promise<PcFeedSection>> = {
  mail: mailFeed,
  approval: approvalFeed,
  chat: chatFeed,
};

/** 종류별 since(유효한 ISO 만) → 피드. 한 종류가 실패해도(표 미생성 등) 나머지는 돌려준다. */
export async function pcFeed(userId: string, since: Partial<Record<PcNotifyKind, string>>) {
  const out: Partial<Record<PcNotifyKind, PcFeedSection>> = {};
  await Promise.all(
    (Object.keys(FEEDS) as PcNotifyKind[]).map(async (k) => {
      const s = since[k];
      if (!s || !PC_FEED_ISO_RE.test(s)) return;
      try {
        out[k] = await FEEDS[k](userId, s);
      } catch {
        out[k] = { total: 0, items: [] };
      }
    })
  );
  return out;
}

// ── 데스크탑 위젯 접속 표시(브라우저·위젯 중복 알림 방지) ─────────────────────────
// 위젯 브리지가 피드를 부를 때마다 사용자별 마지막 시각을 프로세스 메모리에 남긴다(DB 쓰기 없음).
// next 태스크가 1개라는 전제 — 재시작 직후 한 번은 비어 있을 수 있다(그때는 양쪽에 한 번 뜰 수 있음).
const WIDGET_ACTIVE_MS = 90_000;
const g = globalThis as unknown as { __pcWidgetSeen?: Map<string, number> };
const seen = (g.__pcWidgetSeen ??= new Map<string, number>());

export function markPcWidgetSeen(userId: string): void {
  if (userId) seen.set(userId, Date.now());
}

export function isPcWidgetActive(userId: string): boolean {
  const t = seen.get(userId);
  return t != null && Date.now() - t < WIDGET_ACTIVE_MS;
}
