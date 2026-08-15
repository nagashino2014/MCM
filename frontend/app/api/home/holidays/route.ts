import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getHolidaySeasons } from "@/lib/home/holidays";
import { listOffDays } from "@/lib/hr/holidays";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 휴무일(홈·일정 캘린더) — ?year=YYYY 의 휴무일 목록 + 설·추석 시즌 구간(요청 연도·다음 연도분).
 * 목록은 법정공휴일·근로자의 날에 **사내 지정 휴무일**(대체휴일·창립기념일·전체연차, 마이그 168)을 병합한 단일 소스다.
 * 캘린더는 이 날짜를 붉게 칠하고 `name`을 함께 표시한다. 날씨 위젯은 시즌 구간만 쓴다.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const yearRaw = Number(req.nextUrl.searchParams.get("year"));
    const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : new Date().getFullYear();
    const [holidays, seasons] = await Promise.all([listOffDays(year), getHolidaySeasons(year)]);
    return NextResponse.json({ year, holidays, seasons });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
