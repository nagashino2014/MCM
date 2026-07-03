import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listPendingProgressReports } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("sales.view");
    const reports = await listPendingProgressReports();
    return NextResponse.json({ reports });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
