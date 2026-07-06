import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listIntelSignals } from "@/lib/intel/intel-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const sp = req.nextUrl.searchParams;
    const signals = await listIntelSignals({
      signalType: sp.get("signalType") || undefined,
      matchStatus: sp.get("matchStatus") || undefined,
      status: sp.get("status") || undefined,
      q: sp.get("q") || undefined,
      from: sp.get("from") || undefined,
      to: sp.get("to") || undefined,
    });
    return NextResponse.json({ signals });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
