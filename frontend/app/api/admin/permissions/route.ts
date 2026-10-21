import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listPermissionsSnapshot, savePermissionTemplate } from "@/lib/admin/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 조회는 템플릿 관리자 또는 권한 부여 담당자(rbac.assignment.manage) — 부여 담당자도 템플릿 목록·부여 현황이 있어야
// 계정에 권한을 줄 수 있다(F-27, 2026-10-21). 저장(POST)은 종전대로 rbac.template.manage 만.
async function requireTemplateReader() {
  try {
    return await requirePermission("rbac.template.manage");
  } catch (err) {
    if (err instanceof AuthError && err.status === 403) return requirePermission("rbac.assignment.manage");
    throw err;
  }
}

export async function GET() {
  try {
    await requireTemplateReader();
    return NextResponse.json(await listPermissionsSnapshot());
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("rbac.template.manage", { fallbackRoles: ["admin"] });
    const body = await req.json();
    const templateId = await savePermissionTemplate(actor.userId, body);
    return NextResponse.json({ templateId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
