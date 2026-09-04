// 일정 메뉴 직접 등록 일정(회의·면접·미팅, 219) — POST 생성.
// 권한은 종류별로 lib/calendar/entries.ts 가 판정한다(회의=관리자·임원, 면접=면접 관리자, 미팅=누구나).

import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { createEntry, loadEntryAccess } from "@/lib/calendar/entries";
import type { CalendarEntryInput } from "@/lib/calendar/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ctx = await requireSession();
    const access = await loadEntryAccess(ctx.userId);
    const body = (await req.json()) as Partial<CalendarEntryInput>;
    const entry = await createEntry(body, access);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
