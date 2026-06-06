/**
 * 부팅 시 admin 계정이 0명이면 환경변수 ADMIN_EMAIL / ADMIN_PASSWORD 로 자동 생성.
 * - ADMIN_PASSWORD_SYNC_ON_BOOT=true 이면 환경변수 admin 계정을 생성/활성화하고 비밀번호를 동기화한다.
 * - 환경변수 미설정 시 시드를 건너뛰고 경고만 남긴다 (개발 편의).
 * - users 테이블 스키마는 PostgreSQL 마이그레이션 (infra/aws/001_initial_schema.sql) 으로 사전 적용된 상태로 가정.
 */

import { countAdmins, createUser, findUserByEmail, resetUserPassword, updateUser } from "./users";
import { recordAuditLog } from "./audit";

let seedPromise: Promise<void> | null = null;

export async function ensureAdminSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = doSeed().catch((err) => {
    seedPromise = null;
    throw err;
  });
  return seedPromise;
}

async function doSeed(): Promise<void> {
  const adminCount = await countAdmins();

  const email = (process.env.ADMIN_EMAIL ?? process.env.ADMIN_USERNAME)?.trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "관리자";
  const syncAdminPassword = process.env.ADMIN_PASSWORD_SYNC_ON_BOOT === "true";

  if (adminCount > 0 && !syncAdminPassword) return;

  if (!email || !password) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[auth/seed] ADMIN_EMAIL/ADMIN_USERNAME/ADMIN_PASSWORD 환경변수가 비어 있어 admin 시드를 건너뜁니다."
      );
    }
    return;
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    if (syncAdminPassword) {
      const patch: Parameters<typeof updateUser>[1] = {};
      if (existing.role !== "admin") patch.role = "admin";
      if (existing.status !== "active") patch.status = "active";
      if (Object.keys(patch).length) await updateUser(existing.userId, patch);
      await resetUserPassword(existing.userId, password);
      await recordAuditLog({
        actorUserId: null,
        action: "admin_password_sync",
        targetTable: "users",
        targetId: existing.userId,
        after: { email: existing.email, role: "admin", source: "seed_sync" },
      });
      console.log("[auth/seed] admin 계정 비밀번호 동기화 완료: " + existing.email);
      return;
    }
    console.warn("[auth/seed] " + email + " 계정이 이미 존재합니다. 시드 생략.");
    return;
  }

  const created = await createUser({
    email,
    password,
    name,
    role: "admin",
    createdBy: null,
  });
  await recordAuditLog({
    actorUserId: null,
    action: "user_create",
    targetTable: "users",
    targetId: created.userId,
    after: { email: created.email, role: created.role, source: "seed" },
  });
  console.log("[auth/seed] admin 계정 자동 생성 완료: " + created.email);
}
