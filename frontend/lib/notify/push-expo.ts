/**
 * 모바일 푸시 발송 어댑터 — Expo Push Service(M1).
 *
 * 설계(docs/mobile-app-integration-blueprint.md §4):
 * - 호출은 항상 **커밋 이후 fire-and-forget**. 발송 실패가 본 업무(글 등록·결재 진행)를 막지 않는다.
 * - 멱등: dedup_key 를 주면 mobile_push_log 에 1회 선점(claim)해 중복 발송을 막는다
 *   (approval_notify_log 와 동일 패턴).
 * - 수신 필터: 사용자별 이벤트 토글(mobile_notify_prefs) + 방해금지 시간대.
 * - 무효 토큰(DeviceNotRegistered)은 영수증을 확인해 자동 폐기한다.
 */
import crypto from "node:crypto";
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { ChannelSendResult } from "./email-ses";

/** 푸시 이벤트 키 — 앱 설정 화면과 공유하는 카탈로그. */
export type PushEventKey =
  | "chat.message"
  | "board.posted"
  | "approval.step_pending"
  | "approval.result"
  | "approval.remind"
  | "approval.delegated"
  | "mail.received"
  | "leave.notice"
  | "invoice.request"
  | "bid.match"
  | "bid.deadline";

/**
 * 이벤트 기본 수신 여부(사용자 설정 행이 없을 때).
 *
 * 입찰 2종도 기본 ON 이다 — 블루프린트는 OFF 로 적었지만, 실제 구조는 전 직원 발송이 아니라
 * **관리자가 웹에서 수신자와 채널("앱")을 지정한 사람만** 후보가 된다. 그 위에 앱 개인설정까지
 * OFF 기본이면 이중 옵트인이 되어 "설정했는데 안 온다"가 된다. 앱 토글은 거부용으로 둔다.
 */
const EVENT_DEFAULT: Record<PushEventKey, boolean> = {
  "chat.message": true,
  "board.posted": true,
  "approval.step_pending": true,
  "approval.result": true,
  "approval.remind": true,
  "approval.delegated": true,
  "mail.received": true,
  "leave.notice": true,
  "invoice.request": true,
  "bid.match": true,
  "bid.deadline": true,
};

export const PUSH_EVENTS: { key: PushEventKey; label: string; description: string }[] = [
  { key: "chat.message", label: "메신저 새 메시지", description: "대화방에 새 메시지가 왔을 때(방별 알림 끄기와 별개)" },
  { key: "approval.step_pending", label: "결재 차례 도착", description: "내가 결재할 문서가 올라왔을 때" },
  { key: "approval.result", label: "기안 결과", description: "내가 올린 문서가 승인·반려됐을 때" },
  { key: "approval.remind", label: "결재 재촉", description: "결재가 지연될 때 알림" },
  { key: "approval.delegated", label: "대결 위임", description: "다른 사람의 결재를 대신 맡게 됐을 때" },
  { key: "board.posted", label: "공지·게시판", description: "새 공지·부서 게시글이 등록됐을 때" },
  { key: "mail.received", label: "새 메일", description: "새 메일을 받았을 때" },
  { key: "leave.notice", label: "연차 촉진 고지", description: "연차 사용 촉진 고지가 도착했을 때" },
  { key: "invoice.request", label: "세금계산서 발행", description: "발행 요청·처리 소식" },
  { key: "bid.match", label: "공공입찰 매칭", description: "사업분야에 맞는 공고가 수집됐을 때" },
  { key: "bid.deadline", label: "입찰 마감 임박", description: "매칭된 공고의 마감일이 다가올 때" },
];

let expo: Expo | null = null;
function getExpo(): Expo {
  // EXPO_ACCESS_TOKEN 은 선택(설정 시 발송 보안 강화). 미설정이어도 발송은 동작한다.
  expo ??= new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  return expo;
}

interface TokenRow {
  tokenId: string;
  userId: string;
  token: string;
}

