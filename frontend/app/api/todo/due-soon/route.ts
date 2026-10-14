import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listDueSoon } from "@/lib/todo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 데스크탑 위젯 브릿지용(§9) — 다음 24h(?hours=) 안의 내 예정·마감·지연 작업. 응답 { count, items }.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const hoursRaw = Number(req.nextUrl.searchParams.get("hours") ?? 24);
    const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 && hoursRaw <= 24 * 7 ? hoursRaw : 24;
    const items = await listDueSoon(ctx.userId, hours);
    return NextResponse.json({ count: items.length, items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
