import { requireBriefingPermission } from "@/lib/intel/briefing-api-access";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { queueManualBriefing } from "@/lib/intel/briefing-store";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function POST(req: NextRequest, c: { params: Promise<{ profileId: string }> }) { try { const a = await requireBriefingPermission("create"); const body = await req.json(); return NextResponse.json({ run: await queueManualBriefing((await c.params).profileId, a.userId, String(body.requestKey ?? "")) }, { status: 202 }); } catch (e) { return authErrorToResponse(e); } }
