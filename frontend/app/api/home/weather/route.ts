import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getWeather } from "@/lib/home/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 홈 날씨 위젯 — ?lat=&lon= 위치의 현재 기상.
 * 기상청 API 키를 서버에만 두기 위한 프록시이기도 하다(브라우저 직접 호출 시 키 노출·CORS 문제).
 * 응답: { temp, hi, lo, base(맑음|흐림|비|눈), source }
 */
export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const lat = Number(req.nextUrl.searchParams.get("lat"));
    const lon = Number(req.nextUrl.searchParams.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return NextResponse.json({ error: "lat·lon 이 필요합니다." }, { status: 400 });
    }
    return NextResponse.json(await getWeather(lat, lon));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
