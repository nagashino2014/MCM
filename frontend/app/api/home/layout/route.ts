// 홈 화면 사용자 설정(HC-B) — 카드 표시/배치 + 캘린더 참조 인원·태그.
// GET: 저장된 설정 + 이 사용자가 열람 가능한 위젯 목록(권한 필터링 후).
// PUT: 부분 저장(layout / calendarRefs / calendarTags 중 보낸 것만 갱신).

import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { loadHomeSettings, saveHomeSettings } from "@/lib/home/layout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireSession();
    return NextResponse.json(await loadHomeSettings(ctx.userId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireSession();
    const body = await req.json().catch(() => ({}));
    await saveHomeSettings(ctx.userId, {
      layout: body.layout,
      calendarRefs: body.calendarRefs,
      calendarTags: body.calendarTags,
    });
    return NextResponse.json(await loadHomeSettings(ctx.userId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
