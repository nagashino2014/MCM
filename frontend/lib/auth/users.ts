/**
 * users 테이블 read/write 헬퍼.
 * - frontend/lib/db.ts의 withDbWrite (PostgreSQL 트랜잭션) 를 통해 동시 쓰기를 직렬화.
 * - role 은 'admin' | 'editor' | 'viewer'. status 는 'active' | 'disabled'.
 */

import crypto from "node:crypto";
import { getDb, invalidateDb, rowsToObjects, withDbWrite } from "../db";
import { hashPassword } from "./password";

export type Role = "admin" | "editor" | "viewer";
export type UserStatus = "active" | "disabled";

export interface UserRow {
  userId: string;
  email: string;
  loginId: string | null;
  name: string;
  role: Role;
  status: UserStatus;
  mustChangePassword: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserWithHash extends UserRow {
  passwordHash: string;
}

function rowToUser(row: Record<string, unknown>): UserRow {
  return {
    userId: String(row.user_id ?? ""),
    email: String(row.email ?? ""),
    loginId: row.login_id != null ? String(row.login_id) : null,
    name: String(row.name ?? ""),
    role: (String(row.role ?? "viewer") as Role),
    status: (String(row.status ?? "active") as UserStatus),
    mustChangePassword: Number(row.must_change_password ?? 0) === 1,
    createdBy: row.created_by != null ? String(row.created_by) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function findUserByEmail(email: string): Promise<UserWithHash | null> {
  invalidateDb();
  const db = await getDb();
  let result;
  try {
    result = await db.exec(
      "SELECT user_id, email, password_hash, name, role, status, created_by, created_at, updated_at FROM users WHERE email = $1 LIMIT 1",
      [email.toLowerCase()]
    );
  } catch {
    return null;
  }
  const rows = rowsToObjects(result);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    ...rowToUser(row),
    passwordHash: String(row.password_hash ?? ""),
  };
}

export async function findUserById(userId: string): Promise<UserRow | null> {
  invalidateDb();
  const db = await getDb();
  let result;
  try {
    result = await db.exec(
      "SELECT user_id, email, name, role, status, must_change_password, created_by, created_at, updated_at FROM users WHERE user_id = $1 LIMIT 1",
      [userId]
    );
  } catch {
    return null;
  }
  const rows = rowsToObjects(result);
  if (!rows.length) return null;
  return rowToUser(rows[0]);
}

export async function listUsers(): Promise<UserRow[]> {
  invalidateDb();
  const db = await getDb();
  let result;
  try {
    result = await db.exec(
      "SELECT user_id, email, login_id, name, role, status, must_change_password, created_by, created_at, updated_at FROM users ORDER BY created_at ASC"
    );
  } catch {
    return [];
  }
  return rowsToObjects(result).map(rowToUser);
}

export async function countAdmins(): Promise<number> {
  invalidateDb();
  const db = await getDb();
  try {
    const r = await db.exec("SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active'");
    return r.length ? Number(r[0].values[0][0]) : 0;
  } catch {
    return 0;
  }
}

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role: Role;
  createdBy?: string | null;
}

export async function createUser(input: CreateUserInput): Promise<UserRow> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password || !input.name) {
    throw new Error("email/password/name이 필요합니다.");
  }
  if (!["admin", "editor", "viewer"].includes(input.role)) {
    throw new Error("invalid role");
  }
  const userId = "u_" + crypto.randomBytes(8).toString("hex");
  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();

  const created = await withDbWrite(async (db) => {
    // unique email 충돌 방지: 기존 사용자 검사
    const existing = await db.exec("SELECT user_id FROM users WHERE email = $1 LIMIT 1", [email]);
    if (existing.length && existing[0].values.length) {
      throw new Error("이미 등록된 이메일입니다.");
    }
    await db.run(
      "INSERT INTO users (user_id, email, password_hash, name, role, status, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)",
      [userId, email, passwordHash, input.name.trim(), input.role, input.createdBy ?? null, now, now]
    );
    return {
      userId,
      email,
      loginId: null,
      name: input.name.trim(),
      role: input.role,
      status: "active" as UserStatus,
      mustChangePassword: false,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    } satisfies UserRow;
  });
  return created;
}

export interface UpdateUserPatch {
  name?: string;
  role?: Role;
  status?: UserStatus;
  email?: string;
}

