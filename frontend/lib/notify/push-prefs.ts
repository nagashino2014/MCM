/**
 * 모바일 푸시 기기 토큰·수신 설정 저장소(M1).
 * 발송 로직은 push-expo.ts, 여기는 등록/조회/수정만 담당한다.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { PUSH_EVENTS, type PushEventKey } from "./push-expo";

const EVENT_KEYS = new Set<string>(PUSH_EVENTS.map((e) => e.key));

/** 기기 토큰 등록·갱신. 같은 토큰이 다른 계정에 남아 있으면 현재 사용자로 이전한다. */
export async function registerPushToken(input: {
  userId: string;
  expoToken: string;
  platform: "ios" | "android";
  deviceId?: string | null;
  appVersion?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO mobile_push_tokens
         (token_id, user_id, expo_token, platform, device_id, app_version, created_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT (expo_token) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         platform = EXCLUDED.platform,
         device_id = EXCLUDED.device_id,
         app_version = EXCLUDED.app_version,
         last_seen_at = EXCLUDED.last_seen_at,
         revoked_at = NULL,
         revoke_reason = NULL`,
      [
        "mtok-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14),
        input.userId,
        input.expoToken,
        input.platform,
        input.deviceId ?? null,
        input.appVersion ?? null,
        now,
      ]
    );
  });
}

/** 로그아웃·수신 거부 시 폐기. 본인 토큰만 건드린다. */
export async function revokePushToken(userId: string, expoToken: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(
      `UPDATE mobile_push_tokens SET revoked_at = $3, revoke_reason = 'logout'
        WHERE expo_token = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [expoToken, userId, new Date().toISOString()]
    );
  });
}

export interface PushPrefs {
  events: { key: PushEventKey; label: string; description: string; enabled: boolean }[];
  quiet: { enabled: boolean; from: string; to: string };
  deviceCount: number;
}

export async function getPushPrefs(userId: string): Promise<PushPrefs> {
  const db = await getDb();
  const prefRows = rowsToObjects(
    await db.exec(`SELECT event_key, enabled FROM mobile_notify_prefs WHERE user_id = $1`, [userId])
  );
  const map = new Map(prefRows.map((r) => [String(r.event_key), Number(r.enabled ?? 1) === 1]));

  const quietRows = rowsToObjects(
    await db.exec(
      `SELECT enabled, quiet_from, quiet_to FROM mobile_notify_quiet_hours WHERE user_id = $1`,
      [userId]
    )
  );
  const q = quietRows[0];

  const deviceRows = rowsToObjects(
    await db.exec(
      `SELECT count(*)::int AS n FROM mobile_push_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    )
  );

  return {
    events: PUSH_EVENTS.map((e) => ({ ...e, enabled: map.get(e.key) ?? true })),
    quiet: {
      enabled: q ? Number(q.enabled ?? 1) === 1 : true,
      from: q ? String(q.quiet_from ?? "22:00") : "22:00",
      to: q ? String(q.quiet_to ?? "07:00") : "07:00",
    },
    deviceCount: deviceRows.length ? Number(deviceRows[0].n) : 0,
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function savePushPrefs(
  userId: string,
  input: {
    events?: { key: string; enabled: boolean }[];
    quiet?: { enabled: boolean; from: string; to: string };
  }
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    for (const e of input.events ?? []) {
      if (!EVENT_KEYS.has(e.key)) continue;
      await db.run(
        `INSERT INTO mobile_notify_prefs (user_id, event_key, enabled, updated_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, event_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
        [userId, e.key, e.enabled ? 1 : 0, now]
      );
    }
    if (input.quiet) {
      const from = HHMM.test(input.quiet.from) ? input.quiet.from : "22:00";
      const to = HHMM.test(input.quiet.to) ? input.quiet.to : "07:00";
      await db.run(
        `INSERT INTO mobile_notify_quiet_hours (user_id, enabled, quiet_from, quiet_to, updated_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled,
           quiet_from = EXCLUDED.quiet_from, quiet_to = EXCLUDED.quiet_to, updated_at = EXCLUDED.updated_at`,
        [userId, input.quiet.enabled ? 1 : 0, from, to, now]
      );
    }
  });
}
