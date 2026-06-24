/**
 * 로그인 무차별 대입(brute-force) 방어 — DB 기반 시도 제한.
 * - login_attempts 테이블(infra/aws/041_login_attempts.sql)에 실패 시도를 기록한다.
 * - authorize() 에서 자격 검증 전에 isLoginBlocked() 로 임계 초과 여부를 확인한다.
 * - DB 오류 시 fail-open(통과) — 부가 방어선이므로 가용성을 우선한다.
 */

import { getDb, withDbWrite, rowsToObjects } from "../db";

const WINDOW_MINUTES = 15;
// 이메일 단위 잠금(정밀): 동일 계정 연속 실패.
const MAX_FAILS_PER_EMAIL = 5;
// IP 단위 백스톱(여러 계정 스프레이): 사무실 공용 NAT 오탐 방지 위해 높게.
const MAX_FAILS_PER_IP = 50;

/** ALB 가 세팅하는 X-Forwarded-For 의 첫 IP. 없으면 "unknown". */
export function clientIpFrom(request?: Request): string {
  if (!request) return "unknown";
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || "unknown";
  const real = request.headers.get("x-real-ip");
  return real?.trim() || "unknown";
}

/** 윈도 내 실패 횟수가 임계를 넘었는지. DB 오류 시 false(통과). */
export async function isLoginBlocked(email: string, ip: string): Promise<boolean> {
  try {
    const db = await getDb();
    const res = await db.exec(
      `SELECT
         COUNT(*) FILTER (WHERE email = $1) AS email_fails,
         COUNT(*) FILTER (WHERE ip = $2)    AS ip_fails
       FROM login_attempts
       WHERE success = false
         AND attempted_at > now() - make_interval(mins => $3)`,
      [email, ip, WINDOW_MINUTES]
    );
    const row = rowsToObjects(res)[0] ?? {};
    const emailFails = Number(row.email_fails ?? 0);
    const ipFails = Number(row.ip_fails ?? 0);
    return emailFails >= MAX_FAILS_PER_EMAIL || ipFails >= MAX_FAILS_PER_IP;
  } catch (err) {
    console.warn("[login-throttle] block 검사 실패(통과 처리): " + (err as Error).message);
    return false;
  }
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
