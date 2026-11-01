import { requireBriefingPermission } from "@/lib/intel/briefing-api-access";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { listBriefingProfiles, saveBriefingProfile } from "@/lib/intel/briefing-store";
import { getBriefingCapabilities } from "@/lib/intel/briefing-access";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET() { try { const a = await requireBriefingPermission("view"); return NextResponse.json({ profiles: await listBriefingProfiles(a.userId), capabilities: await getBriefingCapabilities(a.userId) }); } catch (e) { return authErrorToResponse(e); } }
export async function POST(req: NextRequest) { try { const a = await requireBriefingPermission("create"); return NextResponse.json({ profile: await saveBriefingProfile(a.userId, await req.json()) }, { status: 201 }); } catch (e) { return authErrorToResponse(e); } }
