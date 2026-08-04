import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getHolidays, getHolidaySeasons } from "@/lib/home/holidays";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 공휴일(홈) — ?year=YYYY 의 공휴일 목록 + 설·추석 시즌 구간(요청 연도·다음 연도분).
 * 홈 캘린더(일·공휴일 붉은색)와 날씨 위젯(명절 시즌 씬)이 함께 쓴다. 소스는 서버 캐시(lib/home/holidays).
 */
export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const yearRaw = Number(req.nextUrl.searchParams.get("year"));
    const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : new Date().getFullYear();
    const [holidays, seasons] = await Promise.all([getHolidays(year), getHolidaySeasons(year)]);
    return NextResponse.json({ year, holidays, seasons });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
