import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listUpcomingActivities } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("sales.view");
    const activities = await listUpcomingActivities();
    return NextResponse.json({ activities });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
