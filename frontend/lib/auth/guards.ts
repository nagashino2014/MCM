/**
 * API 라우트 권한 가드 헬퍼.
 * - requireSession(): 401 없으면 NextResponse 던짐
 * - requireRole(['admin','editor']): 권한 부족 시 403
 * - 모든 API 라우트 진입에서 호출.
 */

import { NextResponse } from "next/server";
import { auth } from "./config";
import type { Role, UserStatus } from "./users";

export interface AuthContext {
  userId: string;
  email: string;
  role: Role;
  status: UserStatus;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function authErrorToResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return NextResponse.json(
    { error: (err as Error)?.message ?? "internal error" },
    { status: 500 }
  );
}

export async function requireSession(): Promise<AuthContext> {
  const session = await auth();
  if (!session?.user) {
    throw new AuthError("로그인이 필요합니다.", 401);
  }
  const user = session.user as {
    id?: string;
    email?: string | null;
    role?: Role;
    status?: UserStatus;
  };
  if (user.status && user.status !== "active") {
    throw new AuthError("비활성화된 계정입니다.", 401);
  }
  return {
    userId: String(user.id ?? ""),
    email: String(user.email ?? ""),
    role: (user.role ?? "viewer") as Role,
    status: (user.status ?? "active") as UserStatus,
  };
}

export async function requireRole(roles: Role | Role[]): Promise<AuthContext> {
  const ctx = await requireSession();
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(ctx.role)) {
    throw new AuthError("이 작업을 수행할 권한이 없습니다.", 403);
  }
  return ctx;
}

/** editor 이상 (admin 또는 editor) */
export async function requireEditor(): Promise<AuthContext> {
  return requireRole(["admin", "editor"]);
}

/** admin only */
export async function requireAdmin(): Promise<AuthContext> {
  return requireRole("admin");
}

/** viewer 이상 (전 role) */
export async function requireAuthenticated(): Promise<AuthContext> {
  return requireSession();
}
