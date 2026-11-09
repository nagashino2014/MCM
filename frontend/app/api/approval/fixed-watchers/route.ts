import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { fixedWatchersForForm } from "@/lib/approval/fixed-watchers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?formId= : 기안 화면용 고정 참조·열람자(346) — 본인(기안자)은 뺀다. 저장·상신 때 서버가 같은 규칙으로 넣는다.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const formId = req.nextUrl.searchParams.get("formId") ?? "";
    if (!formId) return NextResponse.json({ error: "formId 가 필요합니다." }, { status: 400 });
    return NextResponse.json({ watchers: await fixedWatchersForForm(formId, ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
