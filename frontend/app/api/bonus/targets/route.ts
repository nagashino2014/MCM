import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { parsePeriod } from "@/lib/bonus/source";
import { listBonusTargets } from "@/lib/bonus/targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 지급 대상 LIST — 해당 반기 세금계산서 발행 실적이 있는 용역 전체(분류 필터는 클라이언트). */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("bonus.view", { fallbackRoles: ["editor"] });
    const p = parsePeriod(new URL(req.url).searchParams.get("period") ?? "");
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    return NextResponse.json({ period: `${p.year}-${p.half}`, targets: await listBonusTargets(p) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
