import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { canEditWorkTypes, listWorkTypes, saveWorkTypes } from "@/lib/todo/work-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 하위 작업 유형·종류(302) — GET { types, canEdit } · PUT { types }(관리자, 전체 교체·빠진 항목은 숨김).
export async function GET() {
  try {
    const ctx = await requireSession();
    const [types, canEdit] = await Promise.all([listWorkTypes(), canEditWorkTypes(ctx.userId)]);
    return NextResponse.json({ types, canEdit });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ types: await saveWorkTypes(ctx.userId, body ?? {}) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
