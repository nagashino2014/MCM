// 일정 메뉴(G6-C) 사용자 설정 — 켜둔 태그 + '선택' 대상(개인/부서/전사).
// GET: 현재 설정 / PUT: 부분 저장(넘긴 필드만 병합).

import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { loadCalendarPrefs, saveCalendarPrefs } from "@/lib/calendar/prefs";
import type { CalendarPrefs } from "@/lib/calendar/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireSession();
    const prefs = await loadCalendarPrefs(ctx.userId);
    return NextResponse.json(prefs);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireSession();
    const body = (await req.json()) as Partial<CalendarPrefs>;
    await saveCalendarPrefs(ctx.userId, { tags: body.tags, refs: body.refs });
    const prefs = await loadCalendarPrefs(ctx.userId);
    return NextResponse.json(prefs);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
