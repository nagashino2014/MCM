import { requireBriefingPermission } from "@/lib/intel/briefing-api-access";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { getBriefingProfile, saveBriefingProfile } from "@/lib/intel/briefing-store";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
type Context = { params: Promise<{ profileId: string }> };
export async function GET(_req: NextRequest, c: Context) { try { const a = await requireBriefingPermission("view"); return NextResponse.json({ profile: await getBriefingProfile((await c.params).profileId, a.userId) }); } catch (e) { return authErrorToResponse(e); } }
export async function PATCH(req: NextRequest, c: Context) { try { const a = await requireBriefingPermission("create"); return NextResponse.json({ profile: await saveBriefingProfile(a.userId, await req.json(), (await c.params).profileId) }); } catch (e) { return authErrorToResponse(e); } }
