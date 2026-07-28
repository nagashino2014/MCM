import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getPushPrefs, savePushPrefs } from "@/lib/notify/push-prefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 이벤트별 수신 토글 + 방해금지 + 등록 기기 수(앱 설정 화면).
export async function GET() {
  try {
    const ctx = await requireSession();
    return NextResponse.json(await getPushPrefs(ctx.userId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 변경분만 보내면 된다(events 일부 + quiet 선택).
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json()) as {
      events?: { key: string; enabled: boolean }[];
      quiet?: { enabled: boolean; from: string; to: string };
    };
    await savePushPrefs(ctx.userId, body);
    return NextResponse.json(await getPushPrefs(ctx.userId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
