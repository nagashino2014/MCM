import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { listBonusSpans, parsePeriod } from "@/lib/bonus/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const sp = new URL(req.url).searchParams;
    const contractId = sp.get("contractId") ?? "";
    const p = parsePeriod(sp.get("period") ?? "");
    if (!contractId) return NextResponse.json({ error: "contractId 가 필요합니다." }, { status: 400 });
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    return NextResponse.json({ spans: await listBonusSpans(contractId, p) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