/** 활성 토큰 조회(수신 거부·폐기 제외). */
async function listTokens(userIds: string[]): Promise<TokenRow[]> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT token_id, user_id, expo_token
         FROM mobile_push_tokens
        WHERE user_id = ANY($1::text[]) AND revoked_at IS NULL`,
      [ids]
    )
  );
  return rows.map((r) => ({
    tokenId: String(r.token_id),
    userId: String(r.user_id),
    token: String(r.expo_token),
  }));
}

/** KST 기준 현재 시각 HH:MM. */
function nowKstHhmm(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

function inQuietWindow(now: string, from: string, to: string): boolean {
  // from <= to : 같은 날 구간(예: 01:00~06:00). from > to : 자정을 넘는 구간(예: 22:00~07:00).
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

/** 이벤트 수신을 허용하는 사용자만 남긴다(개인 토글 + 방해금지). */
async function filterRecipients(userIds: string[], event: PushEventKey): Promise<string[]> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return [];
  const db = await getDb();

  const prefRows = rowsToObjects(
    await db.exec(
      `SELECT user_id, enabled FROM mobile_notify_prefs WHERE event_key = $1 AND user_id = ANY($2::text[])`,
      [event, ids]
    )
  );
  const disabled = new Set(
    prefRows.filter((r) => Number(r.enabled ?? 1) === 0).map((r) => String(r.user_id))
  );

  const quietRows = rowsToObjects(
    await db.exec(
      `SELECT user_id, enabled, quiet_from, quiet_to FROM mobile_notify_quiet_hours WHERE user_id = ANY($1::text[])`,
      [ids]
    )
  );
  const now = nowKstHhmm();
  const quiet = new Set(
    quietRows
      .filter(
        (r) =>
          Number(r.enabled ?? 1) === 1 &&
          inQuietWindow(now, String(r.quiet_from ?? "22:00"), String(r.quiet_to ?? "07:00"))
      )
      .map((r) => String(r.user_id))
  );

  const byDefault = EVENT_DEFAULT[event] ?? true;
  return ids.filter((id) => {
    if (quiet.has(id)) return false;
    if (disabled.has(id)) return false;
    if (!byDefault && !prefRows.some((r) => String(r.user_id) === id && Number(r.enabled) === 1)) {
      return false;
    }
    return true;
  });
}

/** dedup_key 로 1회 선점. 새로 선점하면 push_id, 이미 있으면 null(중복 → 스킵). */
async function claim(params: {
  dedupKey: string;
  userId: string | null;
  event: PushEventKey;
  targetRef: string | null;
  title: string;
  body: string;
  link: string | null;
}): Promise<string | null> {
  let pushId: string | null = null;
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(
        `INSERT INTO mobile_push_log
           (push_id, user_id, event_key, dedup_key, target_ref, title, body, link, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (dedup_key) DO NOTHING
         RETURNING push_id`,
        [
          "mpsh-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14),
          params.userId,
          params.event,
          params.dedupKey,
          params.targetRef,
          params.title,
          params.body.slice(0, 500),
          params.link,
          new Date().toISOString(),
        ]
      )
    );
    pushId = rows.length ? String(rows[0].push_id) : null;
  });
  return pushId;
}

async function finalize(pushId: string, ok: boolean, detail: string, tickets: unknown): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE mobile_push_log SET ok = $2, detail = $3, tickets = $4::jsonb WHERE push_id = $1`,
      [pushId, ok ? 1 : 0, detail, JSON.stringify(tickets ?? null)]
    );
  });
}

