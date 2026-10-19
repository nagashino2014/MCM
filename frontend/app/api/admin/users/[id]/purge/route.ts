import { NextRequest, NextResponse } from "next/server";
import { requirePermission, authErrorToResponse } from "@/lib/auth/guards";
import { previewAccountPurge } from "@/lib/auth/account-purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// 계정 영구 삭제 미리보기(?employee=1|0 직원 동반 가정) — 차단 사유·함께 삭제·참조 끊김·경고·확인 문자열. 실행은 DELETE /api/admin/users/[id]?confirm=&employee=&ack=.
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("account.manage", { fallbackRoles: ["admin"] });
    const { id } = await ctx.params;
    const withEmployee = req.nextUrl.searchParams.get("employee") !== "0";
    return NextResponse.json({ preview: await previewAccountPurge(actor.userId, id, withEmployee) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
