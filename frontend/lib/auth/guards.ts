/**
 * API 라우트 권한 가드 헬퍼.
 * - requireSession(): 401 없으면 NextResponse 던짐
 * - requireRole(['admin','editor']): 권한 부족 시 403
 * - 모든 API 라우트 진입에서 호출.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "./config";
import { verifyAccessToken } from "./mobile-token";
import type { Role, UserStatus } from "./users";
import { hasPermission, type PermissionTarget } from "./rbac";

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
  // 모바일 네이티브 앱: Authorization: Bearer <accessToken> 우선.
  // 웹은 HttpOnly 쿠키 세션. 두 경로 모두 이 단일 관문을 통과한다(라우트 무변경 재사용).
  const authz = (await headers()).get("authorization");
  if (authz && authz.toLowerCase().startsWith("bearer ")) {
    const claims = await verifyAccessToken(authz.slice(7).trim());
    if (!claims) {
      throw new AuthError("유효하지 않은 토큰입니다.", 401);
    }
    if (claims.status !== "active") {
      throw new AuthError("비활성화된 계정입니다.", 401);
    }
    return {
      userId: claims.userId,
      email: claims.email,
      role: claims.role,
      status: claims.status,
    };
  }

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

/**
 * @deprecated role 기반 가드. 권한 판정은 requirePermission(권한키)으로 한다.
 *   남겨둔 이유는 외부 참조 안전뿐이며, 신규 코드에서 쓰지 말 것.
 */
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

/**
 * RBAC 강제 여부. 이제 **기본이 켜짐**이다 — 권한 템플릿으로만 판정한다.
 * env RBAC_ENFORCE='false' 를 명시할 때만 옛 role 호환 모드로 되돌아간다(비상용).
 */
const RBAC_ENFORCE = process.env.RBAC_ENFORCE !== "false";

/**
 * RBAC 권한키 가드.
 *
 * 판정은 오직 권한 템플릿(hasPermission)이다. role(admin/editor/viewer)은 더 이상
 * 상위 권한으로 쓰지 않는다 — 관리자 권한의 근거는 `tpl-system-admin` 템플릿(마이그 111).
 *
 * ⚠ `fallbackRoles` 는 호환 모드(RBAC_ENFORCE=false)에서만 쓰이는 잔재다.
 *   신규 코드에서는 넘기지 말 것. 기존 호출부의 값은 무시된다.
 */
export async function requirePermission(
  permissionKey: string,
  opts?: { target?: PermissionTarget; fallbackRoles?: Role[] }
): Promise<AuthContext> {
  const ctx = await requireSession();

  if (!RBAC_ENFORCE) {
    // 비상 호환 모드 — 옛 role 기준으로만 판정한다.
    if (ctx.role === "admin") return ctx;
    const roles = opts?.fallbackRoles;
    if (!roles || roles.includes(ctx.role)) return ctx;
    throw new AuthError("이 작업을 수행할 권한이 없습니다.", 403);
  }

  const ok = await hasPermission(ctx.userId, permissionKey, opts?.target);
  if (!ok) throw new AuthError("이 작업을 수행할 권한이 없습니다.", 403);
  return ctx;
}