async function revokeToken(token: string, reason: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE mobile_push_tokens SET revoked_at = $2, revoke_reason = $3 WHERE expo_token = $1 AND revoked_at IS NULL`,
      [token, new Date().toISOString(), reason]
    );
  });
}

export interface PushPayload {
  event: PushEventKey;
  title: string;
  body: string;
  /** 앱 딥링크 경로(예: /board/bpost-xxx). 알림 탭 시 이동한다. */
  link?: string | null;
  /** 대상 식별(로그·추적용). */
  targetRef?: string | null;
  /**
   * 멱등 키. 주면 중복 발송을 막고 이력을 남긴다.
   * 미지정 시 수신자별로 임의 키를 만들어 그대로 발송한다(중복 방지 없음).
   */
  dedupKey?: string;
  badge?: number;
}

/**
 * 사용자들에게 푸시를 보낸다. 실패해도 예외를 던지지 않는다(호출부 보호).
 * dedupKey 는 수신자별로 `${dedupKey}:${userId}` 로 확장해 사용한다.
 */
export async function sendPush(userIds: string[], payload: PushPayload): Promise<ChannelSendResult> {
  try {
    const allowed = await filterRecipients(userIds, payload.event);
    if (!allowed.length) {
      // 조용히 끝나면 "왜 안 왔지"를 추적할 수 없다 — 스킵 사유는 서버 로그에 남긴다.
      console.warn(`[push] ${payload.event}: 수신 대상 0명(후보 ${userIds.length}명, 설정·방해금지 필터)`);
      return { ok: false, skipped: "수신 대상 없음(설정·방해금지)" };
    }

    const tokens = await listTokens(allowed);
    if (!tokens.length) {
      console.warn(`[push] ${payload.event}: 대상 ${allowed.length}명 중 등록된 기기 없음`);
      return { ok: false, skipped: "등록된 기기 없음" };
    }

    // 수신자 단위로 선점 — 같은 이벤트를 두 번 호출해도 사람당 1회만 나간다.
    const claims = new Map<string, string>(); // userId → pushId
    for (const userId of new Set(tokens.map((t) => t.userId))) {
      const key = payload.dedupKey
        ? `${payload.dedupKey}:${userId}`
        : `${payload.event}:${userId}:${crypto.randomUUID()}`;
      const pushId = await claim({
        dedupKey: key,
        userId,
        event: payload.event,
        targetRef: payload.targetRef ?? null,
        title: payload.title,
        body: payload.body,
        link: payload.link ?? null,
      });
      if (pushId) claims.set(userId, pushId);
    }
    if (!claims.size) return { ok: false, skipped: "이미 발송됨(dedup)" };

    const targets = tokens.filter(
      (t) => claims.has(t.userId) && Expo.isExpoPushToken(t.token)
    );
    if (!targets.length) {
      for (const pushId of claims.values()) await finalize(pushId, false, "유효한 토큰 없음", null);
      return { ok: false, skipped: "유효한 Expo 토큰 없음" };
    }

    const messages: ExpoPushMessage[] = targets.map((t) => ({
      to: t.token,
      title: payload.title,
      body: payload.body,
      sound: "default",
      badge: payload.badge,
      data: { link: payload.link ?? null, event: payload.event, ref: payload.targetRef ?? null },
      priority: "high",
      channelId: "default",
    }));

    const client = getExpo();
    const tickets: ExpoPushTicket[] = [];
    for (const chunk of client.chunkPushNotifications(messages)) {
      try {
        tickets.push(...(await client.sendPushNotificationsAsync(chunk)));
      } catch (e) {
        console.error("[push] 청크 발송 실패:", e);
      }
    }

    // 티켓 단계에서 이미 드러나는 무효 토큰은 즉시 폐기(영수증 폴링 없이 처리되는 케이스).
    let sent = 0;
    const byUser = new Map<string, ExpoPushTicket[]>();
    tickets.forEach((ticket, i) => {
      const target = targets[i];
      if (!target) return;
      const list = byUser.get(target.userId) ?? [];
      list.push(ticket);
      byUser.set(target.userId, list);
      if (ticket.status === "ok") {
        sent += 1;
        return;
      }
      const code = ticket.details?.error;
      if (code === "DeviceNotRegistered") void revokeToken(target.token, "DeviceNotRegistered");
    });

    for (const [userId, pushId] of claims) {
      const list = byUser.get(userId) ?? [];
      const ok = list.some((t) => t.status === "ok");
      await finalize(pushId, ok, ok ? "sent" : "failed", list);
    }

    return { ok: sent > 0, sentTo: sent };
  } catch (e) {
    console.error("[push] 발송 실패:", e);
    return { ok: false, error: (e as Error).message };
  }
}
