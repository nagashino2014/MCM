import { NextResponse } from "next/server";
import { requirePermission, authErrorToResponse } from "@/lib/auth/guards";
import { getFacilityMissingStats } from "@/lib/ieps/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("facility.view");
    const stats = await getFacilityMissingStats();
    return NextResponse.json({ stats });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
