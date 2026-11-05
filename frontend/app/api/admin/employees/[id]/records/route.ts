import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { requireEmployeeScope } from "@/lib/auth/scope-guards";
import { deleteEmployeeRecordRow, isEmployeeRecordKind } from "@/lib/admin/employee-records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// 학력·자격·경력·주거비 행 삭제(+연결된 증빙).
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const actor = await requireEmployeeScope("staffing.edit", id);
    await requirePermission("staffing.documents.manage", { fallbackRoles: ["admin"] }); // 연결된 증빙도 함께 지운다
    const { searchParams } = new URL(req.url);
    const kind = searchParams.get("kind");
    const rowId = searchParams.get("rowId");
    if (!isEmployeeRecordKind(kind) || !rowId) {
      return NextResponse.json({ error: "kind와 rowId가 필요합니다." }, { status: 400 });
    }
    await deleteEmployeeRecordRow(actor.userId, id, kind, rowId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
