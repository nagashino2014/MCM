import { requireBriefingPermission } from "@/lib/intel/briefing-api-access";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { listBriefingRuns } from "@/lib/intel/briefing-store";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) { try { const a = await requireBriefingPermission("view"); return NextResponse.json({ runs: await listBriefingRuns(a.userId, req.nextUrl.searchParams.get("profileId") ?? undefined) }); } catch (e) { return authErrorToResponse(e); } }
