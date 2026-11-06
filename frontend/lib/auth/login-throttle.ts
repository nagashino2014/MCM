/**
 * 로그인 무차별 대입(brute-force) 방어 — DB 기반 시도 제한.
 * - login_attempts 테이블(infra/aws/041_login_attempts.sql)에 실패 시도를 기록한다.
 * - authorize() 에서 자격 검증 전에 isLoginBlocked() 로 임계 초과 여부를 확인한다.
 * - DB 오류 시 fail-open(통과) — 부가 방어선이므로 가용성을 우선한다.
 */

import { getDb, withDbWrite, rowsToObjects } from "../db";
import {
  LOGIN_LOCK_MAX_FAILS,
  LOGIN_LOCK_MAX_FAILS_PER_IP,
  LOGIN_LOCK_WINDOW_MINUTES,
  type LoginLockReason,
} from "./login-lock";

/** ALB 가 세팅하는 X-Forwarded-For 의 첫 IP. 없으면 "unknown". */
export function clientIpFrom(request?: Request): string {
  if (!request) return "unknown";
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || "unknown";
  const real = request.headers.get("x-real-ip");
  return real?.trim() || "unknown";
}

/** 윈도 내 실패 횟수가 임계를 넘었으면 그 사유, 아니면 null. DB 오류 시 null(통과). */
export async function getLoginBlock(email: string, ip: string): Promise<LoginLockReason | null> {
  try {
    const db = await getDb();
    const res = await db.exec(
      `SELECT
         COUNT(*) FILTER (WHERE email = $1) AS email_fails,
         COUNT(*) FILTER (WHERE ip = $2)    AS ip_fails
       FROM login_attempts
       WHERE success = false
         AND attempted_at > now() - make_interval(mins => $3)`,
      [email, ip, LOGIN_LOCK_WINDOW_MINUTES]
    );
    const row = rowsToObjects(res)[0] ?? {};
    const emailFails = Number(row.email_fails ?? 0);
    const ipFails = Number(row.ip_fails ?? 0);
    if (emailFails >= LOGIN_LOCK_MAX_FAILS) return "account";
    if (ipFails >= LOGIN_LOCK_MAX_FAILS_PER_IP) return "ip";
    return null;
  } catch (err) {
    console.warn("[login-throttle] block 검사 실패(통과 처리): " + (err as Error).message);
    return null;
  }
}

/** 차단 여부만 필요한 호출부(본인 찾기·메일 게이트웨이)용. */
export async function isLoginBlocked(email: string, ip: string): Promise<boolean> {
  return (await getLoginBlock(email, ip)) !== null;
}

/** 실패 시도 1건 기록 + 1일 지난 오래된 기록 정리. */
export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  try {
    await withDbWrite(async (db) => {
      await db.run(
        "INSERT INTO login_attempts (email, ip, success) VALUES ($1, $2, false)",
        [email, ip]
      );
      await db.run(
        "DELETE FROM login_attempts WHERE attempted_at < now() - interval '1 day'",
        []
      );
    });
  } catch (err) {
    console.warn("[login-throttle] 실패 기록 오류: " + (err as Error).message);
  }
}

/**
 * 비밀번호 재설정 완료 시 그 계정의 잠금 해제. 로그인 식별자(사번·이메일 로컬파트·이메일)별 실패 기록을 모두 지운다.
 * 실패해도 재설정 자체는 유효하므로 경고만 남긴다. IP 단위 기록은 다른 계정과 공유하므로 그대로 둔다.
 */
export async function clearLoginFailuresForUser(userId: string): Promise<void> {
  try {
    await withDbWrite(async (db) => {
      await db.run(
        `DELETE FROM login_attempts
          WHERE success = false
            AND email IN (
              SELECT lower(k)
                FROM users u, unnest(ARRAY[u.login_id, u.email_local, u.email]) AS k
               WHERE u.user_id = $1 AND k IS NOT NULL
            )`,
        [userId]
      );
    });
  } catch (err) {
    console.warn("[login-throttle] 계정 잠금 해제 오류: " + (err as Error).message);
  }
}

/** 로그인 성공 시 해당 이메일의 실패 기록 초기화(카운터 리셋). */
export async function clearLoginFailures(email: string): Promise<void> {
  try {
    await withDbWrite(async (db) => {
      await db.run(
        "DELETE FROM login_attempts WHERE email = $1 AND success = false",
        [email]
      );
    });
  } catch (err) {
    console.warn("[login-throttle] 실패 초기화 오류: " + (err as Error).message);
  }
}
