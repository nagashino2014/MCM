import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission, requireSession } from "@/lib/auth/guards";
import { checkPermission, loadUserAccess } from "@/lib/auth/rbac";
import { listOrganizationSnapshot, saveDepartment } from "@/lib/admin/organization";
import { recordAuditLog } from "@/lib/auth/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 조회는 org.view 또는 계정·권한 관리 키(account.manage·rbac.*) — 계정·권한 관리 화면은 조직도에서 계정을 고르므로
// 그 키 하나만 가진 담당자도 조직도를 읽어야 한다(F-27, 2026-10-21). 저장(POST)은 종전대로 org.edit.
const ORG_READ_FALLBACK_KEYS = ["account.manage", "rbac.assignment.manage", "rbac.template.manage"] as const;

async function requireOrgReader() {
  try {
    return await requirePermission("org.view");
  } catch (err) {
    if (!(err instanceof AuthError && err.status === 403)) throw err;
    const ctx = await requireSession();
    const access = await loadUserAccess(ctx.userId);
    if (ORG_READ_FALLBACK_KEYS.some((key) => checkPermission(access, key))) return ctx;
    throw err;
  }
}

export async function GET() {
  try {
    await requireOrgReader();
    return NextResponse.json(await listOrganizationSnapshot());
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("org.edit", { fallbackRoles: ["admin"] });
    const body = await req.json();
    const department = await saveDepartment(body);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "employee_update",
      targetTable: "departments",
      targetId: department.deptId,
      after: department,
    });
    return NextResponse.json({ department });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
