import { requireBriefingPermission } from "@/lib/intel/briefing-api-access";
import { NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { getRagStatus } from "@/lib/intel/rag-queries";
import { getBriefingCapabilities } from "@/lib/intel/briefing-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireBriefingPermission("view");
    return NextResponse.json({ ...await getRagStatus(), capabilities: await getBriefingCapabilities(actor.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
