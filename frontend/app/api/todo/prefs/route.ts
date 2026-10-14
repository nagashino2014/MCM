import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getPrefs, updatePrefs } from "@/lib/todo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 사용자 설정(§6.4) — GET / PATCH { defaultRemindAllDayTime, defaultRemindBeforeMin, digestTime(null=끔), ... }.
export async function GET() {
  try {
    const ctx = await requireSession();
    return NextResponse.json({ prefs: await getPrefs(ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = await req.json().catch(() => ({}));
    return NextResponse.json({ prefs: await updatePrefs(ctx.userId, body ?? {}) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
