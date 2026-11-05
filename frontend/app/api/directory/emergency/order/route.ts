import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse } from "@/lib/auth/guards";
import { requireGlobalScope } from "@/lib/auth/scope-guards";
import { saveEmergencyContactOrder } from "@/lib/emergency-contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 비상 연락망 표 순서 저장 — 수정 권한(전사 범위 staffing.edit) 필요.
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireGlobalScope("staffing.edit");
    const body = (await req.json().catch(() => ({}))) as { keys?: unknown };
    if (!Array.isArray(body.keys) || body.keys.length === 0 || body.keys.length > 1000) {
      return NextResponse.json({ error: "순서를 지정하세요." }, { status: 400 });
    }
    await saveEmergencyContactOrder(body.keys.map(String), ctx.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError || !(err instanceof Error) || !err.message) return authErrorToResponse(err);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
