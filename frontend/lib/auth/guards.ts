/**
 * API 라우트 권한 가드 헬퍼.
 * - requireSession(): 401 없으면 NextResponse 던짐
 * - requirePermission('contract.view'): 권한 템플릿(grant) 판정, 부족 시 403
 * - requireAuthenticated(): 세션만 요구(본인 데이터·전직원 공용 조회 라우트)
 * - 모든 API 라우트 진입에서 호출.
 *
 * role 기반 가드(requireRole/requireEditor/requireAdmin)는 role 일원화(2026-10-19, WP2)로 삭제했다.
 * users.role 은 admin|member 부트스트랩 플래그일 뿐 권한의 근거가 아니다.
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

/**
 * 옛 role 값까지 받는 호환 타입 — `fallbackRoles` 인자(WP3 에서 일괄 제거 예정)의 기존 호출부가
 * "editor"/"viewer" 를 넘기고 있어 타입만 넓혀 둔다. 판정에는 쓰이지 않는다.
 */
export type LegacyRole = Role | "editor" | "viewer";

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
  // 도메인 계층이 `Object.assign(new Error(...), { status })` 로 던지는 사용자 오류(400·403·404 등)를
  // 그대로 전달한다. status 가 없으면 종전대로 500.
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number" && status >= 400 && status < 600) {
    return NextResponse.json({ error: (err as Error)?.message ?? "요청을 처리할 수 없습니다." }, { status });
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
    role: (user.role ?? "member") as Role,
    status: (user.status ?? "active") as UserStatus,
  };
}

/** 세션만 요구(전 직원) — 본인 데이터·공용 조회 라우트용. */
export async function requireAuthenticated(): Promise<AuthContext> {
  return requireSession();
}

/**
 * RBAC 강제 여부. 이제 **기본이 켜짐**이다 — 권한 템플릿으로만 판정한다.
 * env RBAC_ENFORCE='false' 를 명시할 때만 옛 호환 모드로 되돌아간다(비상용).
 * ⚠ role 일원화 이후 호환 모드는 role=admin 만 통과시킨다(editor/viewer 가 없으므로 fallbackRoles 는 무의미).
 *   비상 우회는 RBAC_ADMIN_BYPASS(lib/auth/rbac.ts) 하나로 일원화하고 이 분기는 WP3 에서 제거한다.
 */
const RBAC_ENFORCE = process.env.RBAC_ENFORCE !== "false";

// 비상 호환 모드 기동 감지(PR-P1/G7) — 프로세스당 1회 접속기록 + 경고.
// 평시에는 절대 켜지지 않아야 하는 스위치라, 켜진 채 기동한 사실 자체를 기록한다.
let bypassLogged = false;
function logRbacBypassOnce(userId: string): void {
  if (bypassLogged) return;
  bypassLogged = true;
  console.warn("[auth] ⚠ RBAC_ENFORCE=false 비상 호환 모드로 동작 중 — 권한 템플릿 판정이 꺼져 있습니다.");
  void import("./access-log").then(({ recordAccessLog }) =>
    recordAccessLog({
      actorUserId: userId,
      action: "admin_change",
      targetKind: "rbac_bypass",
      detail: { note: "RBAC_ENFORCE=false 상태로 requirePermission 통과 시작" },
    })
  );
}

/**
 * RBAC 권한키 가드.
 *
 * 판정은 오직 권한 템플릿(hasPermission)이다. role 은 상위 권한으로 쓰지 않는다 —
 * 관리자 권한의 근거는 `tpl-system-admin` 템플릿(마이그 111).
 *
 * ⚠ `fallbackRoles` 는 호환 모드(RBAC_ENFORCE=false)에서만 쓰이던 잔재다(WP3 에서 일괄 제거).
 *   신규 코드에서는 넘기지 말 것. 기존 호출부의 값은 무시된다.
 */
export async function requirePermission(
  permissionKey: string,
  opts?: { target?: PermissionTarget; fallbackRoles?: LegacyRole[] }
): Promise<AuthContext> {
  const ctx = await requireSession();

  if (!RBAC_ENFORCE) {
    // 비상 호환 모드 — 부트스트랩 관리자(role=admin)만 통과한다.
    logRbacBypassOnce(ctx.userId);
    if (ctx.role === "admin") return ctx;
    throw new AuthError("이 작업을 수행할 권한이 없습니다.", 403);
  }

  const ok = await hasPermission(ctx.userId, permissionKey, opts?.target);
  if (!ok) throw new AuthError("이 작업을 수행할 권한이 없습니다.", 403);
  return ctx;
}
