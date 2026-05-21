import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { listAlerts } from "@/lib/ieps/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status");
    const limitParam = searchParams.get("limit");
    const status = statusParam === "all" ? "all" : "open";
    const limit = limitParam ? parseInt(limitParam, 10) : 50;

    const alerts = await listAlerts({
      status,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
    });
    return NextResponse.json({ alerts, total: alerts.length });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
