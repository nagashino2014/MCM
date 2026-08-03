// 일정 메뉴(G6-C) 통합 조회 — ?month=YYYY-MM&tags=self,dept,sales,refs,vehicle
// 휴가/출장/교육(전자결재 상신 문서) + 영업 활동 + 법인차량을 한 번에 내려준다.
// sales 태그는 sales.view 부분 판정 — 권한이 없으면 403 대신 sales 만 제외하고
// salesDenied:true 를 내려 화면이 태그를 비활성 표시한다(홈 위젯 salesDenied 패턴의 서버판).

import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { listCalendarEvents } from "@/lib/calendar/queries";
import { CALENDAR_TAG_KEYS, type CalendarTagKey } from "@/lib/calendar/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const ctx = await requireSession();
    const url = new URL(req.url);
    const month = url.searchParams.get("month") ?? "";
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: "month=YYYY-MM 형식이 필요합니다." }, { status: 400 });
    }
    const tags = (url.searchParams.get("tags") ?? "self")
      .split(",")
      .map((s) => s.trim())
      .filter((t): t is CalendarTagKey => (CALENDAR_TAG_KEYS as readonly string[]).includes(t));

    const wantsSales = tags.includes("sales");
    const includeSales = wantsSales ? await hasPermission(ctx.userId, "sales.view") : false;

    const events = await listCalendarEvents({ userId: ctx.userId, month, tags, includeSales });
    return NextResponse.json({ events, salesDenied: wantsSales && !includeSales });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
