import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { previewDepartmentDelete } from "@/lib/admin/organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 부서 삭제 미리보기(?deptId=) — 막는 사유·함께 지워지는 것. 실행은 DELETE /api/admin/organization?deptId=.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("org.edit", { fallbackRoles: ["admin"] });
    const deptId = req.nextUrl.searchParams.get("deptId");
    if (!deptId) {
      return NextResponse.json({ error: "deptId가 필요합니다." }, { status: 400 });
    }
    return NextResponse.json({ preview: await previewDepartmentDelete(deptId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