export async function updateUser(userId: string, patch: UpdateUserPatch): Promise<void> {
  await withDbWrite(async (db) => {
    const fields: string[] = [];
    const values: unknown[] = [];
    let pIdx = 1;
    if (patch.name !== undefined) {
      fields.push(`name = $${pIdx++}`);
      values.push(patch.name.trim());
    }
    if (patch.role !== undefined) {
      if (!["admin", "editor", "viewer"].includes(patch.role)) throw new Error("invalid role");
      fields.push(`role = $${pIdx++}`);
      values.push(patch.role);
    }
    if (patch.status !== undefined) {
      if (!["active", "disabled"].includes(patch.status)) throw new Error("invalid status");
      fields.push(`status = $${pIdx++}`);
      values.push(patch.status);
    }
    if (patch.email !== undefined) {
      const newEmail = patch.email.trim().toLowerCase();
      const existing = await db.exec(
        "SELECT user_id FROM users WHERE email = $1 AND user_id != $2 LIMIT 1",
        [newEmail, userId]
      );
      if (existing.length && existing[0].values.length) {
        throw new Error("이미 등록된 이메일입니다.");
      }
      fields.push(`email = $${pIdx++}`);
      values.push(newEmail);
    }
    if (fields.length === 0) return;
    fields.push(`updated_at = $${pIdx++}`);
    values.push(new Date().toISOString());
    values.push(userId);
    await db.run(
      "UPDATE users SET " + fields.join(", ") + ` WHERE user_id = $${pIdx}`,
      values as unknown[]
    );
  });
}

/** authorize 용 조회 결과: 사번(login_id) 또는 이메일 로컬파트(email_local)로 찾는다. */
export interface AuthLookup {
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  passwordHash: string;
  mustChangePassword: boolean;
}

/**
 * 로그인 식별자(사번 또는 이메일 로컬파트)로 계정을 조회한다.
 * 입력이 전체 이메일(@포함)이면 로컬파트만 취해 매칭(전체 주소는 식별자로 쓰지 않음 — §7.5-3).
 */
export async function findUserByLoginIdentifier(identifier: string): Promise<AuthLookup | null> {
  invalidateDb();
  const db = await getDb();
  const raw = String(identifier ?? "").trim().toLowerCase();
  if (!raw) return null;
  const at = raw.indexOf("@");
  const key = at > 0 ? raw.slice(0, at) : raw;
  let result;
  try {
    result = await db.exec(
      `SELECT user_id, email, password_hash, name, role, status, must_change_password
         FROM users
        WHERE login_id = $1 OR email_local = $1
        LIMIT 1`,
      [key]
    );
  } catch {
    return null;
  }
  const rows = rowsToObjects(result);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    userId: String(r.user_id ?? ""),
    email: String(r.email ?? ""),
    name: String(r.name ?? ""),
    role: (String(r.role ?? "viewer") as Role),
    status: (String(r.status ?? "active") as UserStatus),
    passwordHash: String(r.password_hash ?? ""),
    mustChangePassword: Number(r.must_change_password ?? 0) === 1,
  };
}

/** 본인 비밀번호 변경(현재 비번 검증용)으로 password_hash 포함 조회. */
export async function findUserWithHashById(userId: string): Promise<UserWithHash | null> {
  invalidateDb();
  const db = await getDb();
  let result;
  try {
    result = await db.exec(
      "SELECT user_id, email, password_hash, name, role, status, created_by, created_at, updated_at FROM users WHERE user_id = $1 LIMIT 1",
      [userId]
    );
  } catch {
    return null;
  }
  const rows = rowsToObjects(result);
  if (!rows.length) return null;
  return { ...rowToUser(rows[0]), passwordHash: String(rows[0].password_hash ?? "") };
}

/** 본인 비밀번호 변경 + 강제 변경 플래그 해제. */
export async function changeOwnPassword(userId: string, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error("비밀번호는 최소 8자 이상이어야 합니다.");
  }
  const hash = await hashPassword(newPassword);
  await withDbWrite(async (db) => {
    await db.run(
      "UPDATE users SET password_hash = $1, must_change_password = 0, updated_at = $2 WHERE user_id = $3",
      [hash, new Date().toISOString(), userId]
    );
  });
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error("비밀번호는 최소 8자 이상이어야 합니다.");
  }
  const hash = await hashPassword(newPassword);
  await withDbWrite(async (db) => {
    await db.run(
      "UPDATE users SET password_hash = $1, updated_at = $2 WHERE user_id = $3",
      [hash, new Date().toISOString(), userId]
    );
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run("DELETE FROM users WHERE user_id = $1", [userId]);
  });
}
