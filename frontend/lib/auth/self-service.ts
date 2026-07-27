/**
 * 로그인 셀프서비스(G-L) — 아이디(사번) 찾기 + 비밀번호 재설정.
 * - 계정 열거 방지: 입력이 일치하지 않아도 항상 동일한 성공 응답(발송 여부는 알려주지 않음).
 * - 스로틀: login_attempts(041) 재사용 — 식별자 앞에 selfsvc: 접두.
 * - 재설정 토큰: 원문은 메일 링크로만 전달, DB 에는 sha256 해시만 저장(101). 30분 만료·1회용.
 * 설계: docs/groupware-ux-overhaul-blueprint.md §8.1.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { isLoginBlocked, recordLoginFailure } from "@/lib/auth/login-throttle";
import { recordAuditLog } from "@/lib/auth/audit";
import { sendNotifyEmail } from "@/lib/notify/email-ses";

const RESET_TTL_MS = 30 * 60 * 1000; // 30분

function appBase(): string {
  return (process.env.APP_PUBLIC_URL ?? "https://koensain.app").replace(/\/+$/, "");
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

interface MatchedUser {
  userId: string;
  loginId: string;
  email: string; // 발송 대상(직원 프로필 이메일)
  name: string;
}

/** 이름+등록 이메일 또는 사번+등록 이메일로 활성 계정 매칭. */
async function matchUser(params: { name?: string; loginId?: string; email: string }): Promise<MatchedUser | null> {
  const db = await getDb();
  const email = params.email.trim().toLowerCase();
  if (!email) return null;
  const cond = params.loginId ? `u.login_id = $2` : `ep.name = $2`;
  const key = params.loginId ? params.loginId.trim() : (params.name ?? "").trim();
  if (!key) return null;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT u.user_id, u.login_id, ep.email, ep.name
         FROM users u JOIN employee_profiles ep ON ep.employee_id = u.employee_id
        WHERE u.status = 'active' AND lower(COALESCE(ep.email, '')) = $1 AND ${cond}
        LIMIT 1`,
      [email, key]
    )
  );
  if (!rows.length) return null;
  const r = rows[0];
  if (r.login_id == null) return null;
  return { userId: String(r.user_id), loginId: String(r.login_id), email: String(r.email), name: String(r.name ?? "") };
}

/** 아이디(사번) 찾기 — 일치 시 등록 이메일로 사번 발송. 항상 성공 형태 반환(열거 방지). */
export async function findLoginId(name: string, email: string, ip: string): Promise<{ ok: true }> {
  const throttleKey = `selfsvc:find:${email.toLowerCase()}`;
  if (await isLoginBlocked(throttleKey, ip)) return { ok: true }; // 차단 중에도 동일 응답
  const matched = await matchUser({ name, email });
  if (!matched) {
    await recordLoginFailure(throttleKey, ip);
    return { ok: true };
  }
  await sendNotifyEmail({
    to: [matched.email],
    subject: "[PermitIQ] 아이디(사번) 안내",
    text: `${matched.name}님, 요청하신 로그인 아이디(사번)는 다음과 같습니다.\n\n사번: ${matched.loginId}\n\n본인이 요청하지 않았다면 이 메일을 무시하세요.`,
  });
  await recordAuditLog({ actorUserId: matched.userId, action: "auth_find_id", targetTable: "users", targetId: matched.userId });
  return { ok: true };
}

/** 비밀번호 재설정 요청 — 일치 시 1회용 토큰 링크를 이메일 발송. 항상 성공 형태 반환. */
export async function requestPasswordReset(loginId: string, email: string, ip: string): Promise<{ ok: true }> {
  const throttleKey = `selfsvc:reset:${loginId.trim()}`;
  if (await isLoginBlocked(throttleKey, ip)) return { ok: true };
  const matched = await matchUser({ loginId, email });
  if (!matched) {
    await recordLoginFailure(throttleKey, ip);
    return { ok: true };
  }
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO password_reset_tokens (token_id, user_id, token_hash, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        "prt-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14),
        matched.userId,
        sha256Hex(token),
        new Date(now + RESET_TTL_MS).toISOString(),
        new Date(now).toISOString(),
      ]
    );
  });
  const link = `${appBase()}/login/reset?token=${token}`;
  await sendNotifyEmail({
    to: [matched.email],
    subject: "[PermitIQ] 비밀번호 재설정 안내",
    text: `${matched.name}님, 아래 링크에서 비밀번호를 재설정하세요(30분 이내 1회 사용 가능).\n\n${link}\n\n본인이 요청하지 않았다면 이 메일을 무시하세요. 링크는 30분 후 만료됩니다.`,
  });
  await recordAuditLog({ actorUserId: matched.userId, action: "auth_password_reset", targetTable: "users", targetId: matched.userId, after: { stage: "requested" } });
  return { ok: true };
}

/** 재설정 확정 — 토큰 검증 후 새 비밀번호 저장(토큰 1회용 폐기). */
export async function confirmPasswordReset(token: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (newPassword.length < 8) return { ok: false, error: "비밀번호는 8자 이상이어야 합니다." };
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(`SELECT token_id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1`, [sha256Hex(token)])
  );
  if (!rows.length) return { ok: false, error: "유효하지 않은 링크입니다. 다시 요청해 주세요." };
  const r = rows[0];
  if (r.used_at != null) return { ok: false, error: "이미 사용된 링크입니다. 다시 요청해 주세요." };
  if (new Date(String(r.expires_at)).getTime() < Date.now()) return { ok: false, error: "만료된 링크입니다. 다시 요청해 주세요." };

  const userId = String(r.user_id);
  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();
  await withDbWrite(async (wdb) => {
    await wdb.run(`UPDATE users SET password_hash = $2, must_change_password = 0, updated_at = $3 WHERE user_id = $1`, [
      userId,
      passwordHash,
      now,
    ]);
    await wdb.run(`UPDATE password_reset_tokens SET used_at = $2 WHERE token_id = $1`, [String(r.token_id), now]);
  });
  await recordAuditLog({ actorUserId: userId, action: "auth_password_reset", targetTable: "users", targetId: userId, after: { stage: "completed" } });
  return { ok: true };
}
